import { describe, expect, it } from 'vitest'
import { type AlertForecast, evaluateAlerts, isSummaryTime, lastSentAt, morningSummary, newAlerts, nightMin, type RainSoonInput, rainSoonAlert, recordSent } from './alerts.ts'
import type { WarningItem } from './dataTypes.ts'
import { DAY, HOUR, localMidnight, MINUTE } from './time.ts'

// „Teď“ = čtvrtek 29. 10. 2026 12:00 místního času (CET = UTC+1)
const NOW = Date.UTC(2026, 9, 29, 11, 0)
const START = localMidnight('2026-10-28')
const DATES = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']

type HourVals = { temp: number; precip: number; rain: number; code: number; gust: number }

/** Hodinová předpověď od 28. 10. 00:00 na 5 dní; hodnoty jednotlivých hodin určí funkce času */
function fc(f: (t: number) => Partial<HourVals> = () => ({}), daily: { sum?: number } = {}): AlertForecast {
  const time: number[] = []
  for (let t = START; t < START + 5 * DAY; t += HOUR) time.push(t)
  const v = time.map((t) => ({ temp: 5, precip: 0, rain: 0, code: 3, gust: 20, ...f(t) }))
  const days = DATES.map((d) => localMidnight(d))
  return {
    hourly: {
      time,
      temperature_2m: v.map((x) => x.temp),
      precipitation: v.map((x) => x.precip),
      rain: v.map((x) => x.rain),
      weather_code: v.map((x) => x.code),
      wind_gusts_10m: v.map((x) => x.gust),
    },
    daily: {
      time: days,
      temperature_2m_max: days.map(() => 10),
      temperature_2m_min: days.map(() => 2),
      precipitation_sum: days.map(() => daily.sum ?? 0),
      precipitation_probability_max: days.map(() => 50),
      weather_code: days.map(() => 3),
      wind_gusts_10m_max: days.map(() => 30),
    },
  }
}

const keys = (f: AlertForecast, extra = {}) => evaluateAlerts({ now: NOW, forecast: f, ...extra }).map((a) => a.key)
const at = (date: string, hour: number) => localMidnight(date) + hour * HOUR

describe('nightMin', () => {
  it('hledá minimum mezi 18:00 předchozího dne a 9:00 (polední hodnota se nepočítá)', () => {
    const f = fc((t) => ({ temp: t === at('2026-10-30', 5) ? -3 : t === at('2026-10-30', 12) ? -9 : 5 }))
    expect(nightMin(f, '2026-10-30')).toEqual({ value: -3, at: at('2026-10-30', 5) })
  })
})

describe('mráz', () => {
  const frostAt = (v: number, prevNight = 5) =>
    fc((t) => ({ temp: t === at('2026-10-30', 6) ? v : t === at('2026-10-29', 6) ? prevNight : 5 }))

  it('0 °C ještě není mráz, −0,1 °C už ano (hranice)', () => {
    expect(keys(frostAt(0))).not.toContain('frost:2026-10-30')
    expect(keys(frostAt(-0.1))).toContain('frost:2026-10-30')
  })

  it('neupozorňuje, pokud mrzlo už předchozí noc (jen nástup mrazů)', () => {
    expect(keys(frostAt(-2, -1))).not.toContain('frost:2026-10-30')
  })

  it('silný mráz od −10 °C včetně upozorní vždy', () => {
    expect(keys(frostAt(-10, -8))).toContain('strongfrost:2026-10-30')
    expect(keys(frostAt(-9.9, -8))).not.toContain('strongfrost:2026-10-30')
  })
})

describe('náledí', () => {
  it('mrznoucí déšť (kód 66) nebo déšť při ≤ 0 °C', () => {
    expect(keys(fc((t) => (t === at('2026-10-29', 20) ? { code: 66 } : {})))).toContain('glaze:2026-10-29')
    expect(keys(fc((t) => (t === at('2026-10-29', 20) ? { rain: 0.2, temp: 0 } : {})))).toContain('glaze:2026-10-29')
    expect(keys(fc((t) => (t === at('2026-10-29', 20) ? { rain: 0.2, temp: 0.1 } : {})))).not.toContain('glaze:2026-10-29')
  })
})

describe('bouřka, déšť, vítr, ochlazení', () => {
  it('bouřka v příštích 24 h (95–99), ale ne za 30 h', () => {
    expect(keys(fc((t) => (t === at('2026-10-29', 18) ? { code: 95 } : {})))).toContain('storm:2026-10-29')
    expect(keys(fc((t) => (t === NOW + 30 * HOUR ? { code: 99 } : {})))).not.toContain('storm:2026-10-30')
  })

  it('hodinový úhrn 10 mm ano, 9,9 mm ne', () => {
    expect(keys(fc((t) => (t === at('2026-10-29', 15) ? { precip: 10 } : {})))).toContain('rainhour:2026-10-29')
    expect(keys(fc((t) => (t === at('2026-10-29', 15) ? { precip: 9.9 } : {})))).not.toContain('rainhour:2026-10-29')
  })

  it('denní úhrn 20 mm ano, 19,9 mm ne', () => {
    expect(keys(fc(undefined, { sum: 20 }))).toEqual(expect.arrayContaining(['rainday:2026-10-29', 'rainday:2026-10-30']))
    expect(keys(fc(undefined, { sum: 19.9 })).filter((k) => k.startsWith('rainday'))).toEqual([])
  })

  it('nárazy přesně 60 km/h ano, 59,9 ne', () => {
    expect(keys(fc((t) => (t === at('2026-10-29', 22) ? { gust: 60 } : {})))).toContain('gust:2026-10-29')
    expect(keys(fc((t) => (t === at('2026-10-29', 22) ? { gust: 59.9 } : {})))).not.toContain('gust:2026-10-29')
  })

  it('ochlazení o 10 °C za 24 h ano, o 9,9 ne', () => {
    const drop = (d: number) => fc((t) => (t === at('2026-10-29', 14) ? { temp: 15 } : t === at('2026-10-30', 14) ? { temp: 15 - d } : {}))
    expect(keys(drop(10))).toContain('drop:2026-10-30')
    expect(keys(drop(9.9))).not.toContain('drop:2026-10-30')
  })

  it('klidné počasí → žádná upozornění', () => {
    expect(keys(fc())).toEqual([])
  })
})

describe('smog', () => {
  const air = (pm10: number, pm25: number, hours = 24) => {
    const time: number[] = []
    for (let h = 1; h <= hours; h++) time.push(at('2026-10-29', 0) + h * HOUR)
    return { hourly: { time, pm10: time.map(() => pm10), pm2_5: time.map(() => pm25), european_aqi: time.map(() => 50) } }
  }

  it('PM10 nad 50 nebo PM2,5 nad 25 (ostře větší)', () => {
    expect(keys(fc(), { air: air(50.1, 10) })).toContain('smog:2026-10-29')
    expect(keys(fc(), { air: air(50, 25) })).not.toContain('smog:2026-10-29')
    expect(keys(fc(), { air: air(20, 25.1) })).toContain('smog:2026-10-29')
  })

  it('den s méně než 18 hodinovými hodnotami se nehodnotí', () => {
    expect(keys(fc(), { air: air(200, 200, 17) })).not.toContain('smog:2026-10-29')
  })
})

describe('výstrahy ČHMÚ', () => {
  const w = (expires: string): WarningItem => ({
    id: 'X1',
    event: 'Silný vítr',
    severity: 'Moderate',
    level: 'yellow',
    certainty: 'Likely',
    onset: '2026-10-29T10:00:00+01:00',
    expires,
    description: 'Nárazy 70 km/h.',
    instruction: '',
    area: 'Karviná',
    sent: '2026-10-29T08:00:00+01:00',
  })

  it('platná výstraha se pošle, prošlá ne', () => {
    expect(keys(fc(), { warnings: [w('2026-10-29T20:00:00+01:00')] })).toContain('warn:X1')
    expect(keys(fc(), { warnings: [w('2026-10-29T11:00:00+01:00')] })).not.toContain('warn:X1')
  })
})

describe('deduplikace', () => {
  it('stejné upozornění se podruhé nepošle; záznamy starší 14 dní se smažou', () => {
    const alerts = evaluateAlerts({ now: NOW, forecast: fc((t) => (t === at('2026-10-29', 22) ? { gust: 80 } : {})) })
    expect(alerts).toHaveLength(1)
    let state = { sent: { 'old:key': new Date(NOW - 15 * DAY).toISOString() } as Record<string, string> }
    const first = newAlerts(alerts, state)
    expect(first).toHaveLength(1)
    state = recordSent(state, first.map((a) => a.key), NOW)
    expect(state.sent['old:key']).toBeUndefined()
    expect(newAlerts(alerts, state)).toHaveLength(0)
  })
})

describe('ranní souhrn', () => {
  it('čas souhrnu: od 6:30 do 9:59 místního času, i v letním čase', () => {
    expect(isSummaryTime(at('2026-10-29', 6) + 29 * 60_000)).toBe(false)
    expect(isSummaryTime(at('2026-10-29', 6) + 30 * 60_000)).toBe(true)
    expect(isSummaryTime(at('2026-10-29', 9) + 59 * 60_000)).toBe(true)
    expect(isSummaryTime(at('2026-10-29', 10))).toBe(false)
    // Letní čas (UTC+2): 6:45 místního = 4:45 UTC, 10:00 místního = 8:00 UTC
    expect(isSummaryTime(Date.UTC(2026, 6, 1, 4, 45))).toBe(true)
    expect(isSummaryTime(Date.UTC(2026, 6, 1, 8, 0))).toBe(false)
  })

  it('obsahuje dnešní teploty, naměřené minimum a klíč dne', () => {
    const s = morningSummary({ now: at('2026-10-29', 7), forecast: fc() }, { stationNightMin: -1.2 })
    expect(s?.key).toBe('summary:2026-10-29')
    expect(s?.message).toContain('2 °C až 10 °C')
    expect(s?.message).toContain('−1,2 °C')
    expect(s?.title).toMatch(/čtvrtek 29\. ?10\./)
  })
})

describe('brzy začne pršet', () => {
  // NOW = 12:00 místního času; poslední radarový snímek 11:55, nowcasting po 10 min dál
  const obs = (wetAt: number[] = [], dbz = 25) =>
    Array.from({ length: 24 }, (_, k) => NOW - 5 * MINUTE - (23 - k) * 5 * MINUTE).map((t) => ({ t, dbz: wetAt.includes(t) ? dbz : null }))
  const nowcast = (wetFromMin: number | null, dbz = 30) =>
    Array.from({ length: 6 }, (_, k) => NOW - 5 * MINUTE + (k + 1) * 10 * MINUTE).map((t) => ({ t, dbz: wetFromMin != null && t >= NOW + wetFromMin * MINUTE ? dbz : null }))
  const quarters = (wetFromMin: number | null, mm = 0.3) =>
    Array.from({ length: 8 }, (_, k) => NOW - 15 * MINUTE + k * 15 * MINUTE).map((start) => ({ start, end: start + 15 * MINUTE, mm: wetFromMin != null && start >= NOW + wetFromMin * MINUTE ? mm : 0 }))
  const input = (o: Partial<RainSoonInput> = {}): RainSoonInput => ({
    now: NOW,
    obsHere: obs(),
    obsNearby: null,
    nowcastHere: nowcast(null),
    quarters: quarters(null),
    tempC: 8,
    lastSentAt: null,
    ...o,
  })

  it('nowcasting: srážky dorazí za ~25 min → upozornění s časem a intenzitou', () => {
    const a = rainSoonAlert(input({ nowcastHere: nowcast(25) }))
    expect(a?.title).toBe('Brzy začne pršet')
    expect(a?.message).toMatch(/^Za 25 min \(kolem 12:25\) začne v Karviné pršet – mírné srážky \(asi 3 mm\/h\)\.\nPodle nowcastingu ČHMÚ/)
  })
  it('právě prší nebo pršelo v poslední hodině → nic (stejný déšť)', () => {
    expect(rainSoonAlert(input({ obsHere: obs([NOW - 5 * MINUTE]), nowcastHere: nowcast(15) }))).toBeNull()
    expect(rainSoonAlert(input({ obsHere: obs([NOW - 50 * MINUTE]), nowcastHere: nowcast(15) }))).toBeNull()
    expect(rainSoonAlert(input({ obsHere: obs([NOW - 70 * MINUTE]), nowcastHere: nowcast(15) }))).not.toBeNull()
  })
  it('mrholení pod prahem (10 dBZ) → nic', () => {
    expect(rainSoonAlert(input({ nowcastHere: nowcast(15, 10) }))).toBeNull()
  })
  it('noční klid 22–6 h', () => {
    const at = (h: number) => rainSoonAlert(input({ now: NOW + (h - 12) * HOUR, obsHere: obs().map((p) => ({ ...p, t: p.t + (h - 12) * HOUR })), nowcastHere: nowcast(15).map((p) => ({ ...p, t: p.t + (h - 12) * HOUR })) }))
    expect(at(22)).toBeNull()
    expect(at(5)).toBeNull()
    expect(at(6)).not.toBeNull()
    expect(at(21)).not.toBeNull()
  })
  it('nejvýš jednou za 3 hodiny', () => {
    expect(rainSoonAlert(input({ nowcastHere: nowcast(15), lastSentAt: NOW - 2 * HOUR }))).toBeNull()
    expect(rainSoonAlert(input({ nowcastHere: nowcast(15), lastSentAt: NOW - 3 * HOUR }))).not.toBeNull()
  })
  it('model jen s potvrzením radaru v okolí', () => {
    expect(rainSoonAlert(input({ quarters: quarters(30) }))).toBeNull()
    const a = rainSoonAlert(input({ quarters: quarters(30), obsNearby: 20 }))
    expect(a?.message).toMatch(/^Za 30 min \(kolem 12:30\).*\nPodle modelu ICON-D2/s)
    // srážky mimo hodinové okno se nehlásí
    expect(rainSoonAlert(input({ quarters: quarters(75), obsNearby: 20 }))).toBeNull()
  })
  it('starý radar (výpadek dat) → nic', () => {
    expect(rainSoonAlert(input({ obsHere: obs().map((p) => ({ ...p, t: p.t - 40 * MINUTE })), nowcastHere: nowcast(15) }))).toBeNull()
  })
  it('déšť hned → „během několika minut“; mráz → sněžení', () => {
    expect(rainSoonAlert(input({ nowcastHere: nowcast(0) }))?.message).toMatch(/^Během několika minut začne v Karviné pršet/)
    const s = rainSoonAlert(input({ nowcastHere: nowcast(25), tempC: 0 }))
    expect(s?.title).toBe('Brzy začne sněžit')
    expect(s?.tags).toEqual(['snowflake'])
  })
  it('lastSentAt najde poslední odeslání podle začátku klíče', () => {
    const st = { sent: { 'rainsoon:a': '2026-10-29T08:00:00.000Z', 'rainsoon:b': '2026-10-29T09:00:00.000Z', 'storm:x': '2026-10-29T10:00:00.000Z' } }
    expect(lastSentAt(st, 'rainsoon:')).toBe(Date.parse('2026-10-29T09:00:00.000Z'))
    expect(lastSentAt({ sent: {} }, 'rainsoon:')).toBeNull()
  })
})
