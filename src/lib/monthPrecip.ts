// Denní srážky za kalendářní měsíc (graf v Historii).
// Zdroj: denní úhrny stanice ČHMÚ Karviná; dny, které ČHMÚ ještě nezveřejnilo (poslední 1–2 dny),
// se doplní součtem 10min měření stejné stanice – se stejnou konvencí dne, takže se hodnoty nemění,
// když pak dorazí oficiální denní úhrn (ověřeno 118/118 dní, červenec–listopad 2026).

import { NORMAL_PERIOD } from '../config.ts'
import { type DailySeries, dayNormal, monthStats, valueAt } from './climate.ts'
import { mean } from './stats.ts'
import type { RegularSeries } from './dataTypes.ts'
import { DAY, HOUR } from './time.ts'

/**
 * Srážkový den ČHMÚ: 7:00 SEČ dne D → 7:00 SEČ dne D+1 (SEČ = UTC+1 celoročně).
 * V 10min datech to jsou značky 06:00 UTC dne D až 05:50 UTC dne D+1.
 */
export const PRECIP_DAY_START_UTC = 6 * HOUR

export type PrecipDayStatus =
  /** Oficiální denní úhrn ČHMÚ */
  | 'measured'
  /** Úplný den sečtený z 10min měření (ČHMÚ denní úhrn ještě nezveřejnilo) */
  | 'prelim'
  /** Den teprve běží nebo měření nejsou kompletní – součet zatím */
  | 'partial'
  /** Den už proběhl, ale data chybí */
  | 'missing'
  /** Den ještě nezačal */
  | 'future'

export interface PrecipDay {
  date: string
  day: number
  /** Úhrn (mm), null = chybí / budoucnost */
  mm: number | null
  status: PrecipDayStatus
  /** U 'partial': čas posledního započteného 10min měření */
  until?: number
  /** Kolik minut 10min měření v součtu chybí (výpadek stanice) */
  gapMinutes?: number
  /** Normál pro tento den (průměrný denní úhrn 1991–2020 vyhlazený oknem ±7 dní, součet za měsíc = měsíční normál) */
  normal: number | null
}

export interface MonthPrecip {
  year: number
  month: number
  days: PrecipDay[]
  /** Součet známých dní (mm) */
  total: number
  /** Průběžný součet od 1. dne (null = budoucí den) */
  cumulative: (number | null)[]
  /** Normálová kumulace po dnech */
  normalCumulative: (number | null)[]
  /** Normál celého měsíce (součet denních normálů) */
  normalTotal: number | null
  /** Normál do posledního dne, který už začal */
  normalToDate: number | null
  /** Poslední den, který už začal (index), −1 = měsíc ještě nezačal */
  lastIndex: number
  /** Dny se srážkami ≥ 1 mm */
  wetDays: number
  /** Den s největším úhrnem */
  max: PrecipDay | null
  /** Počet proběhlých dní bez dat */
  missingDays: number
  /** Počet dní se známým úhrnem (i rozpracovaný den) */
  knownDays: number
  /** Měsíc je celý a bez chybějících dní */
  complete: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const round1 = (v: number) => Math.round(v * 10) / 10
export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** Začátek srážkového dne (ms UTC) */
export function precipDayStart(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) + PRECIP_DAY_START_UTC
}

/** Součet 10min srážek za srážkový den; null = pro den nejsou žádná data */
export function sumPrecipDay(sra: RegularSeries | null | undefined, date: string): { mm: number; complete: boolean; until: number; gapMinutes: number } | null {
  if (!sra || !sra.values.length) return null
  const a = precipDayStart(date)
  const b = a + DAY
  // Začátek dne musí být v zásobě, jinak by součet byl neúplný bez varování
  if (sra.start > a) return null
  const last = sra.start + (sra.values.length - 1) * sra.step
  if (last < a) return null
  const i0 = Math.round((a - sra.start) / sra.step)
  const i1 = Math.min(Math.round((b - sra.start) / sra.step) - 1, sra.values.length - 1)
  let sum = 0
  let nulls = 0
  let lastKnown: number | null = null
  for (let i = i0; i <= i1; i++) {
    const v = sra.values[i]
    if (v == null) nulls++
    else {
      sum += v
      lastKnown = sra.start + i * sra.step
    }
  }
  if (lastKnown == null) return null
  // Úplný = zásoba sahá až do konce dne (výpadky uvnitř dne hlásí gapMinutes)
  const complete = last >= b - sra.step
  return { mm: round1(sum), complete, until: complete ? b - sra.step : last, gapMinutes: (nulls * sra.step) / 60_000 }
}

/**
 * Srážky po dnech za měsíc. Oficiální denní úhrn ČHMÚ má přednost; chybí-li (typicky poslední 1–2 dny,
 * ČHMÚ je zveřejňuje se zpožděním), doplní se z 10min měření. Normál vždy z denní řady stanice.
 */
export function monthPrecip(s: DailySeries, sra: RegularSeries | null | undefined, year: number, month: number, now: number): MonthPrecip {
  const n = daysInMonth(year, month)
  const normals = monthDailyNormals(s, month, n)
  const days: PrecipDay[] = []
  for (let d = 1; d <= n; d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`
    const start = precipDayStart(date)
    const base = { date, day: d, normal: normals?.[d - 1] ?? null }
    if (start > now) {
      days.push({ ...base, mm: null, status: 'future' })
      continue
    }
    const official = valueAt(s, 'prcp', date)
    if (official != null) {
      days.push({ ...base, mm: official, status: 'measured' })
      continue
    }
    const fromSra = sumPrecipDay(sra, date)
    const inProgress = start + DAY > now
    if (fromSra) {
      days.push({
        ...base,
        mm: fromSra.mm,
        status: fromSra.complete ? 'prelim' : 'partial',
        ...(fromSra.complete ? {} : { until: fromSra.until }),
        ...(fromSra.gapMinutes ? { gapMinutes: fromSra.gapMinutes } : {}),
      })
    } else {
      // Právě začatý den bez dat (10min měření chodí s ~hodinovým zpožděním) není „chybějící“
      days.push({ ...base, mm: null, status: inProgress ? 'future' : 'missing' })
    }
  }

  let acc = 0
  let accN = 0
  let normalOk = true
  const cumulative: (number | null)[] = []
  const normalCumulative: (number | null)[] = []
  let lastIndex = -1
  days.forEach((x, i) => {
    if (x.normal == null) normalOk = false
    accN += x.normal ?? 0
    normalCumulative.push(normalOk ? round1(accN) : null)
    if (x.status === 'future') {
      cumulative.push(null)
      return
    }
    lastIndex = i
    acc += x.mm ?? 0
    cumulative.push(round1(acc))
  })
  const known = days.filter((x) => x.mm != null)
  const max = known.length ? known.reduce((a, b) => (b.mm! > a.mm! ? b : a)) : null
  const missingDays = days.filter((x) => x.status === 'missing').length
  return {
    year,
    month,
    days,
    total: round1(acc),
    cumulative,
    normalCumulative,
    normalTotal: normalOk ? round1(accN) : null,
    normalToDate: lastIndex >= 0 ? normalCumulative[lastIndex] : null,
    lastIndex,
    wetDays: known.filter((x) => x.mm! >= 1).length,
    max: max && max.mm! > 0 ? max : null,
    missingDays,
    knownDays: known.length,
    complete: days.every((x) => x.status === 'measured' || x.status === 'prelim'),
  }
}

/**
 * Denní normály měsíce: tvar z vyhlazených denních průměrů (okno ±7 dní), součet srovnaný na měsíční
 * normál (průměr úplných měsíců 1991–2020) – stejné číslo, jaké ukazují ostatní karty Historie.
 */
function monthDailyNormals(s: DailySeries, month: number, n: number): number[] | null {
  const smooth = Array.from({ length: n }, (_, i) => dayNormal(s, 'prcp', month, i + 1).mean)
  if (smooth.some((v) => v == null)) return null
  const totals: number[] = []
  for (let y = NORMAL_PERIOD.from; y <= NORMAL_PERIOD.to; y++) {
    const p = monthStats(s, y, month).prcp
    if (p != null) totals.push(p)
  }
  const target = mean(totals)
  const sum = smooth.reduce<number>((a, v) => a + v!, 0)
  if (target == null || !(sum > 0)) return smooth as number[]
  // Únor má normál jeden pro přestupné i nepřestupné roky (jako v ostatních kartách)
  const k = Math.round(target * 10) / 10 / sum
  return smooth.map((v) => v! * k)
}

/** První měsíc, pro který má stanice denní srážky */
export function firstPrecipMonth(s: DailySeries): { year: number; month: number } | null {
  const arr = s.vars.prcp ?? []
  const i = arr.findIndex((v) => v != null)
  if (i < 0) return null
  const t = new Date(Date.parse(`${s.start}T00:00:00Z`) + i * DAY)
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 }
}
