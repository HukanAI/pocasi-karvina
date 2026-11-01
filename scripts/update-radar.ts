// Radarová data do data větve (spouští GitHub Actions každých 10 min):
//  - radar ČHMÚ pseudoCAPPI 2 km (1 km, po 5 min, posledních 2 h)
//  - nowcasting ČHMÚ COTREC (+10 … +60 min)
//  - model ČHMÚ ALADIN 2,3 km, intenzita srážek po hodinách (stahuje se jen při novém běhu, ~125 MB)
// Vše se převádí na jednotný formát šedotónových PNG (viz src/lib/radarData.ts).
//
// Spuštění: node scripts/update-radar.ts [--skip-model]

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHMI_DATA_BOUNDS,
  chmiDataPixels,
  chmiIndexToValue,
  type GeoBounds,
  modelRateToValue,
  type RadarFrameRef,
  type RadarIndex,
} from '../src/lib/radarData.ts'
import { type Bounds, type Grid, mercatorHeight, readGrib1, resampleToMercator } from './lib/grib1.ts'
import { dataPath, fetchWithRetry, log, readJson, touchMeta, writeJson } from './lib/io.ts'
import { decodePng, encodeGrayPng } from './lib/png.ts'
import { readTar } from './lib/tar.ts'

const CHMI = 'https://opendata.chmi.cz/meteorology/weather'
const OBS_DIR = `${CHMI}/radar/composite/pseudocappi2km/png/`
const FCT_DIR = `${CHMI}/radar/composite/fct_pseudocappi2km/png/`
const ALADIN_DIR = `${CHMI}/nwp_aladin/Lambert_2.3km/`
const OBS_KEEP_MS = 2 * 3_600_000 + 5 * 60_000
const MODEL_HOURS = 24
/**
 * Oblast modelu: střední Evropa (celá leží uvnitř domény ALADIN 2,3 km), ~2,2 km na pixel.
 * Musí být velká, aby při oddálení mapy předpověď nekončila ostrou hranou kousek za Českem.
 */
export const MODEL_BOUNDS: Bounds = { south: 44.0, west: 6.0, north: 55.0, east: 28.0 }
const MODEL_WIDTH = 740

const RADAR = 'radar'
const dir = (...p: string[]) => dataPath(join(RADAR, ...p))

/** 'pacz2gmaps3.z_cappi020.20261101.1755.0.png' → čas v ms */
export function parseChmiTime(name: string): number | null {
  const m = /\.(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})\./.exec(name)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null
}

const stamp = (t: number) => new Date(t).toISOString().slice(0, 16).replace(/[-:T]/g, '')

async function listing(url: string, re: RegExp): Promise<string[]> {
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return [...(await res.text()).matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((n) => re.test(n))
}

/** Snímek ČHMÚ (indexované PNG) → oříznutá datová oblast v jednotném formátu */
export function convertChmi(png: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  const img = decodePng(png)
  const { x0, x1, y0, y1 } = chmiDataPixels()
  const width = x1 - x0
  const height = y1 - y0
  const pixels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = chmiIndexToValue(img.pixels[(y + y0) * img.width + x + x0])
  return { width, height, pixels }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

function saveFrame(sub: string, name: string, f: { width: number; height: number; pixels: Uint8Array }): string {
  mkdirSync(dir(sub), { recursive: true })
  writeFileSync(dir(sub, name), encodeGrayPng(f.width, f.height, f.pixels))
  return `${RADAR}/${sub}/${name}`
}

/** Smaže soubory v podsložce, které nejsou v seznamu */
function prune(sub: string, keep: Set<string>) {
  if (!existsSync(dir(sub))) return
  for (const f of readdirSync(dir(sub))) if (!keep.has(`${RADAR}/${sub}/${f}`)) rmSync(dir(sub, f))
}

async function updateObs(now: number, prev: RadarIndex | null): Promise<RadarIndex['obs']> {
  const names = await listing(OBS_DIR, /^pacz2gmaps3\.z_cappi020\.\d{8}\.\d{4}\.0\.png$/)
  const recent = names
    .map((n) => ({ n, t: parseChmiTime(n)! }))
    .filter((x) => x.t >= now - OBS_KEEP_MS)
    .sort((a, b) => a.t - b.t)
  const have = new Map((prev?.obs?.frames ?? []).map((f) => [f.t, f.file]))
  const frames: RadarFrameRef[] = []
  for (const { n, t } of recent) {
    const name = `${stamp(t)}.png`
    let file = have.get(t)
    if (!file || !existsSync(dataPath(file))) {
      try {
        file = saveFrame('obs', name, convertChmi(await fetchBytes(OBS_DIR + n)))
      } catch (e) {
        log('radar: snímek se nepodařilo zpracovat', n, (e as Error).message)
        continue
      }
    }
    frames.push({ t, file })
  }
  prune('obs', new Set(frames.map((f) => f.file)))
  log('radar ČHMÚ:', frames.length, 'snímků, poslední', frames.at(-1) && new Date(frames.at(-1)!.t).toISOString())
  return frames.length ? { bounds: CHMI_DATA_BOUNDS, frames } : null
}

async function updateNowcast(prev: RadarIndex | null): Promise<RadarIndex['nowcast']> {
  const tars = await listing(FCT_DIR, /^pacz2gmaps3\.fct_z_cappi020\.\d{8}\.\d{4}\.ft60s10\.tar$/)
  const latest = tars.map((n) => ({ n, t: parseChmiTime(n)! })).sort((a, b) => b.t - a.t)[0]
  if (!latest) return prev?.nowcast ?? null
  if (prev?.nowcast?.base === latest.t && prev.nowcast.frames.every((f) => existsSync(dataPath(f.file)))) return prev.nowcast
  const entries = readTar(await fetchBytes(FCT_DIR + latest.n)).filter((e) => e.name.endsWith('.png'))
  const frames: RadarFrameRef[] = []
  for (const e of entries) {
    const t = parseChmiTime(e.name.split('/').pop()!)
    if (t == null) continue
    frames.push({ t, file: saveFrame('nowcast', `${stamp(t)}.png`, convertChmi(e.data)) })
  }
  frames.sort((a, b) => a.t - b.t)
  prune('nowcast', new Set(frames.map((f) => f.file)))
  log('nowcasting ČHMÚ: výpočet', new Date(latest.t).toISOString(), '→', frames.length, 'snímků')
  return { base: latest.t, bounds: CHMI_DATA_BOUNDS, frames }
}

/** Nejnovější běh ALADIN, pro který jsou venku oba soubory srážek (déšť i sníh) */
async function latestAladinRun(): Promise<{ run: number; rain: string; snow: string } | null> {
  let best: { run: number; rain: string; snow: string } | null = null
  for (const h of ['00', '06', '12', '18']) {
    let names: string[] = []
    try {
      names = await listing(`${ALADIN_DIR}${h}/`, /_SURF(RAIN|SNOW)FALL\.grb\.bz2$/)
    } catch {
      continue
    }
    for (const n of names) {
      const m = /_(\d{4})(\d{2})(\d{2})(\d{2})_SURFRAINFALL/.exec(n)
      if (!m) continue
      const snowName = n.replace('SURFRAINFALL', 'SURFSNOWFALL')
      if (!names.includes(snowName)) continue
      const run = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4])
      if (!best || run > best.run) best = { run, rain: `${ALADIN_DIR}${h}/${n}`, snow: `${ALADIN_DIR}${h}/${snowName}` }
    }
  }
  return best
}

/** Stáhne soubor .grb.bz2 a vrátí akumulace podle hodiny předpovědi */
async function downloadAccumulations(url: string): Promise<{ grid: Grid; reference: number; byHour: Map<number, Float32Array> }> {
  const tmp = dataPath('../aladin-tmp.grb.bz2')
  writeFileSync(tmp, await fetchBytes(url))
  // bzip2 je na runnerech Ubuntu i v Git Bash; Node ho nativně neumí
  const grib = execFileSync('bunzip2', ['-c', tmp], { maxBuffer: 768 * 1024 * 1024 })
  rmSync(tmp)
  const byHour = new Map<number, Float32Array>()
  let grid: Grid | null = null
  let reference = 0
  for (const m of readGrib1(grib)) {
    if (m.forecastHour > MODEL_HOURS + 12) continue
    byHour.set(m.forecastHour, m.values())
    grid = m.grid
    reference = m.reference
  }
  if (!grid) throw new Error(`Prázdný soubor ${url}`)
  return { grid, reference, byHour }
}

async function updateModel(now: number, prev: RadarIndex | null): Promise<RadarIndex['model']> {
  const latest = await latestAladinRun()
  if (!latest) return prev?.model ?? null
  const sameArea = JSON.stringify(prev?.model?.bounds) === JSON.stringify(MODEL_BOUNDS)
  const fresh = prev?.model?.run === latest.run && sameArea && prev.model.frames.every((f) => existsSync(dataPath(f.file)))
  // Při stejném běhu jen odstranit snímky z minulosti
  if (fresh) {
    const frames = prev!.model!.frames.filter((f) => f.t >= now - 3_600_000)
    prune('model', new Set(frames.map((f) => f.file)))
    return { ...prev!.model!, frames }
  }
  log('ALADIN: nový běh', new Date(latest.run).toISOString(), '– stahuji srážky (déšť ~115 MB, sníh ~10 MB)')
  const rain = await downloadAccumulations(latest.rain)
  const snow = await downloadAccumulations(latest.snow)
  const height = mercatorHeight(MODEL_BOUNDS, MODEL_WIDTH)
  const frames: RadarFrameRef[] = []
  const zero = new Float32Array(0)
  for (const [h, acc] of [...rain.byHour].sort((a, b) => a[0] - b[0])) {
    const t = rain.reference + h * 3_600_000
    if (h < 1 || t < now - 3_600_000 || t > now + MODEL_HOURS * 3_600_000) continue
    // Akumulace od startu běhu → úhrn za poslední hodinu = mm/h
    const prevRain = rain.byHour.get(h - 1) ?? zero
    const snowAcc = snow.byHour.get(h) ?? zero
    const prevSnow = snow.byHour.get(h - 1) ?? zero
    const rainRate = acc.map((v, k) => v - (prevRain[k] ?? 0))
    const snowRate = snowAcc.length ? snowAcc.map((v, k) => v - (prevSnow[k] ?? 0)) : new Float32Array(acc.length)
    const r = resampleToMercator(rainRate, rain.grid, MODEL_BOUNDS, MODEL_WIDTH, height)
    const s = resampleToMercator(snowRate, snow.grid, MODEL_BOUNDS, MODEL_WIDTH, height)
    const pixels = new Uint8Array(r.length)
    for (let k = 0; k < r.length; k++) pixels[k] = modelRateToValue(r[k], s[k])
    frames.push({ t, file: saveFrame('model', `${stamp(latest.run)}_${String(h).padStart(2, '0')}.png`, { width: MODEL_WIDTH, height, pixels }) })
  }
  frames.sort((a, b) => a.t - b.t)
  prune('model', new Set(frames.map((f) => f.file)))
  log('ALADIN:', frames.length, 'hodinových snímků', `${MODEL_WIDTH}×${height} px`)
  return { run: latest.run, bounds: MODEL_BOUNDS as GeoBounds, frames }
}

async function main() {
  const now = Date.now()
  const prev = readJson<RadarIndex>(`${RADAR}/index.json`)
  const skipModel = process.argv.includes('--skip-model')
  const part = async <T,>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      console.error(`${name} selhalo:`, e)
      return fallback
    }
  }
  const obs = await part('Radar ČHMÚ', () => updateObs(now, prev), prev?.obs ?? null)
  const nowcast = await part('Nowcasting ČHMÚ', () => updateNowcast(prev), prev?.nowcast ?? null)
  const model = skipModel ? (prev?.model ?? null) : await part('Model ALADIN', () => updateModel(now, prev), prev?.model ?? null)
  const index: RadarIndex = { updated: new Date(now).toISOString(), obs, nowcast, model }
  writeJson(`${RADAR}/index.json`, index)
  touchMeta('radar')
  if (!obs && !nowcast && !model) process.exit(1)
}

if (import.meta.main) main()
