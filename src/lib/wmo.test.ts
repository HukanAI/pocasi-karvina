import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WMO_CODES, wmo, wmoIcon } from './wmo.ts'

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
