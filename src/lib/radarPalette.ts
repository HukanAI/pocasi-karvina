// Paleta srážek ve stylu Windy a převody: barva RainViewer → dBZ, intenzita mm/h ↔ dBZ.
// Radar i modelová předpověď se kreslí stejnou paletou, aby na sebe na časové ose navazovaly.

import { UB_DBZ_MIN, UB_RAIN, UB_SNOW } from './rainviewerPalette.ts'

export type Rgba = [number, number, number, number]

const hex = (h: string): Rgba => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16)]

/** Marshall–Palmer: Z = 200·R^1,6 → dBZ */
export function mmhToDbz(mmh: number): number {
  if (!(mmh > 0)) return -Infinity
  return 10 * Math.log10(200 * mmh ** 1.6)
}

export function dbzToMmh(dbz: number): number {
  return (10 ** (dbz / 10) / 200) ** (1 / 1.6)
}

/** Body palety ve stylu Windy: [dBZ, r, g, b, alfa 0–1] */
const RAIN_STOPS: [number, number, number, number, number][] = [
  [3, 70, 160, 255, 0],
  [6, 70, 160, 255, 0.6], // mrholení ~0,1 mm/h (7 dBZ) musí být dobře vidět
  [15, 40, 120, 255, 0.75],
  [22, 0, 190, 200, 0.85], // ~1 mm/h
  [28, 40, 205, 90, 0.9], // ~2,5 mm/h
  [33, 175, 225, 40, 0.92],
  [38, 255, 225, 0, 0.94], // ~8 mm/h
  [43, 255, 140, 0, 0.96],
  [48, 250, 40, 40, 1], // ~35 mm/h
  [54, 210, 0, 140, 1],
  [60, 160, 70, 255, 1], // kroupy / extrémní
  [66, 255, 255, 255, 1],
]

const SNOW_STOPS: [number, number, number, number, number][] = [
  [3, 230, 235, 255, 0],
  [6, 230, 235, 255, 0.6],
  [18, 205, 215, 255, 0.8],
  [26, 170, 175, 255, 0.9],
  [34, 200, 120, 255, 0.95],
  [42, 240, 90, 220, 1],
]

function interp(stops: typeof RAIN_STOPS, dbz: number): Rgba {
  if (!(dbz >= stops[0][0])) return [0, 0, 0, 0]
  for (let i = 1; i < stops.length; i++) {
    const [d1, ...c1] = stops[i]
    if (dbz <= d1) {
      const [d0, ...c0] = stops[i - 1]
      const f = (dbz - d0) / (d1 - d0)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
        Math.round((c0[3] + (c1[3] - c0[3]) * f) * 255),
      ]
    }
  }
  const last = stops[stops.length - 1]
  return [last[1], last[2], last[3], Math.round(last[4] * 255)]
}

export function windyColor(dbz: number, snow = false): Rgba {
  return interp(snow ? SNOW_STOPS : RAIN_STOPS, dbz)
}

/** Body legendy v mm/h */
export const LEGEND_MMH = [0.1, 0.5, 1, 3, 10, 30, 100]

/** CSS gradient legendy (rozložení podle dBZ, popisky v mm/h) */
export function legendGradient(snow = false): string {
  const min = 6
  const max = snow ? 42 : 62
  const parts: string[] = []
  for (let d = min; d <= max; d += 2) {
    const [r, g, b, a] = windyColor(d, snow)
    parts.push(`rgba(${r},${g},${b},${Math.max(a / 255, 0.55).toFixed(2)}) ${(((d - min) / (max - min)) * 100).toFixed(1)}%`)
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

export const LEGEND_DBZ_RANGE = { min: 6, max: 62 }

// ------------------------------------------------------------------ RainViewer → dBZ

const packRgba = (r: number, g: number, b: number, a: number) => ((r << 24) | (g << 16) | (b << 8) | a) >>> 0

interface PaletteEntry {
  rgba: Rgba
  dbz: number
  snow: boolean
}

const ENTRIES: PaletteEntry[] = [
  ...UB_RAIN.map((h, i) => ({ rgba: hex(h), dbz: i + UB_DBZ_MIN, snow: false })),
  ...UB_SNOW.map((h, i) => ({ rgba: hex(h), dbz: i + UB_DBZ_MIN, snow: true })),
].filter((e) => e.rgba[3] > 0)

/** Výsledná barva (Windy) pro každou položku palety RainViewer, uloženo podle zabalené RGBA */
const EXACT = new Map<number, number>()
const OUT: Rgba[] = []
ENTRIES.forEach((e, i) => {
  OUT.push(windyColor(e.dbz, e.snow))
  const key = packRgba(...e.rgba)
  if (!EXACT.has(key)) EXACT.set(key, i)
})

const NEAREST_CACHE = new Map<number, number>()

/**
 * Najde položku palety RainViewer k pixelu. Přesná shoda je běžná; u poloprůhledných pixelů
 * prohlížeč při čtení z canvasu zaokrouhluje (předem vynásobená alfa), proto záloha = nejbližší barva.
 */
export function matchRainViewer(r: number, g: number, b: number, a: number): { dbz: number; snow: boolean } | null {
  if (a === 0) return null
  const key = packRgba(r, g, b, a)
  let idx = EXACT.get(key) ?? NEAREST_CACHE.get(key)
  if (idx === undefined) {
    let best = Infinity
    idx = 0
    ENTRIES.forEach((e, i) => {
      const [er, eg, eb, ea] = e.rgba
      // RGB u velmi průhledných pixelů je nepřesné, proto vyšší váha alfy
      const d = ((er - r) ** 2 + (eg - g) ** 2 + (eb - b) ** 2) * (a / 255) + 4 * (ea - a) ** 2
      if (d < best) {
        best = d
        idx = i
      }
    })
    NEAREST_CACHE.set(key, idx)
  }
  const e = ENTRIES[idx]
  return { dbz: e.dbz, snow: e.snow }
}

/** Přebarví pixely dlaždice RainViewer (RGBA, na místě) paletou Windy */
export function recolorRainViewer(px: Uint8ClampedArray): void {
  for (let k = 0; k < px.length; k += 4) {
    const a = px[k + 3]
    if (a === 0) continue
    const key = packRgba(px[k], px[k + 1], px[k + 2], a)
    let idx = EXACT.get(key) ?? NEAREST_CACHE.get(key)
    if (idx === undefined) {
      matchRainViewer(px[k], px[k + 1], px[k + 2], a)
      idx = NEAREST_CACHE.get(key)!
    }
    const c = OUT[idx]
    px[k] = c[0]
    px[k + 1] = c[1]
    px[k + 2] = c[2]
    px[k + 3] = c[3]
  }
}
