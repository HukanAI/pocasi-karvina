// Astronomie pro Karvinou (suncalc): slunce, zlatá hodinka, Měsíc

import * as SunCalc from 'suncalc'
import { LOCATION } from '../config.ts'
import { addDays, localDateKey, localMidnight } from './time.ts'

const { latitude: LAT, longitude: LON } = LOCATION

/** Poledne místního dne – suncalc počítá časy pro den, do kterého spadá zadané datum */
const noonOf = (dateKey: string) => new Date(localMidnight(dateKey) + 12 * 3_600_000)

const valid = (d: Date | null | undefined) => (d && !Number.isNaN(d.getTime()) ? d.getTime() : null)

export interface SunInfo {
  sunrise: number | null
  sunset: number | null
  solarNoon: number | null
  dawn: number | null // občanský soumrak ráno
  dusk: number | null
  goldenMorningEnd: number | null
  goldenEveningStart: number | null
  dayLength: number | null // ms
}

export function sunInfo(dateKey: string): SunInfo {
  const t = SunCalc.getTimes(noonOf(dateKey), LAT, LON)
  const sunrise = valid(t.sunrise)
  const sunset = valid(t.sunset)
  return {
    sunrise,
    sunset,
    solarNoon: valid(t.solarNoon),
    dawn: valid(t.dawn),
    dusk: valid(t.dusk),
    goldenMorningEnd: valid(t.goldenHourEnd),
    goldenEveningStart: valid(t.goldenHour),
    dayLength: sunrise != null && sunset != null ? sunset - sunrise : null,
  }
}

/** Změna délky dne oproti včerejšku (ms) */
export function dayLengthChange(dateKey: string): number | null {
  const a = sunInfo(addDays(dateKey, -1)).dayLength
  const b = sunInfo(dateKey).dayLength
  return a != null && b != null ? b - a : null
}

/** Fáze dne pro pozadí: zlatá hodinka = ±40 min kolem východu/západu slunce */
export function dayPhase(now: number, isDayFlag?: boolean | null): 'day' | 'night' | 'golden' {
  const s = sunInfo(localDateKey(now))
  if (s.sunrise == null || s.sunset == null) return isDayFlag === false ? 'night' : 'day'
  const W = 40 * 60_000
  if (Math.abs(now - s.sunrise) <= W || Math.abs(now - s.sunset) <= W) return 'golden'
  return now > s.sunrise && now < s.sunset ? 'day' : 'night'
}

export interface MoonInfo {
  /** 0 = nov, 0,25 = první čtvrt, 0,5 = úplněk, 0,75 = poslední čtvrt */
  phase: number
  illumination: number // 0–1
  name: string
  icon: string
  rise: number | null
  set: number | null
  nextFull: number
  nextNew: number
}

const SYNODIC = 29.530588853 * 86_400_000

export function moonPhaseName(phase: number): { name: string; icon: string } {
  // Hlavní fáze mají okno ±1 den (0,0339 ≈ 1/29,53 cyklu), mezi nimi srpek/dorůstající/ubývající
  const p = ((phase % 1) + 1) % 1
  const near = (x: number) => Math.min(Math.abs(p - x), 1 - Math.abs(p - x)) < 0.0339
  if (near(0)) return { name: 'Nov', icon: 'moon-new' }
  if (near(0.25)) return { name: 'První čtvrť', icon: 'moon-first-quarter' }
  if (near(0.5)) return { name: 'Úplněk', icon: 'moon-full' }
  if (near(0.75)) return { name: 'Poslední čtvrť', icon: 'moon-last-quarter' }
  if (p < 0.25) return { name: 'Dorůstající srpek', icon: 'moon-waxing-crescent' }
  if (p < 0.5) return { name: 'Dorůstající Měsíc', icon: 'moon-waxing-gibbous' }
  if (p < 0.75) return { name: 'Couvající Měsíc', icon: 'moon-waning-gibbous' }
  return { name: 'Ubývající srpek', icon: 'moon-waning-crescent' }
}

export function moonInfo(now: number): MoonInfo {
  const ill = SunCalc.getMoonIllumination(new Date(now))
  const times = SunCalc.getMoonTimes(noonOf(localDateKey(now)), LAT, LON)
  const { name, icon } = moonPhaseName(ill.phase)
  const untilFull = ((0.5 - ill.phase + 1) % 1) * SYNODIC
  const untilNew = ((1 - ill.phase) % 1) * SYNODIC
  return {
    phase: ill.phase,
    illumination: ill.fraction,
    name,
    icon,
    rise: valid(times.rise),
    set: valid(times.set),
    nextFull: now + untilFull,
    nextNew: now + (untilNew === 0 ? SYNODIC : untilNew),
  }
}
