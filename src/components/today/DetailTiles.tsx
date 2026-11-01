// Dlaždice s detaily: vítr, tlak, vlhkost, viditelnost, UV, oblačnost, kvalita ovzduší

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { indexAtOrBefore } from '../../api/openMeteo.ts'
import { eaqiBand } from '../../lib/aqi.ts'
import { beaufort, beaufortLabel, hPa, kmh, num, pct, signed, temp, uvLabel, visibilityLabel, windFrom } from '../../lib/format.ts'
import { formatTime, HOUR, localDateKey } from '../../lib/time.ts'
import { useNow } from '../../state/derived.ts'
import { useAir, useForecast } from '../../state/queries.ts'
import { WeatherIcon } from '../WeatherIcon.tsx'

function Tile({ title, icon, children, footer }: { title: string; icon: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="glass flex min-h-[150px] flex-col rounded-3xl p-3.5">
      <div className="flex items-center gap-1 text-[12px] font-semibold tracking-wide text-muted uppercase">
        <WeatherIcon name={icon} size={22} />
        {title}
      </div>
      <div className="mt-1 flex-1">{children}</div>
      {footer && <div className="mt-1 text-xs leading-snug text-muted">{footer}</div>}
    </div>
  )
}

function Compass({ deg, speed }: { deg: number | null; speed: number | null }) {
  return (
    <div className="relative mx-auto h-24 w-24">
      <svg viewBox="0 0 100 100" className="absolute inset-0 text-muted">
        <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
        {Array.from({ length: 36 }, (_, i) => (
          <line
            key={i}
            x1="50"
            y1="8"
            x2="50"
            y2={i % 9 === 0 ? 14 : 11}
            stroke="currentColor"
            strokeOpacity={i % 9 === 0 ? 0.8 : 0.35}
            strokeWidth={i % 9 === 0 ? 2 : 1}
            transform={`rotate(${i * 10} 50 50)`}
          />
        ))}
        {(
          [
            ['S', 50, 25],
            ['V', 78, 53],
            ['J', 50, 82],
            ['Z', 22, 53],
          ] as const
        ).map(([l, x, y]) => (
          <text key={l} x={x} y={y} textAnchor="middle" fontSize="9" fill="currentColor" fontWeight="600">
            {l}
          </text>
        ))}
      </svg>
      {deg != null && (
        // Šipka ukazuje, KAM vítr vane (od směru deg po větru)
        <svg viewBox="0 0 100 100" className="absolute inset-0" style={{ transform: `rotate(${deg + 180}deg)` }}>
          <path d="M50 15 L57 31 L50 27 L43 31 Z" fill="var(--accent)" />
          <line x1="50" y1="27" x2="50" y2="33" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="50" y1="67" x2="50" y2="84" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="50" cy="84" r="2.5" fill="var(--accent)" />
        </svg>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-lg font-semibold">{num(speed, 0)}</span>
        <span className="-mt-1 text-[10px] text-muted">km/h</span>
      </div>
    </div>
  )
}

export function DetailTiles() {
  const now = useNow(60_000)
  const f = useForecast()
  const air = useAir()
  if (!f.data) return null
  const c = f.data.current
  const h = f.data.hourly
  const hi = indexAtOrBefore(h.time, now)
  const p3 = hi >= 3 ? h.pressure_msl[hi - 3] : null
  const pTrend = c.pressure_msl != null && p3 != null ? c.pressure_msl - p3 : null
  const todayIdx = f.data.daily.time.findIndex((t) => localDateKey(t) === localDateKey(now))
  const uvMax = todayIdx >= 0 ? f.data.daily.uv_index_max[todayIdx] : null
  const bf = beaufort(c.wind_speed_10m ?? 0)
  const aqi = air.data?.current.european_aqi
  const band = eaqiBand(aqi)

  // Tlak za 24 h (mini graf)
  const pSeries = h.pressure_msl.slice(Math.max(0, hi - 24), hi + 1).filter((v): v is number => v != null)
  const pMin = Math.min(...pSeries)
  const pMax = Math.max(...pSeries)
  const spark = pSeries
    .map((v, i) => `${(i / Math.max(1, pSeries.length - 1)) * 100},${30 - ((v - pMin) / Math.max(1, pMax - pMin)) * 26 - 2}`)
    .join(' ')

  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile title="Vítr" icon="wind" footer={
          <>
            <span className="capitalize">{beaufortLabel(bf)}</span>
            {bf > 0 ? ` od ${windFrom(c.wind_direction_10m)}` : ''}
            <br />
            nárazy až {kmh(c.wind_gusts_10m)}
          </>
        }>
        <Compass deg={c.wind_direction_10m} speed={c.wind_speed_10m} />
      </Tile>

      <Tile
        title="Tlak"
        icon="barometer"
        footer={pTrend == null ? null : Math.abs(pTrend) < 1 ? 'Za 3 h beze změny' : `Za 3 h ${pTrend > 0 ? 'stoupá' : 'klesá'} (${signed(pTrend, 1, ' hPa')})`}
      >
        <div className="tabular text-2xl font-semibold">{hPa(c.pressure_msl)}</div>
        <svg viewBox="0 0 100 32" className="mt-2 h-10 w-full" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={spark} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="text-[10px] text-faint">posledních 24 h, přepočteno na hladinu moře</div>
      </Tile>

      <Tile title="Vlhkost" icon="humidity" footer={`Rosný bod ${temp(c.dew_point_2m)}${c.dew_point_2m != null && c.dew_point_2m >= 16 ? ' – dusno' : ''}`}>
        <div className="tabular text-2xl font-semibold">{pct(c.relative_humidity_2m)}</div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div className="h-full rounded-full bg-[var(--rain)]" style={{ width: `${c.relative_humidity_2m ?? 0}%` }} />
        </div>
      </Tile>

      <Tile title="UV index" icon="uv-index" footer={`Dnes maximálně ${num(uvMax, 0)} – ${uvLabel(uvMax)}`}>
        <div className="tabular text-2xl font-semibold">
          {num(c.uv_index, 0)} <span className="text-base font-normal text-muted">{uvLabel(c.uv_index)}</span>
        </div>
        <div className="relative mt-3 h-2 rounded-full" style={{ background: 'linear-gradient(90deg,#4ade80,#facc15,#fb923c,#ef4444,#a855f7)' }}>
          <span className="absolute -top-1 h-4 w-1.5 rounded-full bg-white shadow ring-1 ring-black/20" style={{ left: `calc(${Math.min(11, c.uv_index ?? 0) / 11 * 100}% - 3px)` }} />
        </div>
      </Tile>

      <Tile title="Oblačnost" icon="overcast-day" footer={`Viditelnost ${visibilityLabel(c.visibility)}`}>
        <div className="tabular text-2xl font-semibold">{pct(c.cloud_cover)}</div>
        <div className="mt-1 space-y-1 text-xs">
          {(
            [
              ['nízká', h.cloud_cover_low[hi]],
              ['střední', h.cloud_cover_mid[hi]],
              ['vysoká', h.cloud_cover_high[hi]],
            ] as const
          ).map(([l, v]) => (
            <div key={l} className="flex items-center gap-2">
              <span className="w-12 text-muted">{l}</span>
              <div className="h-1.5 flex-1 rounded-full bg-black/10 dark:bg-white/10">
                <div className="h-full rounded-full bg-slate-400" style={{ width: `${v ?? 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Tile>

      <Link to="/ovzdusi" className="contents">
        <Tile title="Ovzduší" icon="smoke-particles" footer={band ? band.advice : 'Načítám…'}>
          <div className="flex items-center gap-2">
            <span className="tabular text-2xl font-semibold">{num(aqi, 0)}</span>
            {band && (
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-slate-900" style={{ background: band.color }}>
                {band.label}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted">
            PM10 {num(air.data?.current.pm10, 0)} · PM2,5 {num(air.data?.current.pm2_5, 0)} µg/m³
          </div>
        </Tile>
      </Link>
      <div className="col-span-2 -mt-1 text-[11px] text-faint">Hodnoty dlaždic: model Open-Meteo pro zvolený bod, stav k {formatTime(f.data.currentTime)}{now - f.data.currentTime > 2 * HOUR ? ' (starší data)' : ''}.</div>
    </div>
  )
}
