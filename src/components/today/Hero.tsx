// Horní část: aktuální teplota, stav, max/min a odchylka od normálu

import { indexAtOrBefore } from '../../api/openMeteo.ts'
import { dayNormal } from '../../lib/climate.ts'
import { num, signed, tempShort } from '../../lib/format.ts'
import { formatAgo, formatTime, localDateKey, localParts } from '../../lib/time.ts'
import { wmoIcon, wmoLabel } from '../../lib/wmo.ts'
import { isStationFresh, useNow } from '../../state/derived.ts'
import { useForecast, useStationDaily, useStationNow } from '../../state/queries.ts'
import { Pill, Skeleton } from '../ui.tsx'
import { WeatherIcon } from '../WeatherIcon.tsx'

export function Hero() {
  const now = useNow(60_000)
  const f = useForecast()
  const st = useStationNow()
  const daily = useStationDaily()

  if (!f.data) {
    return (
      <div className="flex flex-col items-center py-6">
        <Skeleton className="h-24 w-40" />
        <Skeleton className="mt-3 h-5 w-48" />
      </div>
    )
  }
  const c = f.data.current
  const fresh = isStationFresh(st.data, now)
  const temp = fresh ? st.data!.last!.T! : c.temperature_2m
  const todayKey = localDateKey(now)
  const di = f.data.daily.time.findIndex((t) => localDateKey(t + 12 * 3_600_000) === todayKey)
  const tmax = di >= 0 ? f.data.daily.temperature_2m_max[di] : null
  const tmin = di >= 0 ? f.data.daily.temperature_2m_min[di] : null
  const tmean = di >= 0 ? f.data.daily.temperature_2m_mean[di] : null

  // Odchylka dnešního průměru (model) od normálu 1991–2020 (stanice ČHMÚ)
  const p = localParts(now)
  const normal = daily.data ? dayNormal(daily.data, 'tmean', p.month, p.day) : null
  const anomaly = normal?.mean != null && tmean != null ? tmean - normal.mean : null

  // Teplota před hodinou kvůli trendu
  const hi = indexAtOrBefore(f.data.hourly.time, now)
  const prev = hi > 0 ? f.data.hourly.temperature_2m[hi - 1] : null
  const trend = prev != null && c.temperature_2m != null ? c.temperature_2m - prev : 0

  return (
    <div className="flex flex-col items-center pt-2 pb-4 text-center">
      <WeatherIcon name={wmoIcon(c.weather_code, c.is_day === 1)} size={92} className="-mb-2 drop-shadow" alt={wmoLabel(c.weather_code)} />
      <div className="tabular flex items-start text-[88px] leading-none font-extralight tracking-tighter">
        {num(temp, 0)}
        <span className="mt-3 text-4xl font-light">°</span>
        {Math.abs(trend) >= 0.3 && (
          <span className="mt-4 ml-1 text-xl font-normal text-muted" title={`Změna za hodinu ${signed(trend)}`}>
            {trend > 0 ? '↑' : '↓'}
          </span>
        )}
      </div>
      <p className="mt-1 text-xl font-medium">{wmoLabel(c.weather_code)}</p>
      <p className="mt-0.5 text-sm text-muted">
        Pocitově {tempShort(c.apparent_temperature)} · max {tempShort(tmax)} · min {tempShort(tmin)}
      </p>
      <p className="mt-1 text-[11px] text-faint">
        {fresh
          ? `Teplota naměřena na stanici ČHMÚ Karviná v ${formatTime(st.data!.last!.t)} (${formatAgo(st.data!.last!.t, now)})`
          : `Teplota z modelu Open-Meteo (${formatTime(f.data.currentTime)})${st.data?.last ? `; poslední měření ČHMÚ je z ${formatTime(st.data.last.t)}` : ''}`}
      </p>
      {anomaly != null && (
        <Pill
          className="mt-3"
          style={{
            background: anomaly >= 0 ? 'color-mix(in srgb, var(--warm) 22%, transparent)' : 'color-mix(in srgb, var(--cold) 22%, transparent)',
          }}
        >
          Dnes o {num(Math.abs(anomaly), 1)} °C {anomaly >= 0 ? 'nad' : 'pod'} normálem ({num(normal!.mean, 1)} °C, 1991–2020)
        </Pill>
      )}
    </div>
  )
}
