// Hodinová aktualizace měření stanice ČHMÚ Karviná:
//  - station-now.json  poslední měření, 48h průběh, souhrn dne
//  - station-sra10.json klouzavá zásoba 10min srážek (~120 dní) pro „čas od posledního deště“
//
// Spuštění: node scripts/update-station.ts [--bootstrap]

import { type ChmiRow, fetchChmi, listDir, WSI } from './lib/chmi.ts'
import { log, readJson, touchMeta, writeJson } from './lib/io.ts'
import type { StationNow, StationObs, StationSra10 } from '../src/lib/dataTypes.ts'
import { DAY, HOUR, localDateKey, localMidnight } from '../src/lib/time.ts'

const STEP = 10 * 60_000
const KEEP_DAYS = 120
const SERIES_HOURS = 48

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (ms: number) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/** Načte 10min data: z now/ (posledních ~3 dny) a při bootstrapu i z recent/ (měsíce letošního roku) */
async function load10min(bootstrap: boolean, now: number): Promise<ChmiRow[]> {
  const rows: ChmiRow[] = []
  const nowFiles = (await listDir('now/data/')).filter((f) => f.startsWith(`10m-${WSI}-`))
  if (!nowFiles.length) throw new Error('V now/data/ chybí 10min soubory stanice')
  for (const f of nowFiles) {
    const r = await fetchChmi(`now/data/${f}`)
    if (r) rows.push(...r)
    log('now', f, r?.length ?? 'nenalezeno')
  }
  if (bootstrap) {
    const from = now - KEEP_DAYS * DAY
    const cur = new Date(now)
    // Dny aktuálního měsíce (soubory po dnech v kořeni recent/data/10min/)
    const daily = (await listDir('recent/data/10min/')).filter((f) => f.startsWith(`10m-${WSI}-`) && /-\d{8}\.json$/.test(f))
    for (const f of daily) {
      const r = await fetchChmi(`recent/data/10min/${f}`)
      if (r) rows.push(...r)
      log('recent day', f, r?.length ?? 'nenalezeno')
    }
    // Dokončené měsíce letošního roku v podsložkách MM/
    for (let m = cur.getUTCMonth(); m >= 1; m--) {
      const monthEnd = Date.UTC(cur.getUTCFullYear(), m, 1)
      if (monthEnd < from) break
      const f = `recent/data/10min/${pad(m)}/10m-${WSI}-${cur.getUTCFullYear()}${pad(m)}.json`
      const r = await fetchChmi(f)
      if (r) rows.push(...r)
      log('recent month', f, r?.length ?? 'nenalezeno')
    }
  }
  return rows
}

export function mergeSra(store: StationSra10 | null, rows: ChmiRow[], now: number): StationSra10 {
  const map = new Map<number, number | null>()
  if (store) store.values.forEach((v, i) => map.set(store.start + i * store.step, v))
  for (const r of rows) {
    if (r.element !== 'SRA10M' || !Number.isFinite(r.t)) continue
    // Novější soubor přepíše starší hodnotu, ale chybějící hodnota (null) nepřepíše známou
    if (r.value != null || !map.has(r.t)) map.set(r.t, r.value)
  }
  const keepFrom = now - KEEP_DAYS * DAY
  const times = [...map.keys()].filter((t) => t >= keepFrom && t <= now + HOUR && t % STEP === 0).sort((a, b) => a - b)
  if (!times.length) return { start: keepFrom - (keepFrom % STEP), step: STEP, values: [], updated: new Date(now).toISOString() }
  const start = times[0]
  const end = times[times.length - 1]
  const values: (number | null)[] = []
  for (let t = start; t <= end; t += STEP) values.push(map.get(t) ?? null)
  return { start, step: STEP, values, updated: new Date(now).toISOString() }
}

export function buildNow(rows: ChmiRow[], now: number): StationNow {
  const byEl = new Map<string, Map<number, number | null>>()
  for (const r of rows) {
    if (!Number.isFinite(r.t)) continue
    let m = byEl.get(r.element)
    if (!m) byEl.set(r.element, (m = new Map()))
    if (r.value != null || !m.has(r.t)) m.set(r.t, r.value)
  }
  const get = (el: string, t: number) => byEl.get(el)?.get(t) ?? null

  // Poslední čas, kdy je k dispozici teplota
  const tTimes = [...(byEl.get('T')?.entries() ?? [])].filter(([t, v]) => v != null && t <= now).map(([t]) => t)
  const lastT = tTimes.length ? Math.max(...tTimes) : null
  const obs = (t: number): StationObs => ({
    t,
    T: get('T', t),
    H: get('H', t),
    F: get('F', t),
    Fmax: get('Fmax', t),
    D: get('D', t),
    TPM: get('TPM', t),
    SRA: get('SRA10M', t),
  })

  const seriesEnd = lastT ?? now - (now % STEP)
  const seriesStart = seriesEnd - SERIES_HOURS * HOUR + STEP
  const series: StationNow['series'] = { start: seriesStart, step: STEP, T: [], H: [], F: [], Fmax: [], D: [], SRA: [] }
  for (let t = seriesStart; t <= seriesEnd; t += STEP) {
    series.T.push(get('T', t))
    series.H.push(get('H', t))
    series.F.push(get('F', t))
    series.Fmax.push(get('Fmax', t))
    series.D.push(get('D', t))
    series.SRA.push(get('SRA10M', t))
  }

  // Souhrn od místní půlnoci (10min maxima/minima TMA/TMI, jinak T)
  let today: StationNow['today'] = null
  if (lastT != null) {
    const date = localDateKey(lastT)
    const from = localMidnight(date)
    let tmax: number | null = null
    let tmaxAt: number | null = null
    let tmin: number | null = null
    let tminAt: number | null = null
    let prcp: number | null = null
    let gustMax: number | null = null
    // Interval (t − 10 min, t] patří do dne, pokud začíná po půlnoci: t > from
    for (let t = from + STEP; t <= lastT; t += STEP) {
      const hi = get('TMA', t) ?? get('T', t)
      const lo = get('TMI', t) ?? get('T', t)
      if (hi != null && (tmax == null || hi > tmax)) [tmax, tmaxAt] = [hi, t]
      if (lo != null && (tmin == null || lo < tmin)) [tmin, tminAt] = [lo, t]
      const p = get('SRA10M', t)
      if (p != null) prcp = Math.round(((prcp ?? 0) + p) * 10) / 10
      const g = get('Fmax', t)
      if (g != null && (gustMax == null || g > gustMax)) gustMax = g
    }
    today = { date, from, to: lastT, tmax, tmaxAt, tmin, tminAt, prcp, gustMax }
  }

  return { updated: new Date(now).toISOString(), last: lastT != null ? obs(lastT) : null, series, today }
}

async function main() {
  const now = Date.now()
  const store = readJson<StationSra10>('station-sra10.json')
  const coverDays = store ? (now - store.start) / DAY : 0
  const bootstrap = process.argv.includes('--bootstrap') || !store || coverDays < 60
  log('bootstrap:', bootstrap, 'pokrytí dní:', coverDays.toFixed(1), 'dnešní soubor:', ymd(now))

  const rows = await load10min(bootstrap, now)
  const sra = mergeSra(store, rows, now)
  writeJson('station-sra10.json', sra)
  log('station-sra10.json', sra.values.length, 'hodnot od', new Date(sra.start).toISOString())

  const nowFileRows = rows.filter((r) => r.t >= now - 3 * DAY)
  const stNow = buildNow(nowFileRows, now)
  writeJson('station-now.json', stNow)
  log('station-now.json poslední měření', stNow.last && new Date(stNow.last.t).toISOString(), 'T =', stNow.last?.T)
  touchMeta('station')
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
