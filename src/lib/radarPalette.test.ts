import { describe, expect, it } from 'vitest'
import { dbzToMmh, legendGradient, matchRainViewer, mmhToDbz, recolorRainViewer, windyColor } from './radarPalette.ts'
import { UB_DBZ_MIN, UB_RAIN, UB_SNOW } from './rainviewerPalette.ts'

const hex = (h: string) => [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number, number]

describe('mm/h ↔ dBZ (Marshall–Palmer)', () => {
  it('známé hodnoty: 1 mm/h ≈ 23 dBZ, 10 mm/h ≈ 39 dBZ', () => {
    expect(mmhToDbz(1)).toBeCloseTo(23.01, 1)
    expect(mmhToDbz(10)).toBeCloseTo(39.01, 1)
    expect(mmhToDbz(0)).toBe(-Infinity)
  })
  it('převod tam a zpět', () => {
    for (const r of [0.1, 0.5, 2, 30]) expect(dbzToMmh(mmhToDbz(r))).toBeCloseTo(r, 6)
  })
})

describe('paleta Windy', () => {
  it('pod 3 dBZ průhledná, slabé srážky už dobře viditelné (alfa ≥ 50 %)', () => {
    expect(windyColor(2.9)[3]).toBe(0)
    expect(windyColor(mmhToDbz(0.1))[3]).toBeGreaterThanOrEqual(128)
  })
  it('silnější srážky nejsou průhlednější než slabší', () => {
    let prev = 0
    for (let d = 3; d <= 70; d++) {
      const a = windyColor(d)[3]
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
  })
  it('sníh má vlastní (bělavou) paletu', () => {
    const s = windyColor(15, true)
    expect(s[0]).toBeGreaterThan(150)
    expect(windyColor(15, true)).not.toEqual(windyColor(15))
  })
  it('legenda je platný CSS gradient', () => {
    expect(legendGradient()).toMatch(/^linear-gradient\(90deg, rgba\(/)
  })
})

describe('zpětné určení dBZ z dlaždice RainViewer', () => {
  it('každá neprůhledná barva tabulky se najde přesně (déšť i sníh)', () => {
    for (const table of [UB_RAIN, UB_SNOW]) {
      for (const h of table) {
        const [r, g, b, a] = hex(h)
        if (a === 0) continue
        const m = matchRainViewer(r, g, b, a)!
        // Tabulka má opakované barvy (např. 65–74 dBZ bíle) – nalezená položka musí mít přesně tutéž barvu
        const found = (m.snow ? UB_SNOW : UB_RAIN)[m.dbz - UB_DBZ_MIN]
        expect(found).toBe(h)
      }
    }
  })
  it('poloprůhledný pixel s odchylkou zaokrouhlení najde nejbližší barvu', () => {
    // 10 dBZ = cec08796; prohlížeč může vrátit o 1–2 odlišné RGB
    const m = matchRainViewer(0xcd, 0xbf, 0x88, 0x96)
    expect(m).toEqual({ dbz: 10, snow: false })
  })
  it('průhledný pixel = bez srážek', () => {
    expect(matchRainViewer(0, 0, 0, 0)).toBeNull()
  })
  it('přebarvení: slabý déšť z RainViewer (průhledná béžová) je po přebarvení dobře viditelný', () => {
    const px = new Uint8ClampedArray([...hex(UB_RAIN[10 - UB_DBZ_MIN]), 0, 0, 0, 0])
    recolorRainViewer(px)
    expect(px[3]).toBeGreaterThan(0x96) // původně alfa 0x96 (59 %)
    expect([px[4], px[5], px[6], px[7]]).toEqual([0, 0, 0, 0])
  })
})
