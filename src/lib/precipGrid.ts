// Předpověď srážek v mřížce bodů kolem Karviné → plynulý obrázek (bilineární interpolace, paleta Windy)

import { LOCATION } from '../config.ts'
import { mmhToDbz, windyColor } from './radarPalette.ts'

/** Mřížka 13 × 17 bodů (≈ 22 × 18 km), pokrývá zhruba ±130 km kolem Karviné */
export const GRID = { dLat: 0.2, dLon: 0.25, halfLat: 6, halfLon: 8 } as const

export function gridCoords(center: { lat: number; lon: number } = { lat: LOCATION.latitude, lon: LOCATION.longitude }) {
  const lats: number[] = []
  const lons: number[] = []
  for (let i = -GRID.halfLat; i <= GRID.halfLat; i++) lats.push(Math.round((center.lat + i * GRID.dLat) * 100) / 100)
  for (let j = -GRID.halfLon; j <= GRID.halfLon; j++) lons.push(Math.round((center.lon + j * GRID.dLon) * 100) / 100)
  return { lats, lons }
}

export interface PrecipGrid {
  /** Zeměpisné šířky řádků od jihu k severu */
  lats: number[]
  /** Zeměpisné délky sloupců od západu k východu */
  lons: number[]
  /** Konec 15min intervalu (ms) */
  times: number[]
  /** rate[t][iLat][iLon] intenzita mm/h */
  rate: number[][][]
  /** snow[t][iLat][iLon] – padá sníh */
  snow: boolean[][][]
}

/** Hranice obrázku: buňky jsou vystředěné na body mřížky */
export function gridBounds(g: PrecipGrid): [[number, number], [number, number]] {
  const dLat = g.lats[1] - g.lats[0]
  const dLon = g.lons[1] - g.lons[0]
  return [
    [g.lats[0] - dLat / 2, g.lons[0] - dLon / 2],
    [g.lats[g.lats.length - 1] + dLat / 2, g.lons[g.lons.length - 1] + dLon / 2],
  ]
}

/**
 * Vykreslí časový krok t do pole RGBA (řádek 0 = sever). Každá buňka mřížky má `scale` pixelů.
 * Intenzita se interpoluje bilineárně mezi body; okraj oblasti postupně mizí, aby nevznikl ostrý obdélník.
 */
export function renderGridFrame(g: PrecipGrid, t: number, scale = 16): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } {
  const ny = g.lats.length
  const nx = g.lons.length
  const width = nx * scale
  const height = ny * scale
  const data = new Uint8ClampedArray(width * height * 4)
  const rate = g.rate[t]
  const snow = g.snow[t]
  if (!rate) return { width, height, data }
  const at = (iy: number, ix: number) => rate[Math.min(ny - 1, Math.max(0, iy))][Math.min(nx - 1, Math.max(0, ix))]
  for (let y = 0; y < height; y++) {
    // Souřadnice v mřížce (řádek od jihu): řádek obrázku 0 = nejsevernější řádek mřížky
    const gyN = (y + 0.5) / scale - 0.5
    const gy = ny - 1 - gyN
    const y0 = Math.floor(gy)
    const fy = gy - y0
    for (let x = 0; x < width; x++) {
      const gx = (x + 0.5) / scale - 0.5
      const x0 = Math.floor(gx)
      const fx = gx - x0
      const v =
        at(y0, x0) * (1 - fx) * (1 - fy) + at(y0, x0 + 1) * fx * (1 - fy) + at(y0 + 1, x0) * (1 - fx) * fy + at(y0 + 1, x0 + 1) * fx * fy
      if (v < 0.05) continue
      const iy = Math.min(ny - 1, Math.max(0, Math.round(gy)))
      const ix = Math.min(nx - 1, Math.max(0, Math.round(gx)))
      const [r, gg, b, a] = windyColor(mmhToDbz(v), snow[iy][ix])
      // Plynulé zmizení okraje (poslední buňka u hrany)
      const edge = Math.min(1, (gx + 0.5) / 1, (nx - 0.5 - gx) / 1, (gyN + 0.5) / 1, (ny - 0.5 - gyN) / 1)
      const k = (y * width + x) * 4
      data[k] = r
      data[k + 1] = gg
      data[k + 2] = b
      data[k + 3] = Math.round(a * Math.max(0, edge))
    }
  }
  return { width, height, data }
}

/** Slouží k převodu odpovědi Open-Meteo (pole lokalit) na mřížku */
export function buildGrid(
  lats: number[],
  lons: number[],
  points: { latIdx: number; lonIdx: number; time: number[]; precipitation: (number | null)[]; snowfall: (number | null)[] }[],
): PrecipGrid {
  const times = points[0]?.time ?? []
  const rate = times.map(() => lats.map(() => lons.map(() => 0)))
  const snow = times.map(() => lats.map(() => lons.map(() => false)))
  for (const p of points) {
    p.time.forEach((_, t) => {
      if (t >= times.length) return
      const mm = p.precipitation[t] ?? 0
      rate[t][p.latIdx][p.lonIdx] = mm * 4 // 15min úhrn → mm/h
      snow[t][p.latIdx][p.lonIdx] = (p.snowfall[t] ?? 0) > 0 && mm > 0
    })
  }
  return { lats, lons, times, rate, snow }
}
