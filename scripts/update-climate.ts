// Denní klimatologické řady:
//  - station-daily.json  stanice ČHMÚ Karviná (od 1877, s mezerami): Tmax, Tmin, průměr, srážky, sníh
//  - era5-daily.json     reanalýza ERA5 (Open-Meteo, od 1940, souvislá)
//
// Historický soubor ČHMÚ (60 MB) se stahuje jen při prvním běhu, s --full nebo jednou za 30 dní.
// Jinak se doplňují jen letošní měsíce z recent/. Nové hodnoty přepisují staré, chybějící (null) nikdy nepřepíše známou.
//
// Spuštění: node scripts/update-climate.ts [--full]

import { API, LOCATION } from '../src/config.ts'
import type { ClimVar, DailySeries } from '../src/lib/climate.ts'
import type { MetaFile } from '../src/lib/dataTypes.ts'
import { addDays, daysBetween, localDateKey } from '../src/lib/time.ts'
import { type ChmiRow, fetchChmi, WSI } from './lib/chmi.ts'
import { fetchJson, log, readJson, touchMeta, writeJson } from './lib/io.ts'

/** Prvek ČHMÚ + typ hodnoty (VTYPE) → proměnná řady. Konvence ověřeny proti 10min/hodinovým datům. */
const CHMI_MAP: { element: string; vtype: string; v: ClimVar }[] = [
  { element: 'TMA', vtype: '20:00', v: 'tmax' }, // max za 21–21 h SEČ končící dnem D
  { element: 'TMI', vtype: '20:00', v: 'tmin' },
  { element: 'T', vtype: 'AVG', v: 'tmean' },
  { element: 'SRA', vtype: '06:00', v: 'prcp' }, // úhrn 7:00 dne D → 7:00 dne D+1
  { element: 'SCE', vtype: '06:00', v: 'snowDepth' }, // výška sněhu v 7:00 (cm)
  { element: 'SNO', vtype: '06:00', v: 'snow' }, // nový sníh (cm)
]

type ValueMap = Map<ClimVar, Map<string, number | null>>

function seriesToMap(s: DailySeries | null): ValueMap {
  const m: ValueMap = new Map()
  if (!s) return m
  for (const [v, arr] of Object.entries(s.vars) as [ClimVar, (number | null)[]][]) {
    const vm = new Map<string, number | null>()
    arr.forEach((val, i) => vm.set(addDays(s.start, i), val))
    m.set(v, vm)
  }
  return m
}

function setValue(m: ValueMap, v: ClimVar, date: string, value: number | null) {
  let vm = m.get(v)
  if (!vm) m.set(v, (vm = new Map()))
  if (value != null || !vm.has(date)) vm.set(date, value)
}

export function mapToSeries(m: ValueMap, source: DailySeries['source']): DailySeries | null {
  let start: string | null = null
  let end: string | null = null
  for (const vm of m.values())
    for (const [d, val] of vm) {
      if (val == null) continue
      if (start === null || d < start) start = d
      if (end === null || d > end) end = d
    }
  if (!start || !end) return null
  const n = daysBetween(start, end) + 1
  const vars: DailySeries['vars'] = {}
  for (const [v, vm] of m) {
    const arr: (number | null)[] = new Array(n).fill(null)
    let any = false
    for (const [d, val] of vm) {
      const i = daysBetween(start, d)
      if (i < 0 || i >= n || val == null) continue
      arr[i] = Math.round(val * 10) / 10
      any = true
    }
    if (any) vars[v] = arr
  }
  return { start, end, source, vars, updated: new Date().toISOString() }
}

export function applyChmiRows(m: ValueMap, rows: ChmiRow[]): number {
  let n = 0
  for (const r of rows) {
    const map = CHMI_MAP.find((x) => x.element === r.element && x.vtype === r.vtype)
    if (!map) continue
    // „Neměřitelné množství“ srážky (příznak T) je pro účely sucha 0 mm
    const value = r.value ?? (map.v === 'prcp' && r.flag === 'T' ? 0 : null)
    setValue(m, map.v, r.date, value)
    n++
  }
  return n
}

async function updateStation(full: boolean) {
  const existing = readJson<DailySeries>('station-daily.json')
  const meta = readJson<MetaFile>('meta.json') ?? {}
  const lastFull = meta.stationDailyFull ? Date.parse(meta.stationDailyFull) : 0
  const doFull = full || !existing || Date.now() - lastFull > 30 * 86_400_000
  const m = seriesToMap(existing)

  if (doFull) {
    log('Stahuji historický denní soubor ČHMÚ (≈60 MB)…')
    const rows = await fetchChmi(`historical/data/daily/dly-${WSI}.json`)
    if (!rows) throw new Error('Historický soubor ČHMÚ nenalezen')
    log('historical: řádků', rows.length, 'použito', applyChmiRows(m, rows))
  }

  // Letošní rok z recent/: dokončené měsíce v podsložkách MM/, aktuální (a minulý) měsíc v kořeni.
  // Minulý měsíc se bere i přes přelom roku – data za 31. 12. vycházejí až 1. 1.
  const today = localDateKey(Date.now())
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const pad = (n: number) => String(n).padStart(2, '0')
  const prev: [number, number] = month === 1 ? [year - 1, 12] : [year, month - 1]
  const months: [number, number][] = doFull ? Array.from({ length: month }, (_, i) => [year, i + 1] as [number, number]) : []
  if (!months.some(([y, m]) => y === prev[0] && m === prev[1])) months.unshift(prev)
  if (!months.some(([y, m]) => y === year && m === month)) months.push([year, month])
  for (const [y, mo] of months) {
    for (const path of [`recent/data/daily/${pad(mo)}/dly-${WSI}-${y}${pad(mo)}.json`, `recent/data/daily/dly-${WSI}-${y}${pad(mo)}.json`]) {
      const rows = await fetchChmi(path)
      if (rows) log(path, 'použito', applyChmiRows(m, rows))
    }
  }

  const series = mapToSeries(m, 'chmi')
  if (!series) throw new Error('Řada stanice je prázdná')
  writeJson('station-daily.json', series)
  log('station-daily.json', series.start, '→', series.end, Object.keys(series.vars).join(','))
  touchMeta('stationDaily')
  if (doFull) touchMeta('stationDailyFull')
}

interface ArchiveResponse {
  daily: {
    time: string[]
    temperature_2m_max: (number | null)[]
    temperature_2m_min: (number | null)[]
    temperature_2m_mean: (number | null)[]
    precipitation_sum: (number | null)[]
    snowfall_sum: (number | null)[]
  }
}

async function updateEra5(full: boolean) {
  const existing = readJson<DailySeries>('era5-daily.json')
  const meta = readJson<MetaFile>('meta.json') ?? {}
  const lastFull = meta.era5Full ? Date.parse(meta.era5Full) : 0
  const doFull = full || !existing || Date.now() - lastFull > 30 * 86_400_000
  const m = seriesToMap(existing)
  const end = addDays(localDateKey(Date.now()), -1)
  const start = doFull ? '1940-01-01' : addDays(end, -90)
  const url =
    `${API.archive}?latitude=${LOCATION.latitude}&longitude=${LOCATION.longitude}&timezone=${encodeURIComponent(LOCATION.timezone)}` +
    `&start_date=${start}&end_date=${end}&models=era5` +
    '&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,snowfall_sum'
  log('ERA5', start, '→', end)
  const r = await fetchJson<ArchiveResponse>(url)
  const d = r.daily
  d.time.forEach((date, i) => {
    setValue(m, 'tmax', date, d.temperature_2m_max[i])
    setValue(m, 'tmin', date, d.temperature_2m_min[i])
    setValue(m, 'tmean', date, d.temperature_2m_mean[i])
    setValue(m, 'prcp', date, d.precipitation_sum[i])
    setValue(m, 'snow', date, d.snowfall_sum[i])
  })
  const series = mapToSeries(m, 'era5')
  if (!series) throw new Error('Řada ERA5 je prázdná')
  writeJson('era5-daily.json', series)
  log('era5-daily.json', series.start, '→', series.end)
  touchMeta('era5')
  if (doFull) touchMeta('era5Full')
}

/** Je potřeba aktualizovat? (chybí soubor nebo je starší než 20 h) – odolné vůči vynechaným během plánovače */
function isStale(): boolean {
  const meta = readJson<MetaFile>('meta.json') ?? {}
  const age = (iso?: string) => (iso ? Date.now() - Date.parse(iso) : Infinity)
  return !readJson('station-daily.json') || !readJson('era5-daily.json') || age(meta.stationDaily) > 20 * 3_600_000 || age(meta.era5) > 20 * 3_600_000
}

async function main() {
  const full = process.argv.includes('--full')
  if (!full && process.argv.includes('--if-stale') && !isStale()) {
    log('Klimatické řady jsou aktuální (mladší než 20 h), přeskakuji.')
    return
  }
  let failed = false
  for (const [name, fn] of [
    ['stanice', updateStation],
    ['ERA5', updateEra5],
  ] as const) {
    try {
      await fn(full)
    } catch (e) {
      failed = true
      console.error(`Aktualizace ${name} selhala:`, e)
    }
  }
  if (failed) process.exit(1)
}

if (import.meta.main) main()
