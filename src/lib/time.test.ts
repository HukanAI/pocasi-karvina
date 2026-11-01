import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  formatDayPhrase,
  formatDuration,
  formatMoment,
  formatTime,
  HOUR,
  leapDayIndex,
  localDateKey,
  localMidnight,
  localParts,
  tzOffsetMs,
} from './time.ts'

describe('časové pásmo Europe/Prague', () => {
  it('zimní čas = UTC+1, letní čas = UTC+2', () => {
    expect(tzOffsetMs(Date.UTC(2026, 0, 15, 12))).toBe(HOUR)
    expect(tzOffsetMs(Date.UTC(2026, 6, 15, 12))).toBe(2 * HOUR)
  })

  it('přechod na zimní čas 25. 10. 2026 (3:00 CEST → 2:00 CET)', () => {
    // 00:59 UTC = 02:59 CEST, 01:00 UTC = 02:00 CET
    expect(formatTime(Date.UTC(2026, 9, 25, 0, 59))).toBe('02:59')
    expect(formatTime(Date.UTC(2026, 9, 25, 1, 0))).toBe('02:00')
    // den 25. 10. má 25 hodin
    expect(localMidnight('2026-10-26') - localMidnight('2026-10-25')).toBe(25 * HOUR)
  })

  it('přechod na letní čas 28. 3. 2027 (2:00 CET → 3:00 CEST), den má 23 hodin', () => {
    expect(localMidnight('2027-03-29') - localMidnight('2027-03-28')).toBe(23 * HOUR)
    expect(formatTime(Date.UTC(2027, 2, 28, 1, 0))).toBe('03:00')
  })

  it('localMidnight dává místní půlnoc', () => {
    expect(localMidnight('2026-10-29')).toBe(Date.UTC(2026, 9, 28, 23))
    expect(localMidnight('2026-07-01')).toBe(Date.UTC(2026, 5, 30, 22))
    const p = localParts(localMidnight('2026-03-29'))
    expect([p.day, p.hour, p.minute]).toEqual([29, 0, 0])
  })

  it('localDateKey respektuje místní datum, ne UTC', () => {
    // 23:30 UTC 28. 10. je už 29. 10. v Karviné
    expect(localDateKey(Date.UTC(2026, 9, 28, 23, 30))).toBe('2026-10-29')
  })
})

describe('kalendářní pomůcky', () => {
  it('addDays a daysBetween přes přelom roku a přestupný den', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365)
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366)
  })

  it('leapDayIndex: 1. 1. = 0, 29. 2. = 59, 1. 3. = 60, 31. 12. = 365', () => {
    expect(leapDayIndex(1, 1)).toBe(0)
    expect(leapDayIndex(2, 29)).toBe(59)
    expect(leapDayIndex(3, 1)).toBe(60)
    expect(leapDayIndex(12, 31)).toBe(365)
  })
})

describe('formátování', () => {
  it('formatDuration', () => {
    expect(formatDuration(3 * 24 * HOUR + 7 * HOUR + 12 * 60_000)).toBe('3 d 7 h 12 min')
    expect(formatDuration(5 * HOUR + 3 * 60_000)).toBe('5 h 3 min')
    expect(formatDuration(12 * 60_000)).toBe('12 min')
    expect(formatDuration(24 * HOUR)).toBe('1 d 0 h 0 min')
  })

  it('formatDayPhrase skloňuje den v týdnu a nezdvojuje tečku', () => {
    const now = Date.UTC(2026, 10, 1, 18) // ne 1. 11. 2026, 19:00 místního času
    expect(formatDayPhrase(Date.UTC(2026, 10, 1, 22), now)).toBe('dnes')
    expect(formatDayPhrase(Date.UTC(2026, 10, 2, 15), now)).toBe('zítra')
    expect(formatDayPhrase(Date.UTC(2026, 9, 31, 12), now)).toBe('včera')
    expect(formatDayPhrase(Date.UTC(2026, 10, 9, 12), now)).toBe('v pondělí 9. 11.')
    expect(formatDayPhrase(Date.UTC(2026, 10, 4, 12), now)).toBe('ve středu 4. 11.')
    expect(formatDayPhrase(Date.UTC(2026, 10, 7, 12), now)).toBe('v sobotu 7. 11.')
    // 23:30 UTC v neděli je už pondělí místního času
    expect(formatDayPhrase(Date.UTC(2026, 10, 8, 23, 30), now)).toBe('v pondělí 9. 11.')
  })

  it('formatMoment používá dnes/včera', () => {
    const now = Date.UTC(2026, 9, 29, 12)
    expect(formatMoment(Date.UTC(2026, 9, 29, 6), now)).toBe('dnes v 07:00')
    expect(formatMoment(Date.UTC(2026, 9, 28, 6), now)).toBe('včera v 07:00')
    expect(formatMoment(Date.UTC(2026, 9, 26, 6), now)).toMatch(/^po 26\. ?10\. v 07:00$/)
  })
})
