import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cloudCode, dayCode, effectiveCode, measuredPrecipCode, WMO_CODES, wmo, wmoIcon } from './wmo.ts'

const ICON_DIR = fileURLToPath(new URL('../../node_modules/@bybas/weather-icons/production/fill/all/', import.meta.url))

// Kódy, které Open-Meteo dle dokumentace vrací
const OPEN_METEO_CODES = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]

describe('WMO kódy', () => {
  it('pokrývají všechny kódy Open-Meteo', () => {
    expect([...WMO_CODES].sort((a, b) => a - b)).toEqual(OPEN_METEO_CODES)
  })

  it.each(OPEN_METEO_CODES)('kód %i má český popis a existující ikonu pro den i noc', (code) => {
    expect(wmo(code).label).toMatch(/^[A-ZČŘŠŽÚ]/)
    for (const isDay of [true, false]) {
      const icon = wmoIcon(code, isDay)
      expect(icon).not.toContain('{dn}')
      expect(existsSync(`${ICON_DIR}${icon}.svg`), `${icon}.svg`).toBe(true)
    }
  })

  it('neznámý kód má náhradní ikonu', () => {
    expect(wmoIcon(1234, true)).toBe('not-available')
    expect(existsSync(`${ICON_DIR}not-available.svg`)).toBe(true)
  })
})

describe('effectiveCode – ikona a popis odpovídají srážkám', () => {
  it('„slabý déšť“ s 0 mm se změní na stav oblohy (skutečný případ 2. 11. 18:30: kód 61, 0 mm, oblačnost 100 %)', () => {
    expect(effectiveCode(61, 0, 100)).toBe(3)
    expect(effectiveCode(61, null, 30)).toBe(1)
    expect(effectiveCode(80, 0, 50)).toBe(2)
    expect(effectiveCode(71, 0, 5)).toBe(0)
  })
  it('se srážkami kód zůstane', () => {
    expect(effectiveCode(61, 0.1, 100)).toBe(61)
    expect(effectiveCode(73, 0.4, 100)).toBe(73)
  })
  it('mrznoucí srážky, bouřky, mlha a obloha se nemění', () => {
    for (const c of [0, 2, 3, 45, 56, 66, 67, 95, 99]) expect(effectiveCode(c, 0, 100)).toBe(c)
  })
  it('oblačnost → kód', () => {
    expect([cloudCode(null), cloudCode(90), cloudCode(80), cloudCode(79), cloudCode(40), cloudCode(15), cloudCode(14)]).toEqual([3, 3, 3, 2, 2, 1, 0])
  })
  it('naměřené srážky bez kódu: déšť, kolem nuly sníh', () => {
    expect(measuredPrecipCode(5)).toBe(61)
    expect(measuredPrecipCode(0.5)).toBe(71)
    expect(measuredPrecipCode(null)).toBe(61)
  })
})

describe('dayCode', () => {
  const H = 3_600_000
  const d0 = Date.UTC(2026, 10, 2, 23) // místní půlnoc 3. 11.
  const f = {
    hourly: { time: Array.from({ length: 48 }, (_, k) => d0 + (k + 1) * H), cloud_cover: Array.from({ length: 48 }, (_, k) => (k < 24 ? 30 : 100)) },
    daily: { time: [d0, d0 + 24 * H], weather_code: [61, 61], precipitation_sum: [0, 1.2] },
  }
  it('den s kódem deště a 0 mm dostane průměrnou oblačnost dne', () => expect(dayCode(f, 0)).toBe(1))
  it('den se srážkami si kód ponechá', () => expect(dayCode(f, 1)).toBe(61))
  it('bez hodinové oblačnosti = zataženo', () => expect(dayCode({ ...f, hourly: { time: f.hourly.time } }, 0)).toBe(3))
})
