// Načítání radarových snímků z data větve (šedotónové PNG s dBZ) a jejich obarvení paletou Windy

import { DATA_BASE_URL } from '../../api/dataBranch.ts'
import { decodeDbz, type FrameData, type GeoBounds } from '../../lib/radarData.ts'
import { windyColor } from '../../lib/radarPalette.ts'

// Výpočty nad snímky jsou ve sdílené knihovně (používá je i kontrola upozornění v Actions)
export type { FrameData } from '../../lib/radarData.ts'
export { maxDbzNear } from '../../lib/radarData.ts'

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

export const leafletBounds = (b: GeoBounds): [[number, number], [number, number]] => [
  [b.south, b.west],
  [b.north, b.east],
]
