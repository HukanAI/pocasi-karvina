import { describe, expect, it } from 'vitest'
import { todayRange } from './todayRange.ts'

describe('todayRange – max/min dneška v nadpisu', () => {
  // 2. 11. 2026, 18:33 místního času (UTC+1)
  const now = Date.UTC(2026, 10, 2, 17, 33)
  const hourly = {
    // 17:00 … 02:00 místního času; hodnota v 00:00 už patří dalšímu dni
    time: Array.from({ length: 10 }, (_, k) => Date.UTC(2026, 10, 2, 16 + k)),
    temperature_2m: [6.4, 6.2, 6.1, 6.0, 5.9, 5.6, 5.2, 4.1, 3.0, 2.5],
  }
  it('skutečný případ: model 8°/5° vs. naměřeno 7,4/6,1 → max podle měření, min podle zbytku dne', () => {
    expect(todayRange(hourly, { tmax: 7.4, tmin: 6.1 }, { tmax: 8, tmin: 5 }, now)).toEqual({ tmax: 7.4, tmin: 5.2 })
  })
  it('bez čerstvého měření zůstane denní max/min modelu', () => {
    expect(todayRange(hourly, null, { tmax: 8, tmin: 5 }, now)).toEqual({ tmax: 8, tmin: 5 })
  })
  it('ve 23:50 (žádná další hodina dne) = jen měření', () => {
    expect(todayRange(hourly, { tmax: 7.4, tmin: 6.1 }, { tmax: 8, tmin: 5 }, Date.UTC(2026, 10, 2, 22, 50))).toEqual({ tmax: 7.4, tmin: 6.1 })
  })
})
