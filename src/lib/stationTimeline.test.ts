import { describe, expect, it } from 'vitest'
import { buildTimeline, type HourlyForecast, interpHourly, type StationSeries } from './stationTimeline.ts'

const MIN = 60_000
const H = 60 * MIN
const at = (iso: string) => Date.parse(iso)

// Teď 22. 11. 15:20 UTC; poslední měření 14:50 UTC
const now = at('2026-11-22T15:20Z')
const stStart = at('2026-11-20T15:00Z')

/** 10min řada stanice do 14:50: teplota 5 °C, déšť 0,1 mm v každém intervalu 12:10–13:00 (hodina 12–13) */
function station(): StationSeries {
  const T: (number | null)[] = []
  const SRA: (number | null)[] = []
  for (let t = stStart; t <= at('2026-11-22T14:50Z'); t += 10 * MIN) {
    T.push(t === at('2026-11-22T09:00Z') ? null : 5)
    SRA.push(t > at('2026-11-22T12:00Z') && t <= at('2026-11-22T13:00Z') ? 0.1 : 0)
  }
  return { start: stStart, step: 10 * MIN, T, SRA }
}

/** Model: 7 °C pořád, srážky 0,4 mm v hodině 17–18 (hodnota v 18:00), pravděpodobnost 60 % */
function forecast(): HourlyForecast {
  const time: number[] = []
  for (let t = at('2026-11-20T00:00Z'); t <= at('2026-11-25T00:00Z'); t += H) time.push(t)
  return {
    time,
    temperature_2m: time.map(() => 7),
    precipitation: time.map((t) => (t === at('2026-11-22T18:00Z') ? 0.4 : 0)),
    precipitation_probability: time.map((t) => (t === at('2026-11-22T18:00Z') ? 60 : 5)),
  }
}

describe('buildTimeline', () => {
  const tl = buildTimeline(station(), forecast(), now)
  const hour = (iso: string) => tl.hours.find((h) => h.t === at(iso))!

  it('rozsah 24 h zpět a 24 h dopředu po celých hodinách', () => {
    expect(tl.from).toBe(at('2026-11-21T15:00Z'))
    expect(tl.to).toBe(at('2026-11-23T15:00Z'))
    expect(tl.hours).toHaveLength(49)
    expect(tl.lastObs).toBe(at('2026-11-22T14:50Z'))
  })

  it('do posledního měření teplota naměřená, potom předpověď', () => {
    expect(hour('2026-11-22T14:00Z')).toMatchObject({ temp: 5, tempSrc: 'measured' })
    expect(hour('2026-11-22T15:00Z').tempSrc).toBe('forecast')
    // Výpadek měření nenahrazuje model
    expect(hour('2026-11-22T09:00Z')).toMatchObject({ temp: null, tempSrc: null })
  })

  it('předpověď navazuje na měření a rozdíl se vytratí za 6 h', () => {
    expect(tl.offset).toBe(-2)
    expect(tl.forecast[0]).toEqual([at('2026-11-22T14:50Z'), 5])
    // 15:00 je 10 min po měření: 7 − 2·(1 − 10/360)
    expect(hour('2026-11-22T15:00Z').temp).toBeCloseTo(5.1, 5)
    expect(hour('2026-11-22T15:00Z').modelTemp).toBe(7)
    // 18:00 = 190 min po měření: 7 − 2·(1 − 190/360) = 6,06 → 6,1; od 20:50 čistý model
    expect(hour('2026-11-22T18:00Z').temp).toBe(6.1)
    expect(hour('2026-11-22T21:00Z').temp).toBe(7)
  })

  it('srážky: hodina 12–13 naměřená ze 6 intervalů, neúplná hodina z předpovědi', () => {
    expect(hour('2026-11-22T12:00Z')).toMatchObject({ mm: 0.6, mmSrc: 'measured', prob: null })
    expect(hour('2026-11-22T11:00Z')).toMatchObject({ mm: 0, mmSrc: 'measured' })
    // Hodina 13–14 je celá změřená (značka 14:00 existuje), 14–15 ještě ne (poslední značka 14:50)
    expect(hour('2026-11-22T13:00Z').mmSrc).toBe('measured')
    expect(hour('2026-11-22T14:00Z')).toMatchObject({ mm: 0, mmSrc: 'forecast', prob: 5 })
    // Model: hodnota v 18:00 platí pro hodinu 17–18
    expect(hour('2026-11-22T17:00Z')).toMatchObject({ mm: 0.4, mmSrc: 'forecast', prob: 60 })
  })

  it('naměřená čára jen do teď, s přerušením u výpadku', () => {
    expect(tl.measured[0][0]).toBe(at('2026-11-21T15:00Z'))
    expect(tl.measured.at(-1)![0]).toBe(at('2026-11-22T14:50Z'))
    expect(tl.measured.find(([t]) => t === at('2026-11-22T09:00Z'))![1]).toBeNull()
  })

  it('bez stanice: celá osa z modelu bez posunu', () => {
    const t2 = buildTimeline(null, forecast(), now)
    expect(t2.lastObs).toBeNull()
    expect(t2.offset).toBeNull()
    expect(t2.hours.every((h) => h.tempSrc === 'forecast' && h.temp === 7)).toBe(true)
  })

  it('bez předpovědi: jen měření', () => {
    const t3 = buildTimeline(station(), null, now)
    expect(t3.forecast).toEqual([[at('2026-11-22T14:50Z'), 5]])
    expect(t3.hours.filter((h) => h.tempSrc === 'forecast')).toHaveLength(0)
    expect(t3.hours.find((h) => h.t === at('2026-11-22T17:00Z'))!.mm).toBeNull()
  })
})

describe('interpHourly', () => {
  it('lineárně mezi hodinami, null mimo rozsah a u chybějící hodnoty', () => {
    const time = [0, H, 2 * H]
    expect(interpHourly(time, [0, 6, null], 30 * MIN)).toBe(3)
    expect(interpHourly(time, [0, 6, null], H)).toBe(6)
    expect(interpHourly(time, [0, 6, null], 90 * MIN)).toBeNull()
    expect(interpHourly(time, [0, 6, 1], 3 * H)).toBeNull()
  })
})
