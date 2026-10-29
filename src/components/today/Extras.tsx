// Výstrahy, astronomie a náhled „dnes v historii“

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { dayLengthChange, moonInfo, sunInfo } from '../../lib/astro.ts'
import { dayNormal, dayRecords } from '../../lib/climate.ts'
import type { WarningItem } from '../../lib/dataTypes.ts'
import { num, pct, temp } from '../../lib/format.ts'
import { formatDayMonth, formatDuration, formatFullDate, formatMoment, formatTime, localDateKey, localParts } from '../../lib/time.ts'
import { useNow } from '../../state/derived.ts'
import { useStationDaily, useWarnings } from '../../state/queries.ts'
import { Card, SourceNote } from '../ui.tsx'
import { WeatherIcon } from '../WeatherIcon.tsx'

const LEVEL_STYLE: Record<WarningItem['level'], { bg: string; label: string }> = {
  yellow: { bg: '#facc15', label: 'Nízký stupeň' },
  orange: { bg: '#fb923c', label: 'Vysoký stupeň' },
  red: { bg: '#ef4444', label: 'Extrémní stupeň' },
  unknown: { bg: '#94a3b8', label: 'Výstraha' },
}

export function WarningsBanner() {
  const now = useNow(60_000)
  const q = useWarnings()
  const [open, setOpen] = useState<string | null>(null)
  const items = (q.data?.items ?? []).filter((w) => Date.parse(w.expires) > now)
  if (!items.length) return null
  return (
    <div className="space-y-2">
      {items.map((w) => {
        const s = LEVEL_STYLE[w.level]
        const active = Date.parse(w.onset) <= now
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => setOpen(open === w.id ? null : w.id)}
            className="glass block w-full overflow-hidden rounded-3xl text-left"
            style={{ borderLeft: `6px solid ${s.bg}` }}
          >
            <div className="p-3.5">
              <div className="flex items-center gap-2">
                <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-slate-900" style={{ background: s.bg }}>
                  {s.label}
                </span>
                <span className="font-semibold">{w.event}</span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {active ? 'Platí nyní' : `Od ${formatMoment(Date.parse(w.onset), now)}`} · do {formatMoment(Date.parse(w.expires), now)}
              </p>
              {open === w.id && (
                <div className="mt-2 space-y-2 text-sm whitespace-pre-line">
                  <p>{w.description}</p>
                  {w.instruction && <p className="text-muted">{w.instruction}</p>}
                  <p className="text-[11px] text-faint">
                    {w.area} · vydal ČHMÚ (přes MeteoAlarm) {formatMoment(Date.parse(w.sent), now)}
                  </p>
                </div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function AstroCard() {
  const now = useNow(60_000)
  const key = localDateKey(now)
  const sun = sunInfo(key)
  const change = dayLengthChange(key)
  const moon = moonInfo(now)
  const progress = sun.sunrise && sun.sunset ? Math.min(1, Math.max(0, (now - sun.sunrise) / (sun.sunset - sun.sunrise))) : 0
  const up = sun.sunrise != null && sun.sunset != null && now > sun.sunrise && now < sun.sunset
  // Poloha slunce na oblouku
  const ang = Math.PI * (1 - progress)
  const sx = 50 + 42 * Math.cos(ang)
  const sy = 50 - 42 * Math.sin(ang)
  return (
    <Card title="Slunce a Měsíc">
      <svg viewBox="0 0 100 56" className="mx-auto h-24 w-full max-w-xs" aria-hidden="true">
        <path d="M8 50 A42 42 0 0 1 92 50" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeDasharray="2 2" />
        <line x1="2" y1="50" x2="98" y2="50" stroke="currentColor" strokeOpacity="0.3" />
        {up && <circle cx={sx} cy={sy} r="4.5" fill="#fbbf24" stroke="#f59e0b" />}
      </svg>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2">
          <WeatherIcon name="sunrise" size={40} />
          <div>
            <div className="text-xs text-muted">Východ</div>
            <div className="tabular font-semibold">{sun.sunrise ? formatTime(sun.sunrise) : '–'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <WeatherIcon name="sunset" size={40} />
          <div>
            <div className="text-xs text-muted">Západ</div>
            <div className="tabular font-semibold">{sun.sunset ? formatTime(sun.sunset) : '–'}</div>
          </div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted">Délka dne</dt>
        <dd className="tabular text-right">
          {sun.dayLength ? formatDuration(sun.dayLength) : '–'}
          {change != null && (
            <span className="ml-1 text-xs text-muted">
              ({change >= 0 ? '+' : '−'}
              {num(Math.abs(change) / 60_000, 1)} min)
            </span>
          )}
        </dd>
        <dt className="text-muted">Zlatá hodinka ráno</dt>
        <dd className="tabular text-right">{sun.sunrise && sun.goldenMorningEnd ? `${formatTime(sun.sunrise)}–${formatTime(sun.goldenMorningEnd)}` : '–'}</dd>
        <dt className="text-muted">Zlatá hodinka večer</dt>
        <dd className="tabular text-right">{sun.goldenEveningStart && sun.sunset ? `${formatTime(sun.goldenEveningStart)}–${formatTime(sun.sunset)}` : '–'}</dd>
        <dt className="text-muted">Občanský soumrak</dt>
        <dd className="tabular text-right">{sun.dusk ? formatTime(sun.dusk) : '–'}</dd>
      </dl>
      <div className="mt-3 flex items-center gap-3 border-t border-[var(--divider)] pt-3">
        <WeatherIcon name={moon.icon} size={48} />
        <div className="flex-1 text-sm">
          <div className="font-semibold">{moon.name}</div>
          <div className="text-muted">Osvětleno {pct(moon.illumination * 100)}</div>
          <div className="text-xs text-faint">
            Východ {moon.rise ? formatTime(moon.rise) : '–'} · západ {moon.set ? formatTime(moon.set) : '–'} · úplněk {formatDayMonth(moon.nextFull)}
          </div>
        </div>
      </div>
    </Card>
  )
}

export function HistoryTeaser() {
  const now = useNow(3_600_000)
  const q = useStationDaily()
  if (!q.data) return null
  const p = localParts(now)
  const n = dayNormal(q.data, 'tmean', p.month, p.day)
  const nmax = dayNormal(q.data, 'tmax', p.month, p.day)
  const nmin = dayNormal(q.data, 'tmin', p.month, p.day)
  const r = dayRecords(q.data, p.month, p.day, p.year - 1)
  return (
    <Link to="/historie" className="block">
      <Card title={`${formatFullDate(now).replace(/ \d{4}$/, '')} v historii`} action={<span className="text-sm text-[var(--accent)]">Více →</span>}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xs text-muted">Normál max</div>
            <div className="tabular font-semibold">{temp(nmax.mean)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Normál průměr</div>
            <div className="tabular font-semibold">{temp(n.mean)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Normál min</div>
            <div className="tabular font-semibold">{temp(nmin.mean)}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-orange-500/15 p-2">
            <div className="text-xs text-muted">Rekordně teplo</div>
            <div className="tabular font-semibold">{r.highestMax ? `${temp(r.highestMax.value)} (${r.highestMax.year})` : '–'}</div>
          </div>
          <div className="rounded-2xl bg-sky-500/15 p-2">
            <div className="text-xs text-muted">Rekordně chladno</div>
            <div className="tabular font-semibold">{r.lowestMin ? `${temp(r.lowestMin.value)} (${r.lowestMin.year})` : '–'}</div>
          </div>
        </div>
        <SourceNote>
          Stanice ČHMÚ Karviná, normál 1991–2020 ({n.years} let, okno ±7 dní), rekordy z {r.years} let měření od roku {r.firstYear ?? '–'}.
        </SourceNote>
      </Card>
    </Link>
  )
}
