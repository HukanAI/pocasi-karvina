// Sníh v předpovědi: Open-Meteo udává srážky (precipitation) jako vodu v mm a zvlášť nový sníh (snowfall) v cm.
// Pro zobrazení se sníh ukazuje v cm nového sněhu, déšť v mm. Logika (kdy je „mokro“) dál pracuje s mm vody.

import { num } from './format.ts'

/** Open-Meteo převádí sníh poměrem 0,7 cm nového sněhu na 1 mm vody (ověřeno na datech pro Karvinou) */
export const SNOW_CM_PER_MM = 0.7

export type PrecipPhase = 'rain' | 'snow' | 'mixed'

/** Podíl sněhu ve srážkách 0–1 (mm vody a cm nového sněhu) */
export function snowShare(mm: number | null | undefined, snowCm: number | null | undefined): number {
  if (mm == null || !(mm > 0) || snowCm == null || !(snowCm > 0)) return 0
  return Math.min(1, snowCm / SNOW_CM_PER_MM / mm)
}

/** Skupenství: aspoň 80 % sněhu = sníh, do 20 % = déšť, mezi = déšť se sněhem */
export function precipPhase(mm: number | null | undefined, snowCm: number | null | undefined): PrecipPhase {
  const s = snowShare(mm, snowCm)
  // Tolerance kvůli zaokrouhlení (0,14 cm / 0,7 = 0,2000…04)
  return s >= 0.8 - 1e-9 ? 'snow' : s > 0.2 + 1e-9 ? 'mixed' : 'rain'
}

/** Sněhové kódy WMO (sněžení, sněhová zrna, sněhové přeháňky) */
export const isSnowCode = (code: number | null | undefined) => code != null && ((code >= 71 && code <= 77) || code === 85 || code === 86)

/** Číslo s jednotkou; nenulové množství pod 0,05 jako „< 0,1“, aby nevypadalo jako nula */
function amount(v: number, unit: string): string {
  return v > 0 && v < 0.05 ? `< 0,1 ${unit}` : `${num(v, 1)} ${unit}`
}

export interface FormatPrecipOptions {
  /** U sněhu připojit vodu: „0,7 cm sněhu (1,0 mm vody)“ */
  water?: boolean
  /** Krátce pro úzké sloupce: „0,9 mm + 0,7 cm sněhu“ */
  short?: boolean
  /** Odhad (např. z měření srážkoměrem): „asi 0,7 cm sněhu“ */
  approx?: boolean
}

/** Množství srážek k zobrazení: sníh v cm nového sněhu, déšť v mm, smíšené obojí */
export function formatPrecip(mm: number | null | undefined, snowCm: number | null | undefined, opts: FormatPrecipOptions = {}): string {
  if (mm == null) return '–'
  const phase = precipPhase(mm, snowCm)
  if (phase === 'rain') return amount(mm, 'mm')
  const snow = Math.max(0, snowCm ?? 0)
  const asi = opts.approx ? 'asi ' : ''
  if (phase === 'snow') return `${asi}${amount(snow, 'cm')} sněhu${opts.water ? ` (${amount(mm, 'mm')} vody)` : ''}`
  const rain = Math.max(0, mm - snow / SNOW_CM_PER_MM)
  return opts.short ? `${amount(rain, 'mm')} + ${asi}${amount(snow, 'cm')} sněhu` : `${amount(rain, 'mm')} deště a ${asi}${amount(snow, 'cm')} sněhu`
}

/** Intenzita podle mm vody za hodinu a skupenství („slabé sněžení“, „mírné srážky“ …) */
export function precipWord(mmPerHour: number, phase: PrecipPhase = 'rain'): string {
  if (mmPerHour < 0.05) return 'bez srážek'
  const k = mmPerHour < 1 ? 0 : mmPerHour < 4 ? 1 : mmPerHour < 10 ? 2 : 3
  if (phase === 'snow') return ['slabé sněžení', 'mírné sněžení', 'silné sněžení', 'velmi silné sněžení'][k]
  if (phase === 'mixed') return ['slabý déšť se sněhem', 'déšť se sněhem', 'silný déšť se sněhem', 'velmi silný déšť se sněhem'][k]
  return ['slabé srážky', 'mírné srážky', 'silné srážky', 'velmi silné srážky'][k]
}

/** CSS barva sloupce podle skupenství (proměnné --rain/--snow); déšť se sněhem napůl */
export function precipFill(mm: number, snowCm: number | null | undefined): string {
  const ph = precipPhase(mm, snowCm)
  return ph === 'snow' ? 'var(--snow)' : ph === 'mixed' ? 'linear-gradient(to top, var(--rain) 50%, var(--snow) 50%)' : 'var(--rain)'
}

/**
 * Skupenství srážek v minulém období podle modelu (hodinové hodnoty platí za předchozí hodinu).
 * Měření stanice udává jen vodu, proto se sníh u naměřených srážek odhaduje takto. null = model byl suchý.
 */
export function modelPhaseBetween(
  hourly: { time: number[]; precipitation: (number | null)[]; snowfall?: (number | null)[] },
  from: number,
  to: number,
): PrecipPhase | null {
  const HOUR = 3_600_000
  let mm = 0
  let snowCm = 0
  hourly.time.forEach((t, i) => {
    if (t - HOUR < to && t > from) {
      mm += hourly.precipitation[i] ?? 0
      snowCm += hourly.snowfall?.[i] ?? 0
    }
  })
  return mm >= 0.1 ? precipPhase(mm, snowCm) : null
}

/** Skupenství za období ze součtů (mm vody, cm sněhu) – např. celá epizoda nebo 2 hodiny */
export function phaseOfTotals(items: { mm: number | null | undefined; snowCm?: number | null }[]): { mm: number; snowCm: number; phase: PrecipPhase } {
  let mm = 0
  let snowCm = 0
  for (const x of items) {
    mm += x.mm ?? 0
    snowCm += x.snowCm ?? 0
  }
  return { mm, snowCm, phase: precipPhase(mm, snowCm) }
}
