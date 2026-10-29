import { describe, expect, it } from 'vitest'
import {
  cumulativePrecip,
  dayHistory,
  dayNormal,
  dayRecords,
  drySpells,
  monthlyNormals,
  monthStats,
  temperatureGaps,
  trendPerDecade,
  yearlySeries,
  type DailySeries,
} from './climate.ts'
import { addDays, daysBetween } from './time.ts'

/** Vytvoří řadu, kde hodnotu každého dne určí funkce data */
function makeSeries(start: string, end: string, f: (date: string) => Partial<Record<'tmax' | 'tmin' | 'tmean' | 'prcp', number | null>>): DailySeries {
  const n = daysBetween(start, end) + 1
  const vars = { tmax: [] as (number | null)[], tmin: [] as (number | null)[], tmean: [] as (number | null)[], prcp: [] as (number | null)[] }
  for (let i = 0; i < n; i++) {
    const d = addDays(start, i)
    const r = f(d)
    vars.tmax.push(r.tmax ?? null)
    vars.tmin.push(r.tmin ?? null)
    vars.tmean.push(r.tmean ?? null)
    vars.prcp.push(r.prcp ?? null)
  }
  return { start, end, source: 'chmi', vars }
}

const year = (d: string) => Number(d.slice(0, 4))

describe('dayNormal', () => {
  it('průměr přes okno ±7 dní v letech 1991–2020', () => {
    // tmean = rok − 2000 → průměr let 1991..2020 = 5,5
    const s = makeSeries('1985-01-01', '2025-12-31', (d) => ({ tmean: year(d) - 2000 }))
    const n = dayNormal(s, 'tmean', 10, 29)
    expect(n.mean).toBeCloseTo(5.5, 10)
    expect(n.n).toBe(30 * 15)
    expect(n.years).toBe(30)
  })

  it('chybějící roky sníží počet let, ale neovlivní průměr ostatních', () => {
    const s = makeSeries('1985-01-01', '2025-12-31', (d) => ({ tmean: year(d) >= 2008 && year(d) <= 2010 ? null : 10 }))
    const n = dayNormal(s, 'tmean', 6, 15)
    expect(n.years).toBe(27)
    expect(n.mean).toBe(10)
  })

  it('okno přes přelom roku (1. 1. bere i prosinec předchozího roku)', () => {
    const s = makeSeries('1990-01-01', '2021-12-31', (d) => ({ tmean: d.slice(5, 7) === '12' ? 0 : 10 }))
    const n = dayNormal(s, 'tmean', 1, 1)
    // 7 prosincových dní (0) + 8 lednových (10) → 80/15
    expect(n.mean).toBeCloseTo(80 / 15, 10)
  })

  it('29. únor funguje i pro nepřestupné roky', () => {
    const s = makeSeries('1990-01-01', '2021-12-31', () => ({ tmean: 1 }))
    expect(dayNormal(s, 'tmean', 2, 29).years).toBe(30)
  })
})

describe('dayRecords a dayHistory', () => {
  const s = makeSeries('2000-01-01', '2005-12-31', (d) => {
    const y = year(d)
    if (d.slice(5) !== '07-15') return { tmax: 20, tmin: 10, prcp: 0 }
    return { tmax: [30, 35, 28, null, 31, 29][y - 2000], tmin: [15, 12, 18, null, 9, 14][y - 2000], prcp: [0, 40, 2, null, 0, 1][y - 2000] }
  })

  it('najde rekordy a rok', () => {
    const r = dayRecords(s, 7, 15)
    expect(r.highestMax).toEqual({ value: 35, year: 2001 })
    expect(r.lowestMax).toEqual({ value: 28, year: 2002 })
    expect(r.lowestMin).toEqual({ value: 9, year: 2004 })
    expect(r.highestMin).toEqual({ value: 18, year: 2002 })
    expect(r.wettest).toEqual({ value: 40, year: 2001 })
    expect(r.years).toBe(5) // rok 2003 chybí
    expect(r.firstYear).toBe(2000)
  })

  it('rekordy lze spočítat bez aktuálního roku', () => {
    expect(dayRecords(s, 7, 15, 2000).highestMax).toEqual({ value: 30, year: 2000 })
  })

  it('historie dne vynechá roky bez dat', () => {
    expect(dayHistory(s, 7, 15).map((r) => r.year)).toEqual([2000, 2001, 2002, 2004, 2005])
  })

  it('29. 2. jen v přestupných letech', () => {
    expect(dayHistory(s, 2, 29).map((r) => r.year)).toEqual([2000, 2004])
  })
})

describe('monthStats', () => {
  it('počty charakteristických dní a hranice (30 °C je tropický den, 0 °C není mrazový)', () => {
    const tmaxs = [30, 29.9, 25, 24.9, -0.1, 0]
    const tmins = [20, 19.9, 0, -0.1, -5, 0]
    const s = makeSeries('2026-07-01', '2026-07-31', (d) => {
      const i = Number(d.slice(8)) - 1
      return { tmax: tmaxs[i] ?? 20, tmin: tmins[i] ?? 10, prcp: i === 0 ? 1 : i === 1 ? 0.9 : 0 }
    })
    const m = monthStats(s, 2026, 7)
    expect(m.tropicalDays).toBe(1)
    expect(m.summerDays).toBe(3)
    expect(m.iceDays).toBe(1)
    expect(m.frostDays).toBe(2)
    expect(m.tropicalNights).toBe(1)
    expect(m.wetDays).toBe(1)
    expect(m.prcp).toBe(1.9)
    expect(m.coverageT).toBe(1)
  })

  it('průměr z (Tmax+Tmin)/2, když chybí denní průměr', () => {
    const s = makeSeries('2026-01-01', '2026-01-31', () => ({ tmax: 4, tmin: -2, prcp: 0 }))
    expect(monthStats(s, 2026, 1).tmean).toBe(1)
  })

  it('neúplný měsíc: teplota až od 90 % pokrytí, úhrn srážek jen z úplných dat', () => {
    const s = makeSeries('2026-01-01', '2026-01-31', (d) => {
      const day = Number(d.slice(8))
      return { tmean: day <= 28 ? 1 : null, prcp: day <= 30 ? 1 : null }
    })
    const m = monthStats(s, 2026, 1)
    expect(m.tmean).toBe(1) // 28/31 = 90,3 %
    expect(m.prcp).toBeNull() // 30/31 – úhrn by byl zkreslený
    const s2 = makeSeries('2026-01-01', '2026-01-31', (d) => ({ tmean: Number(d.slice(8)) <= 27 ? 1 : null }))
    expect(monthStats(s2, 2026, 1).tmean).toBeNull() // 27/31 = 87 %
  })
})

describe('monthlyNormals', () => {
  it('průměr přes úplné měsíce', () => {
    const s = makeSeries('1991-01-01', '2020-12-31', (d) => ({ tmean: year(d) % 2 ? 2 : 4, prcp: 1 }))
    const n = monthlyNormals(s)
    expect(n[0].tmean).toBe(3)
    expect(n[0].prcp).toBe(31)
    expect(n[1].prcp).toBeCloseTo((22 * 28 + 8 * 29) / 30, 1) // únor s přestupnými roky
    expect(n[0].yearsT).toBe(30)
  })
})

describe('roční řada a trend', () => {
  const s = makeSeries('1961-01-01', '2026-10-28', (d) => {
    const y = year(d)
    if (y >= 1979 && y <= 1987) return {}
    return { tmean: 7 + (y - 1961) * 0.03, prcp: 2 }
  })

  it('aktuální neúplný rok se vynechá, mezery jsou null', () => {
    const rows = yearlySeries(s)
    expect(rows[rows.length - 1].year).toBe(2025)
    expect(rows.find((r) => r.year === 1980)?.tmean).toBeNull()
    expect(temperatureGaps(rows)).toEqual([{ from: 1979, to: 1987 }])
  })

  it('trend 0,03 °C/rok = 0,3 °C za desetiletí', () => {
    const t = trendPerDecade(yearlySeries(s))
    expect(t?.perDecade).toBeCloseTo(0.3, 6)
    expect(t?.n).toBe(65 - 9)
  })
})

describe('cumulativePrecip', () => {
  it('kumuluje skutečnost i normál; budoucí dny jsou null', () => {
    const s = makeSeries('1991-01-01', '2026-03-10', () => ({ prcp: 1 }))
    const c = cumulativePrecip(s, 2026)
    expect(c.actual).toHaveLength(365)
    expect(c.normal).toHaveLength(365)
    expect(c.actual[0]).toBe(1)
    expect(c.actual[68]).toBe(69) // 10. 3.
    expect(c.actual[69]).toBeNull()
    expect(c.normal[364]).toBeCloseTo(365, 0)
    expect(c.missing).toBe(false)
  })
})

describe('drySpells', () => {
  it('suchá období < 1 mm, chybějící údaj období přeruší', () => {
    const p: Record<string, number | null> = { '01': 5, '02': 0, '03': 0.9, '04': 0, '05': 1, '06': 0, '07': null, '08': 0, '09': 0 }
    const s = makeSeries('2026-05-01', '2026-05-09', (d) => ({ prcp: p[d.slice(8)] }))
    expect(drySpells(s)).toEqual([
      { start: '2026-05-02', end: '2026-05-04', days: 3 },
      { start: '2026-05-08', end: '2026-05-09', days: 2 },
      { start: '2026-05-06', end: '2026-05-06', days: 1 },
    ])
  })
})
