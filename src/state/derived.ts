// Odvozené stavy kombinující měření ČHMÚ a model Open-Meteo

import { useEffect, useMemo, useState } from 'react'
import { type Forecast, indexAtOrBefore } from '../api/openMeteo.ts'
import { dayPhase } from '../lib/astro.ts'
import type { StationNow, StationSra10 } from '../lib/dataTypes.ts'
import {
  expectedRainEnd,
  type ForecastPrecip,
  type HourChance,
  mergeSamples,
  nextRain,
  nextRainChance,
  nowcastQuarters,
  nowcastSummary,
  type PrecipSample,
  rainState,
} from '../lib/rain.ts'
import { modelPhaseBetween, type PrecipPhase, precipPhase } from '../lib/snow.ts'
import { blendTemps, lastTempObs } from '../lib/stationTimeline.ts'
import { HOUR, localDateKey, MINUTE } from '../lib/time.ts'
import { todayRange } from '../lib/todayRange.ts'
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

/** Skupenství srážek v minulém období: model, jinak průměrná teplota stanice (≤ 0,5 °C = sníh) */
function eventPhase(f: Forecast | undefined, st: StationNow | undefined, from: number, to: number): PrecipPhase {
  const m = f ? modelPhaseBetween(f.hourly, from, to) : null
  if (m) return m
  if (st) {
    const T = st.series.T.filter((v, i) => {
      const t = st.series.start + i * st.series.step
      return v != null && t > from && t <= to
    }) as number[]
    if (T.length) return T.reduce((a, b) => a + b, 0) / T.length <= 0.5 ? 'snow' : 'rain'
  }
  return 'rain'
}

/** Šance na srážky + skupenství: podle množství, a když model žádné nečeká, podle teploty té hodiny */
function withPhase(f: Forecast, h: HourChance | null): (HourChance & { phase: PrecipPhase }) | null {
  if (!h) return null
  if ((h.mm ?? 0) >= 0.1) return { ...h, phase: precipPhase(h.mm, h.snowCm) }
  const i = f.hourly.time.indexOf(h.t)
  const T = i >= 0 ? f.hourly.temperature_2m[i] : null
  return { ...h, phase: T != null && T <= 0.5 ? 'snow' : 'rain' }
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
    const near = f ? nowcastSummary(nowcastQuarters(f.minutely15.time, f.minutely15.precipitation, now, f.minutely15.snowfall)) : null
    return {
      state,
      near,
      next: nextRain(future, now),
      // Šance na srážky stejně jako v hodinové předpovědi (pravděpodobnost ≥ 10 % nebo předpovězené množství);
      // hodiny pokryté výhledem na 2 h rozhoduje podrobnější předpověď po 15 minutách
      chance: f
        ? withPhase(
            f,
            nextRainChance(
              f.hourly.time.map((t, i) => ({ t, prob: f.hourly.precipitation_probability[i], mm: f.hourly.precipitation[i], snowCm: f.hourly.snowfall[i] })),
              now,
              undefined,
              near?.until ?? now,
            ),
          )
        : null,
      expectedEnd: state.kind === 'raining' ? expectedRainEnd(future, now) : null,
      // Stanice měří jen vodu – zda poslední srážky byly sníh, odhadne model (a bez něj teplota stanice)
      lastEventPhase: state.kind === 'dry' ? eventPhase(f, stNow.data, state.lastEvent.start, state.lastEvent.end) : null,
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

/**
 * Hodinová teplota předpovědi napojená na poslední měření ČHMÚ (zarovnaná s forecast.hourly.time).
 * Používají ji hodinová předpověď, graf naměřeno → předpověď, max/min dneška i detail dne,
 * takže stejná hodina má všude stejnou teplotu.
 */
export function useHourlyTemps(): (number | null)[] | null {
  const f = useForecast()
  const st = useStationNow()
  return useMemo(() => {
    if (!f.data) return null
    return blendTemps(f.data.hourly.time, f.data.hourly.temperature_2m, lastTempObs(st.data?.series)).temps
  }, [f.data, st.data])
}

/**
 * Max a min dneška – stejné v nadpisu, v předpovědi po dnech i v Historii: naměřeno od půlnoci (ČHMÚ)
 * + zbytek dne podle hodinové předpovědi napojené na měření. Bez čerstvého měření denní hodnoty modelu.
 */
export function useTodayRange(now: number): { tmax: number | null; tmin: number | null; measured: boolean } | null {
  const f = useForecast()
  const st = useStationNow()
  const temps = useHourlyTemps()
  return useMemo(() => {
    if (!f.data || !temps) return null
    const todayKey = localDateKey(now)
    const di = f.data.daily.time.findIndex((t) => localDateKey(t + 12 * HOUR) === todayKey)
    const measured = isStationFresh(st.data, now) && st.data!.today?.date === todayKey ? st.data!.today : null
    const r = todayRange(
      { time: f.data.hourly.time, temperature_2m: temps },
      measured,
      { tmax: di >= 0 ? f.data.daily.temperature_2m_max[di] : null, tmin: di >= 0 ? f.data.daily.temperature_2m_min[di] : null },
      now,
    )
    return { ...r, measured: !!measured && measured.tmax != null && measured.tmin != null }
  }, [f.data, st.data, temps, now])
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
