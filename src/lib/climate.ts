// Klimatologické výpočty nad denní řadou (stanice ČHMÚ nebo ERA5).
// Řada je kompaktní: počáteční datum + sloupce hodnot pro po sobě jdoucí dny.

import { NORMAL_PERIOD } from '../config.ts'
import { linearRegression, mean, percentile, round } from './stats.ts'
import { addDays, daysBetween, leapDayIndex } from './time.ts'

export type ClimVar = 'tmax' | 'tmin' | 'tmean' | 'prcp' | 'snow' | 'snowDepth'

export interface DailySeries {
  /** Datum prvního prvku 'YYYY-MM-DD' */
  start: string
  /** Datum posledního prvku */
  end: string
  source: 'chmi' | 'era5'
  vars: Partial<Record<ClimVar, (number | null)[]>>
  /** Čas vytvoření (ISO) */
  updated?: string
}

export const length = (s: DailySeries) => daysBetween(s.start, s.end) + 1
export const indexOf = (s: DailySeries, date: string) => daysBetween(s.start, date)
export const dateAt = (s: DailySeries, i: number) => addDays(s.start, i)

export function valueAt(s: DailySeries, v: ClimVar, date: string): number | null {
  const arr = s.vars[v]
  if (!arr) return null
  const i = indexOf(s, date)
  return i >= 0 && i < arr.length ? (arr[i] ?? null) : null
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const pad = (n: number) => String(n).padStart(2, '0')
const firstYear = (s: DailySeries) => Number(s.start.slice(0, 4))
const lastYear = (s: DailySeries) => Number(s.end.slice(0, 4))

/** Hodnoty proměnné pro všechny dny v roce/měsíci (null = chybí nebo mimo řadu) */
function range(s: DailySeries, v: ClimVar, from: string, to: string): (number | null)[] {
  const arr = s.vars[v] ?? []
  const a = indexOf(s, from)
  const b = indexOf(s, to)
  const out: (number | null)[] = []
  for (let i = a; i <= b; i++) out.push(i >= 0 && i < arr.length ? (arr[i] ?? null) : null)
  return out
}

export interface DayNormal {
  mean: number | null
  p10: number | null
  p90: number | null
  /** Počet hodnot, ze kterých normál vznikl */
  n: number
  /** Počet let normálového období, které měly aspoň jednu hodnotu */
  years: number
}

/**
 * Normál pro kalendářní den: všechny hodnoty v okně ±window dní kolem daného dne
 * v letech normálového období (výchozí 1991–2020, ±7 dní → až 30 × 15 hodnot).
 */
export interface WindowOptions {
  from?: number
  to?: number
  window?: number
}

export function dayNormal(s: DailySeries, v: ClimVar, month: number, day: number, opts: WindowOptions = {}): DayNormal {
  const { values, years } = dayWindowValues(s, v, month, day, opts)
  return { mean: mean(values), p10: percentile(values, 10), p90: percentile(values, 90), n: values.length, years }
}

/** Všechny hodnoty v okně ±window dní kolem kalendářního dne v letech from–to (+ počet let s daty) */
export function dayWindowValues(
  s: DailySeries,
  v: ClimVar,
  month: number,
  day: number,
  { from = NORMAL_PERIOD.from, to = NORMAL_PERIOD.to, window = 7 }: WindowOptions = {},
): { values: number[]; years: number } {
  const values: number[] = []
  let years = 0
  for (let y = from; y <= to; y++) {
    const d = month === 2 && day === 29 && !isLeap(y) ? 28 : day
    const center = `${y}-${pad(month)}-${pad(d)}`
    let any = false
    for (let off = -window; off <= window; off++) {
      const val = valueAt(s, v, addDays(center, off))
      if (val != null) {
        values.push(val)
        any = true
      }
    }
    if (any) years++
  }
  return { values, years }
}

export interface Extreme {
  value: number
  year: number
}

export interface DayRecords {
  highestMax: Extreme | null
  lowestMax: Extreme | null
  highestMin: Extreme | null
  lowestMin: Extreme | null
  wettest: Extreme | null
  /** Počet let s údajem o teplotě pro tento den */
  years: number
  firstYear: number | null
}

function pickExtreme(rows: { year: number; v: number | null }[], cmp: (a: number, b: number) => boolean): Extreme | null {
  let best: Extreme | null = null
  for (const r of rows) if (r.v != null && (best === null || cmp(r.v, best.value))) best = { value: r.v, year: r.year }
  return best
}

/** Historie konkrétního kalendářního dne po letech */
export function dayHistory(s: DailySeries, month: number, day: number, untilYear = lastYear(s)) {
  const out: { year: number; tmax: number | null; tmin: number | null; tmean: number | null; prcp: number | null }[] = []
  for (let y = firstYear(s); y <= untilYear; y++) {
    if (month === 2 && day === 29 && !isLeap(y)) continue
    const date = `${y}-${pad(month)}-${pad(day)}`
    const row = {
      year: y,
      tmax: valueAt(s, 'tmax', date),
      tmin: valueAt(s, 'tmin', date),
      tmean: valueAt(s, 'tmean', date),
      prcp: valueAt(s, 'prcp', date),
    }
    if (row.tmax != null || row.tmin != null || row.tmean != null || row.prcp != null) out.push(row)
  }
  return out
}

/** Rekordy pro kalendářní den (přesně tentýž den, všechny roky v řadě; volitelně bez aktuálního roku) */
export function dayRecords(s: DailySeries, month: number, day: number, untilYear = lastYear(s)): DayRecords {
  const h = dayHistory(s, month, day, untilYear)
  const gt = (a: number, b: number) => a > b
  const lt = (a: number, b: number) => a < b
  const withTemp = h.filter((r) => r.tmax != null || r.tmin != null)
  return {
    highestMax: pickExtreme(h.map((r) => ({ year: r.year, v: r.tmax })), gt),
    lowestMax: pickExtreme(h.map((r) => ({ year: r.year, v: r.tmax })), lt),
    highestMin: pickExtreme(h.map((r) => ({ year: r.year, v: r.tmin })), gt),
    lowestMin: pickExtreme(h.map((r) => ({ year: r.year, v: r.tmin })), lt),
    wettest: pickExtreme(h.map((r) => ({ year: r.year, v: r.prcp })), gt),
    years: withTemp.length,
    firstYear: withTemp.length ? withTemp[0].year : null,
  }
}

/** Minimální pokrytí daty, aby se měsíc/rok považoval za úplný */
export const MIN_COVERAGE = 0.9

export interface PeriodStats {
  tmean: number | null
  tmax: number | null
  tmin: number | null
  prcp: number | null
  /** Absolutní maximum / minimum v období */
  absMax: number | null
  absMin: number | null
  /** Počty charakteristických dní (definice ČHMÚ) */
  tropicalDays: number // Tmax ≥ 30 °C
  summerDays: number // Tmax ≥ 25 °C
  frostDays: number // Tmin < 0 °C
  iceDays: number // Tmax < 0 °C
  tropicalNights: number // Tmin ≥ 20 °C
  wetDays: number // srážky ≥ 1 mm
  /** Podíl dní s údajem (0–1) pro teplotu a srážky */
  coverageT: number
  coverageP: number
  days: number
}

export function periodStats(s: DailySeries, from: string, to: string): PeriodStats {
  const tmax = range(s, 'tmax', from, to)
  const tmin = range(s, 'tmin', from, to)
  const tmeanRaw = range(s, 'tmean', from, to)
  const prcp = range(s, 'prcp', from, to)
  const days = tmax.length
  // Denní průměr: přednostně tmean, jinak (Tmax + Tmin) / 2
  const tmean = tmeanRaw.map((v, i) => v ?? (tmax[i] != null && tmin[i] != null ? (tmax[i]! + tmin[i]!) / 2 : null))
  const count = (arr: (number | null)[], f: (v: number) => boolean) => arr.reduce<number>((n, v) => n + (v != null && f(v) ? 1 : 0), 0)
  const have = (arr: (number | null)[]) => count(arr, () => true)
  const coverageT = days ? have(tmean) / days : 0
  const coverageP = days ? have(prcp) / days : 0
  const okT = coverageT >= MIN_COVERAGE
  const pSum = prcp.reduce<number>((a, v) => a + (v ?? 0), 0)
  const tmaxValid = tmax.filter((v): v is number => v != null)
  const tminValid = tmin.filter((v): v is number => v != null)
  return {
    tmean: okT ? round(mean(tmean)!, 2) : null,
    tmax: okT && tmaxValid.length ? round(mean(tmax)!, 2) : null,
    tmin: okT && tminValid.length ? round(mean(tmin)!, 2) : null,
    // Úhrn jen z úplných dat: chybějící den (třeba s bouřkou) by součet zkreslil a dopočet poměrem by ho skryl
    prcp: coverageP === 1 ? round(pSum, 1) : null,
    absMax: tmaxValid.length ? Math.max(...tmaxValid) : null,
    absMin: tminValid.length ? Math.min(...tminValid) : null,
    tropicalDays: count(tmax, (v) => v >= 30),
    summerDays: count(tmax, (v) => v >= 25),
    frostDays: count(tmin, (v) => v < 0),
    iceDays: count(tmax, (v) => v < 0),
    tropicalNights: count(tmin, (v) => v >= 20),
    wetDays: count(prcp, (v) => v >= 1),
    coverageT,
    coverageP,
    days,
  }
}

const monthEnd = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`

export function monthStats(s: DailySeries, year: number, month: number): PeriodStats {
  return periodStats(s, `${year}-${pad(month)}-01`, monthEnd(year, month))
}

export function yearStats(s: DailySeries, year: number): PeriodStats {
  return periodStats(s, `${year}-01-01`, `${year}-12-31`)
}

export interface MonthNormal {
  month: number
  tmean: number | null
  tmax: number | null
  tmin: number | null
  prcp: number | null
  /** Počet let, ze kterých je normál teploty / srážek */
  yearsT: number
  yearsP: number
}

/** Měsíční normály: průměr měsíčních hodnot přes úplné měsíce normálového období */
export function monthlyNormals(s: DailySeries, from: number = NORMAL_PERIOD.from, to: number = NORMAL_PERIOD.to): MonthNormal[] {
  const out: MonthNormal[] = []
  for (let m = 1; m <= 12; m++) {
    const rows = []
    for (let y = from; y <= to; y++) rows.push(monthStats(s, y, m))
    const t = rows.filter((r) => r.tmean != null)
    const p = rows.filter((r) => r.prcp != null)
    out.push({
      month: m,
      tmean: t.length ? round(mean(t.map((r) => r.tmean))!, 2) : null,
      tmax: t.length ? round(mean(t.map((r) => r.tmax))!, 2) : null,
      tmin: t.length ? round(mean(t.map((r) => r.tmin))!, 2) : null,
      prcp: p.length ? round(mean(p.map((r) => r.prcp))!, 1) : null,
      yearsT: t.length,
      yearsP: p.length,
    })
  }
  return out
}

export interface YearRow {
  year: number
  tmean: number | null
  prcp: number | null
  coverageT: number
  coverageP: number
}

/** Roční průměry teplot a úhrny srážek (jen pro úplné roky; aktuální neúplný rok se vynechá) */
export function yearlySeries(s: DailySeries): YearRow[] {
  const out: YearRow[] = []
  const endYear = s.end.endsWith('-12-31') ? lastYear(s) : lastYear(s) - 1
  for (let y = firstYear(s); y <= endYear; y++) {
    const st = yearStats(s, y)
    out.push({ year: y, tmean: st.tmean, prcp: st.prcp, coverageT: st.coverageT, coverageP: st.coverageP })
  }
  return out
}

/** Lineární trend teploty ve °C za desetiletí */
export function trendPerDecade(rows: YearRow[], from?: number, to?: number): { perDecade: number; from: number; to: number; n: number } | null {
  const pts = rows
    .filter((r) => r.tmean != null && (from == null || r.year >= from) && (to == null || r.year <= to))
    .map((r) => ({ x: r.year, y: r.tmean! }))
  const reg = linearRegression(pts)
  if (!reg || pts.length < 10) return null
  return { perDecade: reg.slope * 10, from: pts[0].x, to: pts[pts.length - 1].x, n: pts.length }
}

/** Kumulativní srážky v roce po dnech a normálová kumulace (průměr denních úhrnů v normálovém období) */
export function cumulativePrecip(s: DailySeries, year: number, from: number = NORMAL_PERIOD.from, to: number = NORMAL_PERIOD.to) {
  const sums = new Array<number>(366).fill(0)
  const counts = new Array<number>(366).fill(0)
  for (let y = from; y <= to; y++) {
    const vals = range(s, 'prcp', `${y}-01-01`, `${y}-12-31`)
    vals.forEach((v, i) => {
      if (v == null) return
      const date = addDays(`${y}-01-01`, i)
      const idx = leapDayIndex(Number(date.slice(5, 7)), Number(date.slice(8, 10)))
      sums[idx] += v
      counts[idx]++
    })
  }
  // Průměrný úhrn pro každý den v roce; 29. 2. se do nepřestupného roku nezapočítá
  const dailyNormal = sums.map((sum, i) => (counts[i] ? sum / counts[i] : 0))
  const days = isLeap(year) ? 366 : 365
  const actual: (number | null)[] = []
  const normal: number[] = []
  let accA = 0
  let accN = 0
  let missing = false
  const values = range(s, 'prcp', `${year}-01-01`, `${year}-12-31`)
  for (let i = 0; i < days; i++) {
    const date = addDays(`${year}-01-01`, i)
    const idx = leapDayIndex(Number(date.slice(5, 7)), Number(date.slice(8, 10)))
    if (!isLeap(year) && idx === 59) continue // nemělo by nastat, 29. 2. v nepřestupném roce neexistuje
    accN += dailyNormal[idx]
    normal.push(round(accN, 1))
    const v = values[i]
    if (date > s.end) {
      actual.push(null)
      continue
    }
    if (v == null) missing = true
    accA += v ?? 0
    actual.push(round(accA, 1))
  }
  return { actual, normal, missing }
}

export interface DrySpell {
  start: string
  end: string
  days: number
}

/**
 * Suchá období: po sobě jdoucí dny se srážkami < threshold (výchozí 1 mm, definice CDD dle ETCCDI).
 * Chybějící údaj období přeruší.
 */
export function drySpells(s: DailySeries, from = s.start, to = s.end, threshold = 1): DrySpell[] {
  const vals = range(s, 'prcp', from, to)
  const spells: DrySpell[] = []
  let startIdx = -1
  const close = (endIdx: number) => {
    if (startIdx >= 0) spells.push({ start: addDays(from, startIdx), end: addDays(from, endIdx), days: endIdx - startIdx + 1 })
    startIdx = -1
  }
  vals.forEach((v, i) => {
    if (v != null && v < threshold) {
      if (startIdx < 0) startIdx = i
    } else close(i - 1)
  })
  close(vals.length - 1)
  return spells.sort((a, b) => b.days - a.days || a.start.localeCompare(b.start))
}

/** Roky, pro které má řada data o teplotě (pro výběr ve srovnání) */
export function yearsWithData(s: DailySeries): number[] {
  const out: number[] = []
  for (let y = firstYear(s); y <= lastYear(s); y++) {
    const st = yearStats(s, y)
    if (st.coverageT > 0.5 || st.coverageP > 0.5) out.push(y)
  }
  return out
}

/** Souvislé úseky let, kdy chybí teplotní data (pro vyznačení mezer v grafech a popiscích) */
export function temperatureGaps(rows: YearRow[]): { from: number; to: number }[] {
  const gaps: { from: number; to: number }[] = []
  let start: number | null = null
  for (const r of rows) {
    if (r.tmean == null) start ??= r.year
    else if (start != null) {
      gaps.push({ from: start, to: r.year - 1 })
      start = null
    }
  }
  if (start != null) gaps.push({ from: start, to: rows[rows.length - 1].year })
  return gaps
}
