import { describe, expect, it } from 'vitest'
import { buildGrid, gridBounds, gridCoords, renderGridFrame } from './precipGrid.ts'

const { lats, lons } = gridCoords({ lat: 50, lon: 18 })

/** Mřížka s jediným deštivým bodem (iLat, iLon) */
function oneCell(iLat: number, iLon: number, mm15: number, snowfall = 0) {
  const points = lats.flatMap((_, latIdx) =>
    lons.map((__, lonIdx) => ({
      latIdx,
      lonIdx,
      time: [1000],
      precipitation: [latIdx === iLat && lonIdx === iLon ? mm15 : 0],
      snowfall: [latIdx === iLat && lonIdx === iLon ? snowfall : 0],
    })),
  )
  return buildGrid(lats, lons, points)
}

const alphaAt = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3]

describe('mřížka předpovědi', () => {
  it('13 × 17 bodů vystředěných na Karviné, hranice o půl buňky větší', () => {
    expect(lats).toHaveLength(13)
    expect(lons).toHaveLength(17)
    expect(lats[6]).toBe(50)
    expect(lons[8]).toBe(18)
    const g = oneCell(0, 0, 0)
    expect(gridBounds(g)).toEqual([
      [lats[0] - 0.1, lons[0] - 0.125],
      [lats[12] + 0.1, lons[16] + 0.125],
    ])
  })

  it('15min úhrn se převádí na mm/h', () => {
    expect(oneCell(6, 8, 0.5).rate[0][6][8]).toBe(2)
  })

  it('déšť se vykreslí na správném místě: sever nahoře, západ vlevo', () => {
    const scale = 8
    // Bod nejvíc na severovýchod: lat index 12 (sever), lon index 16 (východ)
    const img = renderGridFrame(oneCell(12, 16, 1), 0, scale)
    // Střed buňky vpravo nahoře (bez ztlumení okraje by měl plnou barvu)
    expect(alphaAt(img, img.width - scale / 2 - 1, scale / 2)).toBeGreaterThan(0)
    // Levý dolní roh je suchý
    expect(alphaAt(img, scale / 2, img.height - scale / 2)).toBe(0)
  })

  it('bilineární interpolace: mezi dvěma body je hodnota nenulová, daleko nulová', () => {
    const scale = 8
    const img = renderGridFrame(oneCell(6, 8, 1), 0, scale)
    const cx = 8 * scale + scale / 2
    const cy = (12 - 6) * scale + scale / 2
    expect(alphaAt(img, cx, cy)).toBeGreaterThan(200)
    expect(alphaAt(img, cx + scale / 2, cy)).toBeGreaterThan(0)
    expect(alphaAt(img, cx + 3 * scale, cy)).toBe(0)
  })

  it('okraj oblasti postupně mizí', () => {
    const scale = 8
    const img = renderGridFrame(oneCell(6, 0, 3), 0, scale)
    const cy = (12 - 6) * scale + scale / 2
    expect(alphaAt(img, 0, cy)).toBeLessThan(alphaAt(img, scale / 2, cy))
  })

  it('sníh používá sněhovou paletu', () => {
    const scale = 8
    const cx = 8 * scale + scale / 2
    const cy = 6 * scale + scale / 2
    const rain = renderGridFrame(oneCell(6, 8, 1), 0, scale)
    const snow = renderGridFrame(oneCell(6, 8, 1, 0.7), 0, scale)
    const k = (cy * rain.width + cx) * 4
    expect([...snow.data.slice(k, k + 3)]).not.toEqual([...rain.data.slice(k, k + 3)])
  })

  it('neexistující časový krok = prázdný obrázek', () => {
    const img = renderGridFrame(oneCell(6, 8, 1), 5, 4)
    expect(img.data.every((v) => v === 0)).toBe(true)
  })
})
