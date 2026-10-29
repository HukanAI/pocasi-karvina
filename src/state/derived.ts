// Odvozené stavy kombinující měření ČHMÚ a model Open-Meteo

import { useEffect, useMemo, useState } from 'react'
import { type Forecast, indexAtOrBefore } from '../api/openMeteo.ts'
import { dayPhase } from '../lib/astro.ts'
import type { StationNow, StationSra10 } from '../lib/dataTypes.ts'
import { expectedRainEnd, type ForecastPrecip, mergeSamples, nextRain, type PrecipSample, rainState } from '../lib/rain.ts'
import { HOUR, MINUTE } from '../lib/time.ts'
import { wmoSky } from '../lib/wmo.ts'
import { useForecast, useStationNow, useStationSra } from './queries.ts'
import { useSettings } from './useSettings.ts'

/** Aktuální čas, který se obnovuje v daném intervalu (pro živá počítadla) */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    const onVis = () => document.visibilityState === 'visible' && setNow(Date.now())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [intervalMs])
  return now
}

/** Měření stanice považujeme za aktuální, pokud není starší než 90 minut */
export const STATION_FRESH_MS = 90 * MINUTE

export function isStationFresh(st: StationNow | undefined, now: number): boolean {
  return !!st?.last && st.last.T != null && now - st.last.t <= STATION_FRESH_MS
}

export function stationSamples(sra: StationSra10 | undefined): PrecipSample[] {
  if (!sra) return []
  const out: PrecipSample[] = []
  sra.values.forEach((mm, i) => {
    if (mm != null) out.push({ t: sra.start + i * sra.step, dur: sra.step, mm, src: 'station' })
  })
  return out
}

/** Pravděpodobnost srážek pro okamžik t (hodinová řada, interval končící v čase hodiny) */
function probAt(f: Forecast, t: number): number | null {
  const { time, precipitation_probability: p } = f.hourly
  // Hodina, která interval obsahuje: první hodinový čas ≥ t
  const i = indexAtOrBefore(time, t - 1) + 1
  return i >= 0 && i < time.length ? (p[i] ?? null) : null
}

/** Vzorky srážek z modelu: hodinové pro minulost před 15min daty, potom 15min, po jejich konci opět hodinové */
export function modelSamples(f: Forecast | undefined): ForecastPrecip[] {
  if (!f) return []
  const m = f.minutely15
  const firstM = m.time.length ? m.time[0] - 15 * MINUTE : Infinity
  const lastM = m.time.length ? m.time[m.time.length - 1] : -Infinity
  const out: ForecastPrecip[] = []
  f.hourly.time.forEach((t, i) => {
    const mm = f.hourly.precipitation[i]
    if (mm == null) return
    if (t <= firstM || t - HOUR >= lastM) out.push({ t, dur: HOUR, mm, src: 'model', prob: f.hourly.precipitation_probability[i] })
  })
  m.time.forEach((t, i) => {
    const mm = m.precipitation[i]
    if (mm != null) out.push({ t, dur: 15 * MINUTE, mm, src: 'model', prob: probAt(f, t) })
  })
  return out.sort((a, b) => a.t - b.t)
}

export function useRain(now: number) {
  const forecast = useForecast()
  const sra = useStationSra()
  const stNow = useStationNow()
  const { settings } = useSettings()
  return useMemo(() => {
    const station = stationSamples(sra.data)
    // Poslední 10min hodnoty mohou být v station-now.json čerstvější než v zásobě
    if (stNow.data?.last && stNow.data.last.SRA != null && !station.some((s) => s.t === stNow.data!.last!.t)) {
      const s = stNow.data.series
      s.SRA.forEach((mm, i) => {
        const t = s.start + i * s.step
        if (mm != null && t > (station.at(-1)?.t ?? -Infinity)) station.push({ t, dur: s.step, mm, src: 'station' })
      })
    }
    const model = modelSamples(forecast.data)
    const merged = mergeSamples(station, model, now)
    const state = rainState(merged, now, settings.rainMinTotal)
    const future = model.filter((s) => s.t > now)
    const lastStationT = station.length ? station[station.length - 1].t : null
    return {
      state,
      next: nextRain(future, now),
      expectedEnd: state.kind === 'raining' ? expectedRainEnd(future, now) : null,
      lastStationT,
      hasStation: station.length > 0,
      isLoading: forecast.isLoading || sra.isLoading,
      minTotal: settings.rainMinTotal,
    }
  }, [forecast.data, forecast.isLoading, sra.data, sra.isLoading, stNow.data, now, settings.rainMinTotal])
}

/** Podklady pro pozadí: druh oblohy, fáze dne, intenzita srážek */
export function useSky(now: number) {
  const forecast = useForecast()
  return useMemo(() => {
    const c = forecast.data?.current
    return {
      sky: wmoSky(c?.weather_code ?? 2),
      phase: dayPhase(now, c ? c.is_day === 1 : null),
      // current.precipitation je úhrn za 15 min → mm/h
      intensity: (c?.precipitation ?? 0) * 4,
    }
  }, [forecast.data, now])
}
