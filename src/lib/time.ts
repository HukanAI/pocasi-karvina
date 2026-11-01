// Práce s časem: vše se zobrazuje v čase Karviné (Europe/Prague) bez ohledu na pásmo telefonu.
// Interně používáme milisekundy UTC (číslo), takže přechody na letní/zimní čas nezpůsobují díry ani duplicity.

import { LOCATION } from '../config.ts'

const TZ = LOCATION.timezone
export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
})

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export interface LocalParts {
  year: number
  month: number // 1–12
  day: number
  hour: number
  minute: number
  second: number
  weekday: number // 0 = neděle
}

/** Rozloží okamžik na složky místního času Karviné */
export function localParts(ms: number): LocalParts {
  const p: Record<string, string> = {}
  for (const { type, value } of partsFmt.formatToParts(new Date(ms))) p[type] = value
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAY_INDEX[p.weekday] ?? 0,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' podle místního data v Karviné */
export function localDateKey(ms: number): string {
  const p = localParts(ms)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Posun místního času proti UTC v ms pro daný okamžik (CET = +1 h, CEST = +2 h) */
export function tzOffsetMs(ms: number): number {
  const p = localParts(ms)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** Okamžik (ms UTC) místní půlnoci daného data 'YYYY-MM-DD' v Karviné */
export function localMidnight(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  // Posun se v okolí půlnoci nemění (změna času je ve 2:00/3:00), stačí jedna korekce
  return guess - tzOffsetMs(guess)
}

/** Přičte dny ke klíči data 'YYYY-MM-DD' (kalendářně, bez vlivu časového pásma) */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Počet kalendářních dní mezi dvěma klíči data (b − a) */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY)
}

const timeFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayMonthFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric' })
const weekdayShortFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'short' })
const weekdayLongFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'long' })
const fullDateFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' })

/** '07:05' */
export const formatTime = (ms: number) => timeFmt.format(ms)
/** '26. 10.' */
export const formatDayMonth = (ms: number) => dayMonthFmt.format(ms)
/** 'po' */
export const formatWeekdayShort = (ms: number) => weekdayShortFmt.format(ms)
/** 'pondělí' */
export const formatWeekdayLong = (ms: number) => weekdayLongFmt.format(ms)
/** '26. října 2026' */
export const formatFullDate = (ms: number) => fullDateFmt.format(ms)

/** '26. 10. v 7:00' (u dnešního a včerejšího dne 'dnes v 7:00' / 'včera v 7:00') */
export function formatMoment(ms: number, nowMs: number = Date.now()): string {
  const key = localDateKey(ms)
  const today = localDateKey(nowMs)
  const time = formatTime(ms)
  if (key === today) return `dnes v ${time}`
  if (key === addDays(today, -1)) return `včera v ${time}`
  if (key === addDays(today, 1)) return `zítra v ${time}`
  return `${formatWeekdayShort(ms)} ${formatDayMonth(ms)} v ${time}`
}

const WEEKDAY_PHRASE: Record<string, string> = {
  pondělí: 'v pondělí',
  úterý: 'v úterý',
  středa: 've středu',
  čtvrtek: 've čtvrtek',
  pátek: 'v pátek',
  sobota: 'v sobotu',
  neděle: 'v neděli',
}

/** Den do věty: 'dnes', 'zítra', 'včera', jinak 'v pondělí 9. 11.' */
export function formatDayPhrase(ms: number, nowMs: number = Date.now()): string {
  const key = localDateKey(ms)
  const today = localDateKey(nowMs)
  if (key === today) return 'dnes'
  if (key === addDays(today, -1)) return 'včera'
  if (key === addDays(today, 1)) return 'zítra'
  const wd = formatWeekdayLong(ms)
  return `${WEEKDAY_PHRASE[wd] ?? wd} ${formatDayMonth(ms)}`
}

/** Délka trvání: '3 d 7 h 12 min', '5 h 3 min', '12 min' */
export function formatDuration(ms: number, opts: { seconds?: boolean } = {}): string {
  const neg = ms < 0
  let rest = Math.abs(ms)
  const d = Math.floor(rest / DAY)
  rest -= d * DAY
  const h = Math.floor(rest / HOUR)
  rest -= h * HOUR
  const m = Math.floor(rest / MINUTE)
  rest -= m * MINUTE
  const s = Math.floor(rest / 1000)
  const parts: string[] = []
  if (d) parts.push(`${d} d`)
  if (d || h) parts.push(`${h} h`)
  parts.push(`${m} min`)
  if (opts.seconds) parts.push(`${s} s`)
  return (neg ? '−' : '') + parts.join(' ')
}

/** 'před 5 min', 'před 2 h', 'před 3 dny' */
export function formatAgo(ms: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - ms)
  if (diff < MINUTE) return 'právě teď'
  if (diff < HOUR) return `před ${Math.round(diff / MINUTE)} min`
  if (diff < DAY) return `před ${Math.round(diff / HOUR)} h`
  const days = Math.round(diff / DAY)
  return `před ${days} ${days === 1 ? 'dnem' : 'dny'}`
}

/** Pořadí dne v přestupném roce (0–365) podle měsíce a dne, aby 29. 2. měl stálé místo */
export function leapDayIndex(month: number, day: number): number {
  const cum = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
  return cum[month - 1] + day - 1
}

/** 'MM-DD' z klíče data */
export const monthDay = (dateKey: string) => dateKey.slice(5)
