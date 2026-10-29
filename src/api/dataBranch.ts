// Načítání předpočítaných dat z data větve repozitáře (plní je GitHub Actions)

import { DEFAULT_DATA_BASE_URL } from '../config.ts'

/** V režimu vývoje lze data číst z lokální složky (npm run data:dev) */
export const DATA_BASE_URL: string = import.meta.env.VITE_DATA_URL || DEFAULT_DATA_BASE_URL

export async function fetchData<T>(name: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${DATA_BASE_URL}${name}`, { signal, cache: 'no-cache' })
  if (!res.ok) throw new Error(`Data ${name}: HTTP ${res.status}`)
  return (await res.json()) as T
}

export interface RadarFrame {
  time: number
  path: string
}

export interface RadarData {
  host: string
  frames: RadarFrame[]
}

export async function fetchRadar(signal?: AbortSignal): Promise<RadarData> {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal })
  if (!res.ok) throw new Error(`RainViewer HTTP ${res.status}`)
  const j = (await res.json()) as { host: string; radar: { past: RadarFrame[]; nowcast?: RadarFrame[] } }
  const frames = [...j.radar.past, ...(j.radar.nowcast ?? [])].map((f) => ({ time: f.time * 1000, path: f.path }))
  return { host: j.host, frames }
}
