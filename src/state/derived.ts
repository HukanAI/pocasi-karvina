// Odvozené stavy kombinující měření ČHMÚ a model Open-Meteo

import { useEffect, useMemo, useState } from 'react'
import { type Forecast, indexAtOrBefore } from '../api/openMeteo.ts'
import { dayPhase } from '../lib/astro.ts'
import type { StationNow, StationSra10 } from '../lib/dataTypes.ts'
import {
  expectedRainEnd,
  type ForecastPrecip,
  mergeSamples,
  nextRain,
  nextRainChance,
  nowcastQuarters,
  nowcastSummary,
  type PrecipSample,
  rainState,
} from '../lib/rain.ts'
import { HOUR, MINUTE } from '../lib/time.ts'
import { effectiveCode, isPrecipCode, measuredPrecipCode, wmoSky } from '../lib/wmo.ts'
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

/**
 * Měření stanice považujeme za aktuální, pokud není starší než 150 minut.
 * Běžné zpoždění: soubor ČHMÚ končí :50 předchozí hodiny a vychází v :03, Action běží každých 10 min
 * (+ zpoždění plánovače až 30 min) a raw.githubusercontent drží cache 5 min → až ~2 h.
 */
export const STATION_FRESH_MS = 150 * MINUTE

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
    const f = forecast.data
    // Příští 2 hodiny: stejný výpočet jako karta „Srážky v příštích 2 hodinách“
    const near = f ? nowcastSummary(nowcastQuarters(f.minutely15.time, f.minutely15.precipitation, now)) : null
    return {
      state,
      near,
      next: nextRain(future, now),
      // Šance na srážky stejně jako v hodinové předpovědi (pravděpodobnost ≥ 10 % nebo předpovězené množství);
      // hodiny pokryté výhledem na 2 h rozhoduje podrobnější předpověď po 15 minutách
      chance: f
        ? nextRainChance(
            f.hourly.time.map((t, i) => ({ t, prob: f.hourly.precipitation_probability[i], mm: f.hourly.precipitation[i] })),
            now,
            undefined,
            near?.until ?? now,
          )
        : null,
      expectedEnd: state.kind === 'raining' ? expectedRainEnd(future, now) : null,
      lastStationT,
      // Bez předpovědi nelze říct, kdy bude pršet (nesmí se to plést s „déšť se nečeká“)
      forecastReady: !!f,
      hasStation: station.length > 0,
      isLoading: forecast.isLoading || sra.isLoading,
      minTotal: settings.rainMinTotal,
    }
  }, [forecast.data, forecast.isLoading, sra.data, sra.isLoading, stNow.data, now, settings.rainMinTotal])
}

/**
 * Aktuální stav počasí pro nadpis i pozadí. Kód z modelu se sladí se srážkami:
 * „slabý déšť“ při 0 mm → stav oblohy; když podle karty „Bez deště“ právě prší (měření ČHMÚ
 * nebo 15min data modelu), ale kód srážky nemá → slabý déšť / sněžení.
 */
export function useCurrentWeather(now: number) {
  const forecast = useForecast()
  const rain = useRain(now)
  const st = useStationNow()
  return useMemo(() => {
    const c = forecast.data?.current
    if (!c) return null
    let code = effectiveCode(c.weather_code, c.precipitation, c.cloud_cover)
    const raining = rain.state.kind === 'raining'
    // Jen obloha nebo mlha; mrznoucí srážky a bouřky zůstávají
    if (raining && (code == null || code <= 3 || code === 45 || code === 48)) {
      code = measuredPrecipCode(isStationFresh(st.data, now) ? st.data!.last!.T : c.temperature_2m)
    }
    return {
      code,
      isDay: c.is_day === 1,
      // current.precipitation je úhrn za 15 min → mm/h
      intensity: isPrecipCode(code) || raining ? Math.max((c.precipitation ?? 0) * 4, raining ? 0.5 : 0) : 0,
    }
  }, [forecast.data, rain.state.kind, st.data, now])
}

/** Teplota „teď“: měření ČHMÚ, pokud je čerstvé, jinak model – stejná v nadpisu i v hodinové předpovědi */
export function useNowTemp(now: number): number | null {
  const f = useForecast()
  const st = useStationNow()
  return isStationFresh(st.data, now) ? st.data!.last!.T! : (f.data?.current.temperature_2m ?? null)
}

/** Podklady pro pozadí: druh oblohy, fáze dne, intenzita srážek */
export function useSky(now: number) {
  const cw = useCurrentWeather(now)
  return useMemo(
    () => ({
      sky: wmoSky(cw?.code ?? 2),
      phase: dayPhase(now, cw ? cw.isDay : null),
      intensity: cw?.intensity ?? 0,
    }),
    [cw, now],
  )
}
