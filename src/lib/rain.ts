// Srážkové epizody a „čas od posledního deště“.
//
// Vstupem jsou vzorky srážek za interval. Časová značka `t` je KONEC intervalu
// (ověřeno u ČHMÚ: SRA1H(t) = součet SRA10M v (t−60 min, t]; Open-Meteo minutely_15 a hourly
// jsou dle dokumentace „součet za předchozích 15 min / hodinu“). Interval je tedy (t − dur, t].

import { MINUTE } from './time.ts'

export type PrecipSource = 'station' | 'model'

export interface PrecipSample {
  /** Konec intervalu (ms UTC) */
  t: number
  /** Délka intervalu (ms) */
  dur: number
  /** Úhrn za interval (mm) */
  mm: number
  src: PrecipSource
}

export interface RainEvent {
  /** Začátek prvního mokrého intervalu */
  start: number
  /** Konec posledního mokrého intervalu = okamžik, kdy přestalo pršet */
  end: number
  /** Celkový úhrn epizody (mm) */
  total: number
  /** Nejvyšší intenzita v epizodě (mm/h) */
  peakRate: number
  /** Zdroj začátku a konce epizody */
  startSrc: PrecipSource
  endSrc: PrecipSource
}

/** Nejmenší měřitelná srážka (srážkoměr ČHMÚ i Open-Meteo zaokrouhlují na 0,1 mm) */
export const WET_MIN_MM = 0.1
/** Přestávka, která ještě nepřeruší epizodu */
export const DEFAULT_MERGE_GAP = 30 * MINUTE
const EPS = 1e-9

export const isWet = (s: PrecipSample) => s.mm >= WET_MIN_MM - EPS

/**
 * Sloučí měření stanice a modelová data: do posledního měření stanice se berou jen data stanice,
 * po něm (typicky posledních ≤ 90 min, než ČHMÚ zveřejní další soubor) data modelu.
 * Vrací vzorky seřazené podle času, bez vzorků z budoucnosti (konec intervalu > now).
 */
export function mergeSamples(station: PrecipSample[], model: PrecipSample[], now: number): PrecipSample[] {
  const st = station.filter((s) => s.t <= now).sort((a, b) => a.t - b.t)
  const lastStation = st.length ? st[st.length - 1].t : -Infinity
  const md = model.filter((s) => s.t - s.dur >= lastStation - EPS && s.t <= now).sort((a, b) => a.t - b.t)
  return [...st, ...md]
}

/** Seskupí mokré intervaly do epizod; mezery ≤ mergeGap epizodu nepřeruší */
export function buildRainEvents(samples: PrecipSample[], mergeGap = DEFAULT_MERGE_GAP): RainEvent[] {
  const events: RainEvent[] = []
  let cur: RainEvent | null = null
  for (const s of [...samples].sort((a, b) => a.t - b.t)) {
    if (!isWet(s)) continue
    const start = s.t - s.dur
    const rate = (s.mm / s.dur) * 60 * MINUTE
    if (cur && start - cur.end <= mergeGap + EPS) {
      cur.end = Math.max(cur.end, s.t)
      cur.total += s.mm
      cur.peakRate = Math.max(cur.peakRate, rate)
      cur.endSrc = s.src
    } else {
      cur = { start, end: s.t, total: s.mm, peakRate: rate, startSrc: s.src, endSrc: s.src }
      events.push(cur)
    }
  }
  for (const e of events) e.total = Math.round(e.total * 10) / 10
  return events
}

/** Úseky, kde chybí data (rozestup vzorků větší než 1,5× délka intervalu) */
export function findGaps(samples: PrecipSample[], from: number, to: number): { from: number; to: number }[] {
  const sorted = samples.filter((s) => s.t > from && s.t - s.dur < to).sort((a, b) => a.t - b.t)
  const gaps: { from: number; to: number }[] = []
  let covered = from
  for (const s of sorted) {
    const start = s.t - s.dur
    if (start - covered > s.dur * 0.5 + EPS) gaps.push({ from: covered, to: start })
    covered = Math.max(covered, s.t)
  }
  if (sorted.length && to - covered > sorted[sorted.length - 1].dur * 1.5) gaps.push({ from: covered, to })
  return gaps
}

export type RainState =
  | {
      kind: 'raining'
      /** Začátek aktuální epizody */
      since: number
      /** Dosavadní úhrn */
      total: number
      /** Zdroj začátku epizody a zdroj posledního (aktuálního) intervalu */
      startSrc: PrecipSource
      src: PrecipSource
    }
  | {
      kind: 'dry'
      /** Konec poslední epizody s úhrnem ≥ minTotal */
      since: number
      lastEvent: RainEvent
      /** Právě slabě prší/mrholí, ale epizoda zatím nedosáhla minTotal */
      drizzleNow: boolean
      /** Součet délek chybějících dat od posledního deště (ms) */
      missingMs: number
    }
  | {
      kind: 'unknown'
      /** V dostupných datech (od `coveredFrom`) žádný déšť s úhrnem ≥ minTotal nebyl */
      coveredFrom: number | null
    }

/**
 * Stav „prší / bez deště“ k okamžiku `now`.
 * Prší = poslední dostupný interval je mokrý a epizoda má úhrn ≥ minTotal.
 * Bez deště = čas od konce poslední epizody s úhrnem ≥ minTotal.
 */
export function rainState(samples: PrecipSample[], now: number, minTotal = WET_MIN_MM, mergeGap = DEFAULT_MERGE_GAP): RainState {
  const past = samples.filter((s) => s.t <= now).sort((a, b) => a.t - b.t)
  if (!past.length) return { kind: 'unknown', coveredFrom: null }
  const events = buildRainEvents(past, mergeGap)
  const lastSample = past[past.length - 1]
  const ongoing = events.length && isWet(lastSample) ? events[events.length - 1] : null

  if (ongoing && ongoing.total >= minTotal - EPS) {
    return { kind: 'raining', since: ongoing.start, total: ongoing.total, startSrc: ongoing.startSrc, src: lastSample.src }
  }
  const qualifying = events.filter((e) => e !== ongoing && e.total >= minTotal - EPS)
  const last = qualifying[qualifying.length - 1]
  if (!last) return { kind: 'unknown', coveredFrom: past[0].t - past[0].dur }
  const missingMs = findGaps(past, last.end, lastSample.t).reduce((s, g) => s + (g.to - g.from), 0)
  return { kind: 'dry', since: last.end, lastEvent: last, drizzleNow: !!ongoing, missingMs }
}

export interface ForecastPrecip extends PrecipSample {
  /** Pravděpodobnost srážek v daném intervalu (%), pokud je k dispozici */
  prob?: number | null
}

/** První budoucí mokrý interval → začátek očekávaného deště */
export function nextRain(forecast: ForecastPrecip[], now: number): { at: number; mm: number; prob: number | null } | null {
  for (const s of [...forecast].sort((a, b) => a.t - b.t)) {
    if (s.t <= now) continue
    if (isWet(s)) return { at: Math.max(now, s.t - s.dur), mm: s.mm, prob: s.prob ?? null }
  }
  return null
}

/** Kdy podle předpovědi skončí právě probíhající déšť (konec posledního mokrého intervalu) */
export function expectedRainEnd(forecast: ForecastPrecip[], now: number, mergeGap = DEFAULT_MERGE_GAP): number | null {
  let end: number | null = null
  for (const s of [...forecast].sort((a, b) => a.t - b.t)) {
    if (s.t <= now) continue
    if (isWet(s)) {
      if (end !== null && s.t - s.dur - end > mergeGap + EPS) break
      end = s.t
    } else if (end === null) {
      // První budoucí interval je suchý → déšť končí s aktuálním intervalem
      return now
    } else if (s.t - s.dur - end > mergeGap + EPS) {
      break
    }
  }
  return end
}

/** Dny bez srážek z denních úhrnů (pro dlouhá sucha mimo dosah 10min dat) */
export function lastWetDay(daily: { date: string; mm: number | null }[], minTotal = WET_MIN_MM): string | null {
  for (let i = daily.length - 1; i >= 0; i--) {
    const v = daily[i].mm
    if (v != null && v >= minTotal - EPS) return daily[i].date
  }
  return null
}

/** Hranice pravděpodobnosti, od které aplikace ukazuje šanci na srážky (stejná jako v hodinové předpovědi) */
export const CHANCE_MIN_PROB = 10

export interface HourChance {
  /** Konec hodinového intervalu (ms) – stejný čas, pod kterým hodinu ukazuje hodinová předpověď */
  t: number
  prob: number | null
  mm: number | null
}

/**
 * Nejbližší hodina, kdy může pršet: pravděpodobnost ≥ 10 % NEBO model počítá s ≥ 0,1 mm.
 * Odpovídá tomu, co uživatel vidí v hodinové předpovědi (procenta u kapky).
 */
export function nextRainChance(hours: HourChance[], now: number, minProb = CHANCE_MIN_PROB): HourChance | null {
  for (const h of [...hours].sort((a, b) => a.t - b.t)) {
    if (h.t <= now) continue
    if ((h.prob ?? 0) >= minProb || (h.mm ?? 0) >= WET_MIN_MM - EPS) return h
  }
  return null
}
