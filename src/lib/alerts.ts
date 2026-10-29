// Pravidla upozornění (notifikace ntfy). Čisté funkce bez síťových volání, aby šly testovat.

import { ALERT_RULES as R } from '../config.ts'
import type { WarningItem } from './dataTypes.ts'
import { kmh, num, temp } from './format.ts'
import { mean } from './stats.ts'
import { addDays, DAY, formatDayMonth, formatMoment, formatTime, formatWeekdayLong, HOUR, localDateKey, localMidnight, localParts } from './time.ts'
import { isFreezingPrecip, isThunder, wmoLabel } from './wmo.ts'

type Arr = (number | null)[]

export interface AlertForecast {
  hourly: { time: number[]; temperature_2m: Arr; precipitation: Arr; rain: Arr; weather_code: Arr; wind_gusts_10m: Arr }
  daily: {
    time: number[]
    temperature_2m_max: Arr
    temperature_2m_min: Arr
    precipitation_sum: Arr
    precipitation_probability_max: Arr
    weather_code: Arr
    wind_gusts_10m_max: Arr
  }
}

export interface AlertAir {
  hourly: { time: number[]; pm10: Arr; pm2_5: Arr; european_aqi: Arr }
}

export interface AlertInput {
  now: number
  forecast: AlertForecast
  air?: AlertAir | null
  warnings?: WarningItem[]
}

export interface Alert {
  /** Klíč pro deduplikaci (typ + datum / id výstrahy) */
  key: string
  title: string
  message: string
  /** ntfy priorita 1 (min) – 5 (max) */
  priority: 1 | 2 | 3 | 4 | 5
  tags: string[]
}

const hoursBetween = (f: AlertForecast, from: number, to: number) =>
  f.hourly.time.map((t, i) => ({ t, i })).filter(({ t }) => t > from && t <= to)

/** Minimum teploty v noci končící ráno dne `date` (18:00 předchozího dne – 9:00) */
export function nightMin(f: AlertForecast, date: string): { value: number; at: number } | null {
  const end = localMidnight(date) + 9 * HOUR
  const start = localMidnight(addDays(date, -1)) + 18 * HOUR
  let best: { value: number; at: number } | null = null
  for (const { t, i } of hoursBetween(f, start - 1, end)) {
    const v = f.hourly.temperature_2m[i]
    if (v != null && (best === null || v < best.value)) best = { value: v, at: t }
  }
  return best
}

export function evaluateAlerts({ now, forecast: f, air, warnings = [] }: AlertInput): Alert[] {
  const out: Alert[] = []
  const today = localDateKey(now)
  const tomorrow = addDays(today, 1)
  const next24 = hoursBetween(f, now, now + 24 * HOUR)

  // Mráz: noci, které ještě nezačaly skončit (ráno dnes, pokud je před 9:00, a ráno zítra)
  const nights = localParts(now).hour < 9 ? [today, tomorrow] : [tomorrow]
  for (const date of nights) {
    const m = nightMin(f, date)
    if (!m) continue
    const prev = nightMin(f, addDays(date, -1))
    if (m.value <= R.strongFrostAtOrBelow) {
      out.push({
        key: `strongfrost:${date}`,
        title: 'Silný mráz',
        message: `V noci klesne teplota až na ${temp(m.value)} (kolem ${formatTime(m.at)}). Chraňte vodovodní potrubí a rostliny.`,
        priority: 4,
        tags: ['cold_face'],
      })
    } else if (m.value < R.frostBelow && !(prev && prev.value < R.frostBelow)) {
      // Jen nástup mrazivých nocí – v zimě by jinak upozornění chodilo každý den
      out.push({
        key: `frost:${date}`,
        title: 'Mráz',
        message: `${date === today ? 'Dnes v noci' : 'V noci na zítra'} až ${temp(m.value)} kolem ${formatTime(m.at)}. První mrazivá noc – pozor na námrazu na autě a choulostivé rostliny.`,
        priority: 3,
        tags: ['snowflake'],
      })
    }
  }

  // Náledí: mrznoucí srážky nebo déšť při teplotě ≤ 0 °C
  const glaze = next24.find(({ i }) => isFreezingPrecip(f.hourly.weather_code[i]) || ((f.hourly.rain[i] ?? 0) > 0 && (f.hourly.temperature_2m[i] ?? 99) <= 0))
  if (glaze) {
    out.push({
      key: `glaze:${localDateKey(glaze.t)}`,
      title: 'Hrozí náledí',
      message: `${formatMoment(glaze.t, now)}: ${wmoLabel(f.hourly.weather_code[glaze.i])} při ${temp(f.hourly.temperature_2m[glaze.i])}. Silnice a chodníky mohou namrzat.`,
      priority: 4,
      tags: ['warning', 'ice_cube'],
    })
  }

  // Prudké ochlazení o ≥ 10 °C za 24 h (v příštích 48 h)
  const T = f.hourly.temperature_2m
  for (const { t, i } of hoursBetween(f, now, now + 24 * HOUR)) {
    const j = f.hourly.time.indexOf(t + DAY)
    if (j < 0 || T[i] == null || T[j] == null) continue
    if (T[i]! - T[j]! >= R.tempDrop24h) {
      out.push({
        key: `drop:${localDateKey(t + DAY)}`,
        title: 'Prudké ochlazení',
        message: `Teplota klesne z ${temp(T[i])} (${formatMoment(t, now)}) na ${temp(T[j])} (${formatMoment(t + DAY, now)}).`,
        priority: 3,
        tags: ['thermometer'],
      })
      break
    }
  }

  // Bouřka v příštích 24 h
  const storm = next24.find(({ i }) => isThunder(f.hourly.weather_code[i]))
  if (storm) {
    out.push({
      key: `storm:${localDateKey(storm.t)}`,
      title: 'Bouřky',
      message: `${wmoLabel(f.hourly.weather_code[storm.i])} očekávána ${formatMoment(storm.t - HOUR, now)}.`,
      priority: 4,
      tags: ['zap'],
    })
  }

  // Silný déšť: hodinový úhrn
  const heavyHour = next24.find(({ i }) => (f.hourly.precipitation[i] ?? 0) >= R.hourlyRainAtLeast)
  if (heavyHour) {
    out.push({
      key: `rainhour:${localDateKey(heavyHour.t)}`,
      title: 'Přívalový déšť',
      message: `${formatMoment(heavyHour.t - HOUR, now)}: až ${num(f.hourly.precipitation[heavyHour.i], 1)} mm za hodinu.`,
      priority: 4,
      tags: ['cloud_with_rain'],
    })
  }

  // Silný déšť: denní úhrn dnes a zítra
  for (const date of [today, tomorrow]) {
    const i = f.daily.time.findIndex((t) => localDateKey(t) === date)
    const sum = i >= 0 ? f.daily.precipitation_sum[i] : null
    if (sum != null && sum >= R.dailyRainAtLeast) {
      out.push({
        key: `rainday:${date}`,
        title: 'Vydatné srážky',
        message: `${date === today ? 'Dnes' : 'Zítra'} spadne kolem ${num(sum, 0)} mm srážek (pravděpodobnost ${num(f.daily.precipitation_probability_max[i], 0)} %).`,
        priority: 3,
        tags: ['umbrella'],
      })
    }
  }

  // Silný vítr
  let gust: { t: number; v: number } | null = null
  for (const { t, i } of next24) {
    const v = f.hourly.wind_gusts_10m[i]
    if (v != null && v >= R.gustAtLeast && (!gust || v > gust.v)) gust = { t, v }
  }
  if (gust) {
    out.push({
      key: `gust:${localDateKey(gust.t)}`,
      title: 'Silný vítr',
      message: `Nárazy větru až ${kmh(gust.v)} (${num(gust.v / 3.6, 0)} m/s), nejsilnější ${formatMoment(gust.t, now)}.`,
      priority: gust.v >= 90 ? 5 : 4,
      tags: ['dash', 'wind_face'],
    })
  }

  // Smog: denní průměry PM10 / PM2,5 dnes a zítra (jen pro dny s aspoň 18 hodinovými hodnotami)
  if (air) {
    for (const date of [today, tomorrow]) {
      const idx = air.hourly.time.map((t, i) => ({ t, i })).filter(({ t }) => localDateKey(t - 1) === date)
      const pm10 = idx.map(({ i }) => air.hourly.pm10[i]).filter((v): v is number => v != null)
      const pm25 = idx.map(({ i }) => air.hourly.pm2_5[i]).filter((v): v is number => v != null)
      if (pm10.length < 18) continue
      const m10 = mean(pm10)!
      const m25 = pm25.length >= 18 ? mean(pm25)! : null
      if (m10 > R.pm10DailyAbove || (m25 != null && m25 > R.pm25DailyAbove)) {
        out.push({
          key: `smog:${date}`,
          title: 'Zhoršená kvalita ovzduší',
          message: `${date === today ? 'Dnes' : 'Zítra'} průměrně PM10 ${num(m10, 0)} µg/m³ (limit 50)${m25 != null ? `, PM2,5 ${num(m25, 0)} µg/m³ (limit 25)` : ''}. Omezte pobyt venku a větrání.`,
          priority: m10 > 100 ? 4 : 3,
          tags: ['mask'],
        })
      }
    }
  }

  // Oficiální výstrahy ČHMÚ
  for (const w of warnings) {
    if (Date.parse(w.expires) <= now) continue
    const color = { yellow: 'žlutá', orange: 'oranžová', red: 'červená', unknown: '' }[w.level]
    out.push({
      key: `warn:${w.id}`,
      title: `Výstraha ČHMÚ: ${w.event}`,
      message: `${color ? `${color[0].toUpperCase()}${color.slice(1)} výstraha. ` : ''}Od ${formatMoment(Date.parse(w.onset), now)} do ${formatMoment(Date.parse(w.expires), now)}.\n${w.description}`.trim(),
      priority: w.level === 'red' ? 5 : w.level === 'orange' ? 4 : 3,
      tags: ['rotating_light'],
    })
  }

  return out
}

/** Ranní souhrn dne */
export function morningSummary(input: AlertInput, extra: { stationNightMin?: number | null; rainLine?: string | null } = {}): Alert | null {
  const { now, forecast: f } = input
  const today = localDateKey(now)
  const i = f.daily.time.findIndex((t) => localDateKey(t) === today)
  if (i < 0) return null
  const lines = [
    `${wmoLabel(f.daily.weather_code[i])}, ${temp(f.daily.temperature_2m_min[i], 0)} až ${temp(f.daily.temperature_2m_max[i], 0)}.`,
    `Srážky ${num(f.daily.precipitation_sum[i], 1)} mm (pravděpodobnost ${num(f.daily.precipitation_probability_max[i], 0)} %), nárazy větru až ${kmh(f.daily.wind_gusts_10m_max[i])}.`,
  ]
  if (extra.stationNightMin != null) lines.push(`V noci naměřeno minimum ${temp(extra.stationNightMin)} (ČHMÚ Karviná).`)
  if (extra.rainLine) lines.push(extra.rainLine)
  if (input.air) {
    const aqi = input.air.hourly.time.map((t, k) => ({ t, v: input.air!.hourly.european_aqi[k] })).filter((x) => localDateKey(x.t - 1) === today && x.v != null)
    const peak = aqi.reduce<number | null>((m, x) => (m == null || x.v! > m ? x.v! : m), null)
    if (peak != null) lines.push(`Kvalita ovzduší: index až ${num(peak, 0)}${peak > 60 ? ' (špatná)' : peak > 40 ? ' (střední)' : ''}.`)
  }
  const active = (input.warnings ?? []).filter((w) => Date.parse(w.expires) > now)
  if (active.length) lines.push(`Platí ${active.length === 1 ? 'výstraha' : 'výstrahy'}: ${active.map((w) => w.event).join(', ')}.`)
  return { key: `summary:${today}`, title: `Počasí v Karviné – ${formatWeekdayLong(now)} ${formatDayMonth(now)}`, message: lines.join('\n'), priority: 2, tags: ['sunrise'] }
}

/** Je čas na ranní souhrn? (od 6:30 do 10:00 místního času; cron může mít zpoždění) */
export function isSummaryTime(now: number): boolean {
  const p = localParts(now)
  const minutes = p.hour * 60 + p.minute
  const { hour, minute, latestHour } = R.morningSummary
  return minutes >= hour * 60 + minute && p.hour < latestHour
}

export interface AlertState {
  /** Klíč → kdy byl odeslán (ISO) */
  sent: Record<string, string>
}

/** Vybere dosud neodeslaná upozornění */
export function newAlerts(alerts: Alert[], state: AlertState): Alert[] {
  const seen = new Set<string>()
  return alerts.filter((a) => {
    if (state.sent[a.key] || seen.has(a.key)) return false
    seen.add(a.key)
    return true
  })
}

/** Zaznamená odeslání a smaže záznamy starší než 14 dní */
export function recordSent(state: AlertState, keys: string[], now: number): AlertState {
  const sent: Record<string, string> = {}
  for (const [k, v] of Object.entries(state.sent)) if (now - Date.parse(v) < 14 * DAY) sent[k] = v
  for (const k of keys) sent[k] = new Date(now).toISOString()
  return { sent }
}
