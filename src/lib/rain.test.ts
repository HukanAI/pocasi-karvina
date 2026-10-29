import { describe, expect, it } from 'vitest'
import {
  buildRainEvents,
  expectedRainEnd,
  findGaps,
  lastWetDay,
  mergeSamples,
  nextRain,
  rainState,
  type ForecastPrecip,
  type PrecipSample,
} from './rain.ts'
import { MINUTE } from './time.ts'

const T0 = Date.UTC(2026, 9, 26, 0, 0) // 26. 10. 2026 00:00 UTC
const M10 = 10 * MINUTE
const M15 = 15 * MINUTE

/** 10min řada stanice: values[i] je úhrn intervalu končícího v T0 + (i+1)·10 min */
function station(values: number[], from = T0): PrecipSample[] {
  return values.map((mm, i) => ({ t: from + (i + 1) * M10, dur: M10, mm, src: 'station' as const }))
}

describe('buildRainEvents', () => {
  it('epizoda začíná začátkem prvního a končí koncem posledního mokrého intervalu', () => {
    const ev = buildRainEvents(station([0, 0.2, 0.3, 0, 0]))
    expect(ev).toHaveLength(1)
    expect(ev[0].start).toBe(T0 + M10) // interval (10, 20] začíná v 10. minutě
    expect(ev[0].end).toBe(T0 + 3 * M10)
    expect(ev[0].total).toBe(0.5)
    expect(ev[0].peakRate).toBeCloseTo(1.8) // 0,3 mm za 10 min = 1,8 mm/h
  })

  it('přestávka ≤ 30 min epizodu nepřeruší, delší ano', () => {
    // mokro, 3× sucho (30 min), mokro → jedna epizoda
    expect(buildRainEvents(station([0.1, 0, 0, 0, 0.1]))).toHaveLength(1)
    // mokro, 4× sucho (40 min), mokro → dvě epizody
    expect(buildRainEvents(station([0.1, 0, 0, 0, 0, 0.1]))).toHaveLength(2)
  })

  it('hodnoty pod 0,1 mm se nepočítají jako déšť, přesně 0,1 mm ano (hranice)', () => {
    expect(buildRainEvents(station([0.05, 0.09]))).toHaveLength(0)
    expect(buildRainEvents(station([0.1]))).toHaveLength(1)
  })

  it('součet se zaokrouhlí, aby nevznikaly artefakty 0,30000000000000004', () => {
    expect(buildRainEvents(station([0.1, 0.2]))[0].total).toBe(0.3)
  })
})

describe('rainState', () => {
  it('suchý stav: počítá od konce posledního deště', () => {
    const s = station([0.4, 0.2, 0, 0, 0, 0, 0, 0])
    const now = T0 + 8 * M10 + 5 * MINUTE
    const st = rainState(s, now)
    expect(st.kind).toBe('dry')
    if (st.kind !== 'dry') return
    expect(st.since).toBe(T0 + 2 * M10)
    expect(st.lastEvent.total).toBe(0.6)
    expect(st.drizzleNow).toBe(false)
    expect(st.missingMs).toBe(0)
  })

  it('právě prší: poslední interval je mokrý', () => {
    const st = rainState(station([0, 0, 0.3, 0.5]), T0 + 4 * M10 + MINUTE)
    expect(st).toMatchObject({ kind: 'raining', since: T0 + 2 * M10, total: 0.8, startSrc: 'station', src: 'station' })
  })

  it('mrholení pod minimálním úhrnem nepřeruší suché období', () => {
    // Velký déšť, pak dlouho sucho a teď slabě mrholí 0,1 mm
    const values = [2, ...Array(20).fill(0), 0.1]
    const st = rainState(station(values), T0 + values.length * M10, 0.5)
    expect(st.kind).toBe('dry')
    if (st.kind !== 'dry') return
    expect(st.since).toBe(T0 + M10)
    expect(st.drizzleNow).toBe(true)
  })

  it('starší slabá epizoda pod prahem se přeskočí', () => {
    const values = [1.5, ...Array(10).fill(0), 0.2, ...Array(10).fill(0)]
    const st = rainState(station(values), T0 + values.length * M10, 0.5)
    expect(st.kind === 'dry' && st.since).toBe(T0 + M10)
    const st2 = rainState(station(values), T0 + values.length * M10, 0.1)
    expect(st2.kind === 'dry' && st2.since).toBe(T0 + 12 * M10)
  })

  it('bez deště v datech → unknown s informací, odkud data pokrývají', () => {
    const st = rainState(station([0, 0, 0]), T0 + 3 * M10)
    expect(st).toEqual({ kind: 'unknown', coveredFrom: T0 })
  })

  it('prázdná data → unknown', () => {
    expect(rainState([], T0)).toEqual({ kind: 'unknown', coveredFrom: null })
  })

  it('ignoruje vzorky z budoucnosti', () => {
    const s = station([0.5, 0, 0, 0, 0, 3])
    const st = rainState(s, T0 + 5 * M10) // poslední (mokrý) interval končí až v T0+60
    expect(st.kind).toBe('dry')
  })

  it('započítá chybějící data od posledního deště', () => {
    const s = [...station([0.5, 0]), ...station([0, 0], T0 + 12 * M10)] // díra 20→120 min
    const st = rainState(s, T0 + 14 * M10)
    expect(st.kind === 'dry' && st.missingMs).toBe(100 * MINUTE)
  })
})

describe('mergeSamples', () => {
  it('model doplní jen úsek po posledním měření stanice', () => {
    const st = station([0, 0, 0]) // do T0+30
    const model: PrecipSample[] = [
      { t: T0 + 15 * MINUTE, dur: M15, mm: 9, src: 'model' }, // překrývá stanici → zahodit
      { t: T0 + 30 * MINUTE, dur: M15, mm: 9, src: 'model' }, // (15, 30] překrývá → zahodit
      { t: T0 + 45 * MINUTE, dur: M15, mm: 0.4, src: 'model' }, // (30, 45] → použít
      { t: T0 + 60 * MINUTE, dur: M15, mm: 0.4, src: 'model' }, // budoucnost → zahodit
    ]
    const merged = mergeSamples(st, model, T0 + 50 * MINUTE)
    expect(merged.map((s) => s.src)).toEqual(['station', 'station', 'station', 'model'])
    const state = rainState(merged, T0 + 50 * MINUTE)
    expect(state).toMatchObject({ kind: 'raining', src: 'model', startSrc: 'model', since: T0 + 30 * MINUTE })
  })

  it('déšť naměřený stanicí, který podle modelu pokračuje: začátek ze stanice, stav z modelu', () => {
    const st = station([0, 0.3, 0.2]) // déšť od 10. minuty, poslední měření v 30. minutě
    const model: PrecipSample[] = [{ t: T0 + 45 * MINUTE, dur: M15, mm: 0.2, src: 'model' }]
    const state = rainState(mergeSamples(st, model, T0 + 50 * MINUTE), T0 + 50 * MINUTE)
    expect(state).toMatchObject({ kind: 'raining', since: T0 + M10, total: 0.7, startSrc: 'station', src: 'model' })
  })

  it('bez dat stanice použije celý model', () => {
    const model: PrecipSample[] = [{ t: T0 + M15, dur: M15, mm: 0, src: 'model' }]
    expect(mergeSamples([], model, T0 + M15)).toHaveLength(1)
  })
})

describe('findGaps', () => {
  it('souvislá data nemají mezery', () => {
    expect(findGaps(station([0, 0, 0, 0]), T0, T0 + 4 * M10)).toEqual([])
  })
})

describe('předpověď deště', () => {
  const now = T0 + 5 * MINUTE
  const fc = (vals: number[], prob?: number): ForecastPrecip[] =>
    vals.map((mm, i) => ({ t: T0 + (i + 1) * M15, dur: M15, mm, src: 'model' as const, prob }))

  it('nextRain vrátí začátek prvního mokrého intervalu', () => {
    expect(nextRain(fc([0, 0, 0.3], 70), now)).toEqual({ at: T0 + 2 * M15, mm: 0.3, prob: 70 })
    expect(nextRain(fc([0, 0, 0]), now)).toBeNull()
  })

  it('nextRain u probíhajícího intervalu vrátí „teď“, ne minulost', () => {
    expect(nextRain(fc([0.2]), now)?.at).toBe(now)
  })

  it('expectedRainEnd najde konec deště včetně krátké přestávky', () => {
    expect(expectedRainEnd(fc([0.2, 0.2, 0, 0.1, 0, 0, 0, 0, 0]), now)).toBe(T0 + 4 * M15)
    expect(expectedRainEnd(fc([0, 0, 0]), now)).toBe(now)
  })
})

describe('lastWetDay', () => {
  it('najde poslední den se srážkou ≥ prahu', () => {
    const d = [
      { date: '2026-10-01', mm: 3 },
      { date: '2026-10-02', mm: 0.1 },
      { date: '2026-10-03', mm: 0 },
      { date: '2026-10-04', mm: null },
    ]
    expect(lastWetDay(d)).toBe('2026-10-02')
    expect(lastWetDay(d, 1)).toBe('2026-10-01')
    expect(lastWetDay([])).toBeNull()
  })
})
