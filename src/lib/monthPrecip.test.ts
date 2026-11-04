import { describe, expect, it } from 'vitest'
import type { DailySeries } from './climate.ts'
import type { RegularSeries } from './dataTypes.ts'
import { daysInMonth, firstPrecipMonth, monthPrecip, precipDayStart, sumPrecipDay } from './monthPrecip.ts'
import { addDays, daysBetween } from './time.ts'

const MIN = 60_000

/** Denní řada srážek: f(date) → mm */
function daily(start: string, end: string, f: (date: string) => number | null): DailySeries {
  const n = daysBetween(start, end) + 1
  return { start, end, source: 'chmi', vars: { prcp: Array.from({ length: n }, (_, i) => f(addDays(start, i))) } }
}

/** 10min řada od `from` do `to` (značky), hodnota podle času */
function sra10(from: string, to: string, f: (t: number) => number | null): RegularSeries {
  const a = Date.parse(from)
  const b = Date.parse(to)
  const values: (number | null)[] = []
  for (let t = a; t <= b; t += 10 * MIN) values.push(f(t))
  return { start: a, step: 10 * MIN, values }
}

// Normálové období 1991–2020 se 2 mm každý den, pak „letošek“ do 2. 11. 2026
const s = daily('1990-01-01', '2026-11-02', (d) => (d < '2021-01-01' ? 2 : d === '2026-11-02' ? 4.5 : d === '2026-10-15' ? null : 0.5))

describe('sumPrecipDay – den ČHMÚ 7:00–7:00 SEČ', () => {
  it('značka 05:50 UTC patří předchozímu dni, 06:00 UTC už novému', () => {
    const r = sra10('2026-11-02T00:00Z', '2026-11-04T12:00Z', (t) => {
      const iso = new Date(t).toISOString()
      if (iso === '2026-11-03T05:50:00.000Z') return 1 // ještě 2. 11.
      if (iso === '2026-11-03T06:00:00.000Z') return 2 // už 3. 11.
      if (iso === '2026-11-04T05:50:00.000Z') return 0.3 // poslední interval 3. 11.
      return 0
    })
    expect(sumPrecipDay(r, '2026-11-02')).toMatchObject({ mm: 1, complete: true })
    expect(sumPrecipDay(r, '2026-11-03')).toMatchObject({ mm: 2.3, complete: true, gapMinutes: 0 })
    // 4. 11. běží: od 06:00 do 12:00 UTC
    expect(sumPrecipDay(r, '2026-11-04')).toMatchObject({ mm: 0, complete: false, until: Date.parse('2026-11-04T12:00Z') })
  })

  it('zásoba začínající až po začátku dne se nepoužije (neúplný součet)', () => {
    const r = sra10('2026-11-03T08:00Z', '2026-11-04T12:00Z', () => 1)
    expect(sumPrecipDay(r, '2026-11-03')).toBeNull()
    expect(sumPrecipDay(r, '2026-11-04')?.mm).toBe(37) // 06:00…12:00 = 37 značek
  })

  it('výpadek měření se hlásí v minutách, den bez jediné hodnoty je null', () => {
    const r = sra10('2026-11-03T00:00Z', '2026-11-05T00:00Z', (t) => (t >= Date.parse('2026-11-03T10:00Z') && t < Date.parse('2026-11-03T11:00Z') ? null : 0.1))
    const d = sumPrecipDay(r, '2026-11-03')!
    expect(d.gapMinutes).toBe(60)
    expect(d.mm).toBe(13.8) // 144 − 6 značek × 0,1
    expect(sumPrecipDay(sra10('2026-11-03T00:00Z', '2026-11-05T00:00Z', () => null), '2026-11-03')).toBeNull()
  })

  it('začátek dne = 06:00 UTC i v létě (SEČ, ne SELČ)', () => {
    expect(new Date(precipDayStart('2026-07-15')).toISOString()).toBe('2026-07-15T06:00:00.000Z')
  })
})

describe('monthPrecip', () => {
  // „Teď“ = 4. 11. 2026 15:00 UTC; 10min data do 14:50 UTC
  const now = Date.parse('2026-11-04T15:00Z')
  const r = sra10('2026-10-20T00:00Z', '2026-11-04T14:50Z', (t) => {
    const iso = new Date(t).toISOString()
    if (iso.startsWith('2026-11-03T1')) return 0.2 // 10:00–19:50 UTC 3. 11. = 60 značek → 12 mm
    if (iso.startsWith('2026-11-04T08')) return 0.1 // 6 značek → 0,6 mm
    return 0
  })

  it('oficiální úhrn má přednost, chybějící dny doplní 10min data, budoucí jsou prázdné', () => {
    const m = monthPrecip(s, r, 2026, 11, now)
    expect(m.days).toHaveLength(30)
    expect(m.days[0]).toMatchObject({ date: '2026-11-01', mm: 0.5, status: 'measured' })
    expect(m.days[1]).toMatchObject({ mm: 4.5, status: 'measured' })
    expect(m.days[2]).toMatchObject({ mm: 12, status: 'prelim' })
    expect(m.days[3]).toMatchObject({ mm: 0.6, status: 'partial', until: Date.parse('2026-11-04T14:50Z') })
    expect(m.days[4]).toMatchObject({ mm: null, status: 'future' })
    expect(m.lastIndex).toBe(3)
    expect(m.total).toBe(17.6)
    expect(m.cumulative.slice(0, 5)).toEqual([0.5, 5, 17, 17.6, null])
    expect(m.wetDays).toBe(2)
    expect(m.max?.date).toBe('2026-11-03')
    expect(m.complete).toBe(false)
  })

  it('normál: součet denních průměrů 1991–2020', () => {
    const m = monthPrecip(s, r, 2026, 11, now)
    expect(m.days[0].normal).toBe(2)
    expect(m.normalTotal).toBe(60)
    expect(m.normalToDate).toBe(8)
    expect(m.normalCumulative[29]).toBe(60)
  })

  it('den, který právě začal a ještě nemá data, není „chybějící“', () => {
    const early = Date.parse('2026-11-04T06:30Z')
    const rr = sra10('2026-10-20T00:00Z', '2026-11-04T05:50Z', () => 0)
    const m = monthPrecip(s, rr, 2026, 11, early)
    expect(m.days[3].status).toBe('future')
    expect(m.missingDays).toBe(0)
    // Před 7:00 SEČ den ještě nezačal vůbec
    expect(monthPrecip(s, rr, 2026, 11, Date.parse('2026-11-04T05:59Z')).days[3].status).toBe('future')
  })

  it('proběhlý den bez dat = chybí; úplný minulý měsíc', () => {
    const m = monthPrecip(s, null, 2026, 10, now)
    expect(m.days[14]).toMatchObject({ date: '2026-10-15', mm: null, status: 'missing' })
    expect(m.missingDays).toBe(1)
    expect(m.knownDays).toBe(30)
    expect(m.complete).toBe(false)
    expect(m.total).toBe(15) // 30 dní × 0,5
    expect(m.lastIndex).toBe(30)
    const sep = monthPrecip(s, null, 2026, 9, now)
    expect(sep.complete).toBe(true)
    expect(sep.normalToDate).toBe(sep.normalTotal)
  })

  it('přestupný únor a měsíc mimo řadu', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    const m = monthPrecip(s, null, 1980, 2, now)
    expect(m.days).toHaveLength(29)
    expect(m.days.every((d) => d.status === 'missing')).toBe(true)
    expect(m.knownDays).toBe(0)
    expect(m.max).toBeNull()
  })

  it('první měsíc se srážkami', () => {
    const t = daily('1877-01-01', '1877-05-01', (d) => (d >= '1877-03-10' ? 1 : null))
    expect(firstPrecipMonth(t)).toEqual({ year: 1877, month: 3 })
  })
})
