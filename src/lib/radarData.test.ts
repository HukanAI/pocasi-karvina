import { describe, expect, it } from 'vitest'
import { chmiDataPixels, chmiIndexToValue, decodeDbz, encodeDbz, modelRateToValue, NO_COVERAGE, NO_ECHO } from './radarData.ts'
import { mmhToDbz } from './radarPalette.ts'

describe('kódování dBZ do pixelu', () => {
  it('tam a zpět pro déšť i sníh v celém rozsahu', () => {
    for (let d = -30; d <= 95; d++) {
      for (const snow of [false, true]) {
        const v = encodeDbz(d, snow)
        expect(v).toBeGreaterThanOrEqual(4)
        expect(v).toBeLessThanOrEqual(255)
        expect(decodeDbz(v)).toEqual({ dbz: d, snow })
      }
    }
  })
  it('0 a 1 jsou vyhrazené (bez srážek, mimo dosah)', () => {
    expect(decodeDbz(NO_ECHO)).toBeNull()
    expect(decodeDbz(NO_COVERAGE)).toBeNull()
    expect(encodeDbz(Number.NaN)).toBe(NO_COVERAGE)
  })
})

describe('paleta ČHMÚ', () => {
  it('index 195 = 4–8 dBZ (střed 6), 181 = ≥ 60 dBZ (62)', () => {
    expect(decodeDbz(chmiIndexToValue(195))).toEqual({ dbz: 6, snow: false })
    expect(decodeDbz(chmiIndexToValue(187))).toEqual({ dbz: 38, snow: false })
    expect(decodeDbz(chmiIndexToValue(181))).toEqual({ dbz: 62, snow: false })
  })
  it('šedá 242 = mimo dosah, popisky a čáry = nic', () => {
    expect(chmiIndexToValue(242)).toBe(NO_COVERAGE)
    for (const idx of [0, 145, 146, 180, 196, 241]) expect(chmiIndexToValue(idx)).toBe(NO_ECHO)
  })
  it('výřez datové oblasti odpovídá čarám v obrázku (x 0–598, y 82–460)', () => {
    expect(chmiDataPixels()).toEqual({ x0: 0, x1: 598, y0: 82, y1: 460 })
  })
})

describe('model: intenzita → dBZ', () => {
  it('pod 0,1 mm/h nic, 1 mm/h ≈ 23 dBZ, sníh podle převahy', () => {
    expect(modelRateToValue(0.09, 0)).toBe(NO_ECHO)
    expect(decodeDbz(modelRateToValue(1, 0))).toEqual({ dbz: Math.round(mmhToDbz(1)), snow: false })
    expect(decodeDbz(modelRateToValue(0.2, 0.8))!.snow).toBe(true)
    expect(decodeDbz(modelRateToValue(0.8, 0.2))!.snow).toBe(false)
  })
  it('záporný přírůstek (zaokrouhlení akumulace) se bere jako 0', () => {
    expect(modelRateToValue(-0.01, 0)).toBe(NO_ECHO)
  })
  it('mimo mřížku modelu = mimo dosah', () => {
    expect(modelRateToValue(Number.NaN, 0)).toBe(NO_COVERAGE)
  })
})
