// Dotazy na Open-Meteo. Používáme timeformat=unixtime, aby časy byly jednoznačné i přes změnu času;
// timezone=Europe/Prague zajistí, že denní agregace (max/min, úhrn) odpovídají místním dnům.

import { API, LOCATION, MODELS } from '../config.ts'
import { percentile } from '../lib/stats.ts'

const base = () =>
  `latitude=${LOCATION.latitude}&longitude=${LOCATION.longitude}&timezone=${encodeURIComponent(LOCATION.timezone)}&timeformat=unixtime`

type Arr = (number | null)[]

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    let reason = ''
    try {
      reason = ((await res.json()) as { reason?: string }).reason ?? ''
    } catch {
      /* tělo není JSON */
    }
    throw new Error(`Open-Meteo HTTP ${res.status}${reason ? `: ${reason}` : ''}`)
  }
  return (await res.json()) as T
}

/** Převod unix sekund na ms */
const ms = (arr: number[]) => arr.map((t) => t * 1000)

// ---------------------------------------------------------------- Předpověď

const CURRENT = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m', 'weather_code', 'is_day',
  'precipitation', 'rain', 'snowfall', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m',
  'wind_gusts_10m', 'visibility', 'uv_index',
] as const
const HOURLY = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m', 'precipitation',
  'precipitation_probability', 'rain', 'snowfall', 'weather_code', 'pressure_msl', 'cloud_cover', 'cloud_cover_low',
  'cloud_cover_mid', 'cloud_cover_high', 'visibility', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  'uv_index', 'is_day',
] as const
const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean', 'apparent_temperature_max',
  'apparent_temperature_min', 'sunrise', 'sunset', 'daylight_duration', 'sunshine_duration', 'uv_index_max',
  'precipitation_sum', 'rain_sum', 'snowfall_sum', 'precipitation_hours', 'precipitation_probability_max',
  'wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant',
] as const

export type CurrentVar = (typeof CURRENT)[number]
export type HourlyVar = (typeof HOURLY)[number]
export type DailyVar = (typeof DAILY)[number]

export interface Forecast {
  /** Okamžik platnosti aktuálních hodnot (ms) */
  currentTime: number
  current: Record<CurrentVar, number | null>
  minutely15: { time: number[]; precipitation: Arr }
  hourly: { time: number[] } & Record<HourlyVar, Arr>
  daily: { time: number[] } & Record<DailyVar, Arr>
  elevation: number
  fetchedAt: number
}

/** Kolik dní historie modelu načíst (záloha pro „Bez deště“, když chybí data stanice) */
export const FORECAST_PAST_DAYS = 7

interface RawForecast {
  elevation: number
  current: Record<string, number | null> & { time: number }
  minutely_15: { time: number[]; precipitation: Arr }
  hourly: Record<string, Arr> & { time: number[] }
  daily: Record<string, Arr> & { time: number[] }
}

export async function fetchForecast(signal?: AbortSignal): Promise<Forecast> {
  const url =
    `${API.forecast}?${base()}&current=${CURRENT.join(',')}&hourly=${HOURLY.join(',')}&daily=${DAILY.join(',')}` +
    `&minutely_15=precipitation&past_minutely_15=96&forecast_minutely_15=96&past_days=${FORECAST_PAST_DAYS}&forecast_days=16`
  const r = await getJson<RawForecast>(url, signal)
  const { time: ct, ...current } = r.current
  const hourly = { ...r.hourly, time: ms(r.hourly.time) } as Forecast['hourly']
  const daily = { ...r.daily, time: ms(r.daily.time) } as Forecast['daily']
  // sunrise/sunset jsou v unix sekundách
  daily.sunrise = daily.sunrise.map((t) => (t == null ? null : t * 1000))
  daily.sunset = daily.sunset.map((t) => (t == null ? null : t * 1000))
  return {
    currentTime: ct * 1000,
    current: current as Forecast['current'],
    minutely15: { time: ms(r.minutely_15.time), precipitation: r.minutely_15.precipitation },
    hourly,
    daily,
    elevation: r.elevation,
    fetchedAt: Date.now(),
  }
}

// ---------------------------------------------------------------- Srovnání modelů

export interface ModelRun {
  id: string
  hourly: { temperature_2m: Arr; precipitation: Arr; wind_gusts_10m: Arr; weather_code: Arr }
  daily: { temperature_2m_max: Arr; temperature_2m_min: Arr; precipitation_sum: Arr; wind_gusts_10m_max: Arr }
}

export interface ModelsForecast {
  hourlyTime: number[]
  dailyTime: number[]
  models: ModelRun[]
  fetchedAt: number
}

export async function fetchModels(signal?: AbortSignal): Promise<ModelsForecast> {
  const hv = ['temperature_2m', 'precipitation', 'wind_gusts_10m', 'weather_code'] as const
  const dv = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_gusts_10m_max'] as const
  const url = `${API.forecast}?${base()}&hourly=${hv.join(',')}&daily=${dv.join(',')}&forecast_days=10&models=${MODELS.map((m) => m.id).join(',')}`
  const r = await getJson<{ hourly: Record<string, Arr> & { time: number[] }; daily: Record<string, Arr> & { time: number[] } }>(url, signal)
  const models: ModelRun[] = MODELS.map((m) => ({
    id: m.id,
    hourly: Object.fromEntries(hv.map((v) => [v, r.hourly[`${v}_${m.id}`] ?? []])) as ModelRun['hourly'],
    daily: Object.fromEntries(dv.map((v) => [v, r.daily[`${v}_${m.id}`] ?? []])) as ModelRun['daily'],
  }))
  return { hourlyTime: ms(r.hourly.time), dailyTime: ms(r.daily.time), models, fetchedAt: Date.now() }
}

// ---------------------------------------------------------------- Ensemble (nejistota)

export interface Ensemble {
  time: number[]
  /** Teplota: 10., 50. a 90. percentil přes členy ensemblu */
  t10: Arr
  t50: Arr
  t90: Arr
  /** Pravděpodobnost srážek ≥ 0,1 mm/h (% členů) */
  precipProb: Arr
  members: number
  fetchedAt: number
}

export async function fetchEnsemble(signal?: AbortSignal): Promise<Ensemble> {
  const url = `${API.ensemble}?${base()}&hourly=temperature_2m,precipitation&models=ecmwf_ifs025&forecast_days=15`
  const r = await getJson<{ hourly: Record<string, Arr> & { time: number[] } }>(url, signal)
  const tKeys = Object.keys(r.hourly).filter((k) => /^temperature_2m(_member\d+)?$/.test(k))
  const pKeys = Object.keys(r.hourly).filter((k) => /^precipitation(_member\d+)?$/.test(k))
  const n = r.hourly.time.length
  const t10: Arr = []
  const t50: Arr = []
  const t90: Arr = []
  const precipProb: Arr = []
  for (let i = 0; i < n; i++) {
    const ts = tKeys.map((k) => r.hourly[k][i])
    t10.push(percentile(ts, 10))
    t50.push(percentile(ts, 50))
    t90.push(percentile(ts, 90))
    const ps = pKeys.map((k) => r.hourly[k][i]).filter((v): v is number => v != null)
    precipProb.push(ps.length ? (ps.filter((v) => v >= 0.1).length / ps.length) * 100 : null)
  }
  return { time: ms(r.hourly.time), t10, t50, t90, precipProb, members: tKeys.length, fetchedAt: Date.now() }
}

// ---------------------------------------------------------------- Kvalita ovzduší a pyl (CAMS)

export const AIR_VARS = [
  'european_aqi', 'pm10', 'pm2_5', 'nitrogen_dioxide', 'ozone', 'sulphur_dioxide', 'carbon_monoxide',
  'alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'ragweed_pollen',
] as const
export type AirVar = (typeof AIR_VARS)[number]

export interface Air {
  currentTime: number
  current: Record<AirVar, number | null>
  hourly: { time: number[] } & Record<AirVar, Arr>
  fetchedAt: number
}

export async function fetchAir(signal?: AbortSignal): Promise<Air> {
  const url = `${API.airQuality}?${base()}&current=${AIR_VARS.join(',')}&hourly=${AIR_VARS.join(',')}&past_days=1&forecast_days=5`
  const r = await getJson<{ current: Record<string, number | null> & { time: number }; hourly: Record<string, Arr> & { time: number[] } }>(url, signal)
  const { time, ...current } = r.current
  return {
    currentTime: time * 1000,
    current: current as Air['current'],
    hourly: { ...r.hourly, time: ms(r.hourly.time) } as Air['hourly'],
    fetchedAt: Date.now(),
  }
}

// ---------------------------------------------------------------- Pomůcky nad řadami

/** Index posledního prvku s časem ≤ t (pro hodinová data = hodina, ve které je t) */
export function indexAtOrBefore(time: number[], t: number): number {
  let lo = 0
  let hi = time.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (time[mid] <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
