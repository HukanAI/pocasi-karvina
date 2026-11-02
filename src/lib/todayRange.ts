// Max a min dneška pro nadpis: měření ČHMÚ od půlnoci + zbytek dne podle modelu

import { localDateKey } from './time.ts'

/**
 * Max a min dneška: naměřeno od půlnoci (ČHMÚ) + zbytek dne podle hodinové předpovědi.
 * Samotné denní max/min modelu může být v rozporu s tím, co už stanice naměřila.
 */
export function todayRange(
  hourly: { time: number[]; temperature_2m: (number | null)[] },
  measured: { tmax: number | null; tmin: number | null } | null,
  modelDay: { tmax: number | null; tmin: number | null },
  now: number,
): { tmax: number | null; tmin: number | null } {
  if (!measured || measured.tmax == null || measured.tmin == null) return modelDay
  const today = localDateKey(now)
  const rest: number[] = []
  hourly.time.forEach((t, i) => {
    const v = hourly.temperature_2m[i]
    if (t > now && localDateKey(t) === today && v != null) rest.push(v)
  })
  return { tmax: Math.max(measured.tmax, ...rest), tmin: Math.min(measured.tmin, ...rest) }
}
