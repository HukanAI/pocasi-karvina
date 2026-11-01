// Načítání radarových snímků z data větve (šedotónové PNG s dBZ) a jejich obarvení paletou Windy

import { DATA_BASE_URL } from '../../api/dataBranch.ts'
import { decodeDbz, type GeoBounds, mercY } from '../../lib/radarData.ts'
import { windyColor } from '../../lib/radarPalette.ts'

export interface FrameData {
  width: number
  height: number
  /** Hodnoty pixelů ve formátu radarData (0 = nic, 1 = mimo dosah, ≥ 4 = dBZ + sníh) */
  values: Uint8Array
}

/** Barva pro každou možnou hodnotu pixelu (256 položek RGBA) */
const LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 4)
  for (let v = 0; v < 256; v++) {
    const d = decodeDbz(v)
    if (!d) continue
    lut.set(windyColor(d.dbz, d.snow), v * 4)
  }
  return lut
})()

const cache = new Map<string, Promise<FrameData>>()

export function loadFrame(file: string): Promise<FrameData> {
  const url = DATA_BASE_URL + file
  let p = cache.get(url)
  if (!p) {
    p = new Promise<FrameData>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const ctx = c.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0)
        const rgba = ctx.getImageData(0, 0, c.width, c.height).data
        // Šedotónové PNG: kanál R = hodnota
        const values = new Uint8Array(c.width * c.height)
        for (let k = 0; k < values.length; k++) values[k] = rgba[k * 4]
        resolve({ width: c.width, height: c.height, values })
      }
      img.onerror = () => {
        cache.delete(url)
        reject(new Error(`Radarový snímek nedostupný: ${file}`))
      }
      img.src = url
    })
    cache.set(url, p)
  }
  return p
}

/** Obarvený snímek jako data URL pro L.imageOverlay */
export function colorize(f: FrameData): string {
  const c = document.createElement('canvas')
  c.width = f.width
  c.height = f.height
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(f.width, f.height)
  for (let k = 0; k < f.values.length; k++) {
    const v = f.values[k]
    if (v < 4) continue
    img.data.set(LUT.subarray(v * 4, v * 4 + 4), k * 4)
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

/** Nejvyšší dBZ v okruhu radiusKm kolem bodu (null = nic / mimo snímek) */
export function maxDbzNear(f: FrameData, b: GeoBounds, lat: number, lon: number, radiusKm: number): number | null {
  const x = ((lon - b.west) / (b.east - b.west)) * f.width
  const y = ((mercY(b.north) - mercY(lat)) / (mercY(b.north) - mercY(b.south))) * f.height
  const kmPerPx = (((b.east - b.west) * 111.32 * Math.cos((lat * Math.PI) / 180)) / f.width)
  const r = Math.max(1, Math.round(radiusKm / kmPerPx))
  let best: number | null = null
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue
      const xi = Math.floor(x) + dx
      const yi = Math.floor(y) + dy
      if (xi < 0 || yi < 0 || xi >= f.width || yi >= f.height) continue
      const d = decodeDbz(f.values[yi * f.width + xi])
      if (d && (best === null || d.dbz > best)) best = d.dbz
    }
  }
  return best
}

export const leafletBounds = (b: GeoBounds): [[number, number], [number, number]] => [
  [b.south, b.west],
  [b.north, b.east],
]
