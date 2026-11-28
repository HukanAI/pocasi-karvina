import { describe, expect, it } from 'vitest'
import { formatPrecip, isSnowCode, modelPhaseBetween, phaseOfTotals, precipFill, precipPhase, precipWord, snowShare } from './snow.ts'

// Skutečné hodnoty Open-Meteo pro Karvinou (listopad 2026)
describe('skupenství srážek', () => {
  it('čistý sníh: 0,7 cm na 1 mm vody', () => {
    expect(snowShare(3.8, 2.66)).toBeCloseTo(1, 5) // 26. 11. 20:00
    expect(precipPhase(3.8, 2.66)).toBe('snow')
    expect(precipPhase(16.5, 11.55)).toBe('snow') // denní součet 26. 11.
  })

  it('déšť, smíšené a hranice', () => {
    expect(precipPhase(1.6, 0)).toBe('rain')
    expect(precipPhase(0.4, null)).toBe('rain')
    expect(precipPhase(2, 0.7)).toBe('mixed') // 1 mm sněhu z 2 mm
    expect(precipPhase(1, 0.14)).toBe('rain') // 20 % sněhu
    expect(precipPhase(1, 0.56)).toBe('snow') // 80 % sněhu
    expect(precipPhase(0, 0.07)).toBe('rain') // bez vody nelze rozhodnout → déšť (nic se nezobrazí jinak)
  })

  it('zaokrouhlení vody může dát víc sněhu než vody – podíl se omezí na 100 %', () => {
    expect(snowShare(0.1, 0.14)).toBe(1)
  })
})

describe('formatPrecip', () => {
  it('sníh v cm, déšť v mm', () => {
    expect(formatPrecip(16.5, 11.55)).toBe('11,6 cm sněhu')
    expect(formatPrecip(16.5, 11.55, { water: true })).toBe('11,6 cm sněhu (16,5 mm vody)')
    expect(formatPrecip(1.6, 0)).toBe('1,6 mm')
    expect(formatPrecip(null, null)).toBe('–')
  })

  it('smíšené srážky a krátký zápis', () => {
    expect(formatPrecip(2, 0.7)).toBe('1,0 mm deště a 0,7 cm sněhu')
    expect(formatPrecip(2, 0.7, { short: true })).toBe('1,0 mm + 0,7 cm sněhu')
  })

  it('odhad a velmi malé množství', () => {
    expect(formatPrecip(1, 0.7, { approx: true })).toBe('asi 0,7 cm sněhu')
    expect(formatPrecip(0.04, 0.03)).toBe('< 0,1 cm sněhu')
    expect(formatPrecip(0, 0)).toBe('0,0 mm')
  })
})

describe('precipWord', () => {
  it('stejné prahy jako u deště (mm vody za hodinu)', () => {
    expect(precipWord(0.5, 'rain')).toBe('slabé srážky')
    expect(precipWord(0.5, 'snow')).toBe('slabé sněžení')
    expect(precipWord(3.8, 'snow')).toBe('mírné sněžení')
    expect(precipWord(5, 'snow')).toBe('silné sněžení')
    expect(precipWord(12, 'mixed')).toBe('velmi silný déšť se sněhem')
    expect(precipWord(0.01, 'snow')).toBe('bez srážek')
  })
})

it('phaseOfTotals a isSnowCode', () => {
  const t = phaseOfTotals([{ mm: 1, snowCm: 0.7 }, { mm: 0.5, snowCm: 0.35 }, { mm: 0 }])
  expect(t.mm).toBe(1.5)
  expect(t.snowCm).toBeCloseTo(1.05, 9)
  expect(t.phase).toBe('snow')
  expect(phaseOfTotals([])).toEqual({ mm: 0, snowCm: 0, phase: 'rain' })
  expect([71, 73, 75, 77, 85, 86].every(isSnowCode)).toBe(true)
  expect([61, 66, 80, 95, null].some(isSnowCode)).toBe(false)
})

describe('modelPhaseBetween', () => {
  const H = 3_600_000
  // Hodnota v čase t platí za hodinu (t − 1 h, t]
  const hourly = { time: [1, 2, 3, 4, 5].map((k) => k * H), precipitation: [0, 1, 1, 0.5, 0], snowfall: [0, 0, 0.7, 0.35, 0] }
  it('sečte hodiny, které zasahují do období', () => {
    expect(modelPhaseBetween(hourly, 2 * H, 4 * H)).toBe('snow') // hodiny do 3 h a 4 h: 1,5 mm, 1,05 cm
    expect(modelPhaseBetween(hourly, H, 2 * H)).toBe('rain') // jen hodina do 2 h
    expect(modelPhaseBetween(hourly, H, 4 * H)).toBe('mixed') // 2,5 mm, z toho 1,5 mm sněhu
  })
  it('suchý model nebo bez sněhových dat', () => {
    expect(modelPhaseBetween(hourly, 4 * H, 5 * H)).toBeNull()
    expect(modelPhaseBetween({ time: hourly.time, precipitation: hourly.precipitation }, 2 * H, 4 * H)).toBe('rain')
  })
  it('barva sloupce', () => {
    expect(precipFill(1, 0.7)).toBe('var(--snow)')
    expect(precipFill(1, 0)).toBe('var(--rain)')
    expect(precipFill(2, 0.7)).toContain('linear-gradient')
  })
})
