// Časová osa „naměřeno → předpověď“ pro graf na stránce Dnes.
// Vše leží na jedné hodinové mřížce, aby odečet prstem ukazoval teplotu i srážky vždy pro stejnou hodinu.
// Konvence jako v hodinové předpovědi: hodina „14:00“ = teplota ve 14:00 a srážky za 14:00–15:00.

import { HOUR, MINUTE } from './time.ts'

export type Src = 'measured' | 'forecast'

export interface TimelineHour {
  /** Celá hodina (ms) */
  t: number
  temp: number | null
  tempSrc: Src | null
  /** U předpovědi: surová hodnota modelu (před napojením na měření) */
  modelTemp: number | null
  /** Srážky za hodinu t → t + 1 h (mm) */
  mm: number | null
  mmSrc: Src | null
  /** Pravděpodobnost srážek v hodině t → t + 1 h (%), jen předpověď */
  prob: number | null
}

export interface Timeline {
  from: number
  to: number
  now: number
  /** Čas posledního měření teploty (null = žádné) */
  lastObs: number | null
  hours: TimelineHour[]
  /** Naměřená teplota po 10 min (null = výpadek, čára se přeruší) */
  measured: [number, number | null][]
  /** Předpověď teploty: začíná posledním měřením, pak celé hodiny (napojená na měření) */
  forecast: [number, number][]
  /** O kolik se model v čase posledního měření lišil od skutečnosti (měření − model, °C) */
  offset: number | null
}

export interface StationSeries {
  start: number
  step: number
  T: (number | null)[]
  SRA: (number | null)[]
}

export interface HourlyForecast {
  time: number[]
  temperature_2m: (number | null)[]
  /** Open-Meteo: srážky za hodinu PŘEDCHÁZEJÍCÍ času time[i] */
  precipitation: (number | null)[]
  precipitation_probability: (number | null)[]
}

export interface TimelineOptions {
  back?: number
  ahead?: number
  /** Pevný rozsah (celé hodiny) místo back/ahead – např. jeden den v detailu předpovědi */
  from?: number
  to?: number
  /** Za jak dlouho se rozdíl model/měření úplně vytratí (ms) */
  blend?: number
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** Za jak dlouho se rozdíl mezi modelem a posledním měřením úplně vytratí */
export const TEMP_BLEND_MS = 6 * HOUR

/** Poslední naměřená teplota v 10min řadě stanice (do času `upTo`) */
export function lastTempObs(st: Pick<StationSeries, 'start' | 'step' | 'T'> | null | undefined, upTo = Infinity): { t: number; T: number } | null {
  if (!st) return null
  for (let i = st.T.length - 1; i >= 0; i--) {
    const t = st.start + i * st.step
    const v = st.T[i]
    if (v != null && t <= upTo) return { t, T: v }
  }
  return null
}

/**
 * Hodinová teplota modelu napojená na poslední měření: v čase měření se model posune na naměřenou
 * hodnotu a posun lineárně slábne do nuly za `blend`. Hodiny do měření (a bez měření) zůstávají beze změny.
 * Stejná funkce se používá ve všech kartách, aby teploty v aplikaci souhlasily.
 */
export function blendTemps(
  time: number[],
  temps: (number | null)[],
  anchor: { t: number; T: number } | null,
  blend: number = TEMP_BLEND_MS,
): { temps: (number | null)[]; offset: number | null } {
  const m0 = anchor ? interpHourly(time, temps, anchor.t) : null
  if (!anchor || m0 == null) return { temps, offset: null }
  const offset = anchor.T - m0
  return {
    offset,
    temps: temps.map((v, i) => {
      const t = time[i]
      if (v == null || t <= anchor.t) return v
      const w = Math.max(0, 1 - (t - anchor.t) / blend)
      return w > 0 ? round1(v + offset * w) : v
    }),
  }
}

/** Hodnota hodinové řady v čase t (lineární interpolace), null mimo rozsah nebo u chybějících hodnot */
export function interpHourly(time: number[], values: (number | null)[], t: number): number | null {
  if (!time.length || t < time[0] || t > time[time.length - 1]) return null
  let lo = 0
  let hi = time.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (time[mid] <= t) lo = mid
    else hi = mid
  }
  if (time[lo] === t) return values[lo] ?? null
  if (time[hi] === t) return values[hi] ?? null
  const a = values[lo]
  const b = values[hi]
  if (a == null || b == null) return null
  return a + ((b - a) * (t - time[lo])) / (time[hi] - time[lo])
}

export function buildTimeline(st: StationSeries | null | undefined, fc: HourlyForecast | null | undefined, now: number, opts: TimelineOptions = {}): Timeline {
  const { back = 24 * HOUR, ahead = 24 * HOUR, blend = TEMP_BLEND_MS } = opts
  const nowHour = Math.floor(now / HOUR) * HOUR
  const from = opts.from ?? nowHour - back
  const to = opts.to ?? nowHour + ahead

  // Naměřené hodnoty podle času
  const T = new Map<number, number | null>()
  const SRA = new Map<number, number | null>()
  let lastSra: number | null = null
  const anchor = lastTempObs(st, now)
  const lastObs = anchor?.t ?? null
  if (st) {
    st.T.forEach((v, i) => T.set(st.start + i * st.step, v))
    st.SRA.forEach((v, i) => {
      const t = st.start + i * st.step
      SRA.set(t, v)
      if (t <= now && (lastSra == null || t > lastSra)) lastSra = t
    })
  }
  const step = st?.step ?? 10 * MINUTE

  const model = (t: number) => (fc ? interpHourly(fc.time, fc.temperature_2m, t) : null)
  const obsT = anchor?.T ?? null
  // Předpověď napojená na měření – stejný výpočet jako hodinová předpověď a max/min dneška
  const bl = fc ? blendTemps(fc.time, fc.temperature_2m, anchor, blend) : null
  const offset = bl?.offset ?? null
  // Používá se jen v celých hodinách, kde se hodnota bere přímo z řady
  const blended = (t: number): number | null => (fc && bl ? interpHourly(fc.time, bl.temps, t) : null)

  // Srážky za hodinu t → t+1h z 10min dat (značky t+10 … t+60 min); jen když hodina celá proběhla
  const measuredMm = (t: number): number | null => {
    if (lastSra == null || t + HOUR > lastSra) return null
    let sum = 0
    let any = false
    for (let k = 1; k * step <= HOUR; k++) {
      const v = SRA.get(t + k * step)
      if (v != null) {
        sum += v
        any = true
      }
    }
    return any ? round1(sum) : null
  }
  const fcIndex = new Map<number, number>()
  fc?.time.forEach((t, i) => fcIndex.set(t, i))

  const hours: TimelineHour[] = []
  for (let t = from; t <= to; t += HOUR) {
    let temp: number | null = null
    let tempSrc: Src | null = null
    let modelTemp: number | null = null
    if (lastObs != null && t <= lastObs) {
      const v = T.get(t)
      if (v != null) {
        temp = v
        tempSrc = 'measured'
      }
    } else {
      const v = blended(t)
      if (v != null) {
        temp = v
        tempSrc = 'forecast'
        modelTemp = model(t)
      }
    }
    let mm: number | null = measuredMm(t)
    let mmSrc: Src | null = mm != null ? 'measured' : null
    let prob: number | null = null
    if (mm == null) {
      // Open-Meteo: hodnota v čase t+1h je za hodinu t → t+1h
      const i = fcIndex.get(t + HOUR)
      // Předpověď jen pro hodiny, které ještě nejsou změřené (ne pro staré výpadky stanice)
      if (i != null && fc && (lastSra == null || t + HOUR > lastSra)) {
        const v = fc.precipitation[i]
        if (v != null) {
          mm = v
          mmSrc = 'forecast'
        }
        prob = fc.precipitation_probability[i] ?? null
      }
    }
    hours.push({ t, temp, tempSrc, modelTemp, mm, mmSrc, prob })
  }

  const measured: [number, number | null][] = []
  if (st)
    for (let i = 0; i < st.T.length; i++) {
      const t = st.start + i * st.step
      if (t >= from && t <= now) measured.push([t, st.T[i]])
    }

  const forecast: [number, number][] = []
  const fStart = lastObs != null && lastObs >= from ? lastObs : from
  if (lastObs != null && obsT != null && lastObs >= from) forecast.push([lastObs, obsT])
  for (let t = Math.floor(fStart / HOUR) * HOUR + HOUR; t <= to; t += HOUR) {
    const v = blended(t)
    if (v != null) forecast.push([t, v])
  }
  return { from, to, now, lastObs, hours, measured, forecast, offset: offset == null ? null : round1(offset) }
}
