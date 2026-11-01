// Hodinová předpověď na 48 h (vodorovně posuvný pás) + 2h výhled srážek

import { indexAtOrBefore } from '../../api/openMeteo.ts'
import { num, tempShort } from '../../lib/format.ts'
import { formatTime, formatWeekdayShort, HOUR, localDateKey, MINUTE } from '../../lib/time.ts'
import { wmoIcon, wmoLabel } from '../../lib/wmo.ts'
import { useNow } from '../../state/derived.ts'
import { useForecast } from '../../state/queries.ts'
import { Card, ErrorCard, LoadingCard, StaleNote } from '../ui.tsx'
import { WeatherIcon } from '../WeatherIcon.tsx'

function Drop({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`inline-block h-2.5 w-2.5 ${className}`} fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c-3.3 4.4-6.5 8.3-6.5 11.7a6.5 6.5 0 0 0 13 0c0-3.4-3.2-7.3-6.5-11.7Z" />
    </svg>
  )
}

export function HourlyStrip() {
  const now = useNow(60_000)
  const f = useForecast()
  if (f.isError && !f.data) return <ErrorCard title="Hodinová předpověď" error={f.error} onRetry={() => f.refetch()} />
  if (!f.data) return <LoadingCard title="Hodinová předpověď" />
  const h = f.data.hourly
  const start = Math.max(0, indexAtOrBefore(h.time, now))
  const idx = Array.from({ length: 48 }, (_, i) => start + i).filter((i) => i < h.time.length)
  const prob = (i: number) => h.precipitation_probability[i]
  // Řádek srážek jen tehdy, když v příštích 48 h nějaké hrozí
  const showRain = idx.some((i) => (prob(i) ?? 0) >= 10 || (h.precipitation[i] ?? 0) >= 0.1)
  return (
    <Card title="Hodinová předpověď" pad={false} className="pb-3">
      <div className="no-scrollbar flex gap-1 overflow-x-auto px-3">
        {idx.map((i, k) => {
          const t = h.time[i]
          const newDay = k > 0 && localDateKey(t) !== localDateKey(h.time[i - 1])
          const p = prob(i)
          return (
            <div key={t} className={`flex min-w-[54px] flex-col items-center gap-0.5 rounded-2xl px-1 py-2 ${k === 0 ? 'bg-white/35 dark:bg-white/10' : ''}`}>
              <div className={`text-[11px] font-semibold ${k === 0 || newDay ? '' : 'text-muted'}`}>{k === 0 ? 'Teď' : newDay ? formatWeekdayShort(t) : formatTime(t).slice(0, 2)}</div>
              <WeatherIcon name={wmoIcon(h.weather_code[i], h.is_day[i] === 1)} size={38} alt={wmoLabel(h.weather_code[i])} />
              <div className="tabular text-base font-semibold">{tempShort(h.temperature_2m[i])}</div>
              {showRain && (
                <div className="tabular flex h-4 items-center gap-0.5 text-[10px] font-medium text-[var(--rain)]">
                  {p != null && p >= 10 && (
                    <>
                      <Drop />
                      {num(p, 0)} %
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {showRain && (
        <p className="mt-1 flex items-center gap-1 px-4 text-[11px] text-faint">
          <Drop className="text-[var(--rain)]" /> = pravděpodobnost srážek v dané hodině
        </p>
      )}
      <div className="px-4">
        <StaleNote updatedAt={f.dataUpdatedAt} error={f.error} />
      </div>
    </Card>
  )
}

/** Krátkodobá předpověď srážek po 15 min na 2 hodiny (při suchu jen jeden řádek) */
export function Nowcast() {
  const now = useNow(60_000)
  const f = useForecast()
  if (!f.data) return null
  const m = f.data.minutely15
  const items = m.time
    .map((t, i) => ({ t, mm: m.precipitation[i] ?? 0 }))
    .filter((x) => x.t > now - 15 * MINUTE && x.t <= now + 2 * HOUR + 15 * MINUTE)
    .slice(0, 9)
  if (!items.length) return null
  const wet = items.filter((x) => x.mm >= 0.1)
  if (!wet.length) {
    return (
      <section className="glass flex items-center gap-3 rounded-3xl px-4 py-3">
        <WeatherIcon name="umbrella" size={30} />
        <div>
          <div className="text-sm font-semibold">Příští 2 hodiny bez srážek</div>
          <div className="text-[11px] text-faint">Výhled po 15 minutách (model ICON-D2)</div>
        </div>
      </section>
    )
  }
  const max = Math.max(0.5, ...items.map((x) => x.mm))
  let summary: string
  if (items[0].mm >= 0.1) {
    const dryAt = items.find((x) => x.mm < 0.1)
    summary = dryAt ? `Srážky by měly ustat kolem ${formatTime(dryAt.t - 15 * MINUTE)}.` : 'Srážky budou pokračovat i v příštích 2 hodinách.'
  } else summary = `Srážky mohou začít kolem ${formatTime(wet[0].t - 15 * MINUTE)}.`
  return (
    <Card title="Srážky v příštích 2 hodinách">
      <p className="mb-3 text-sm font-medium">{summary}</p>
      <div className="flex h-16 items-end gap-1">
        {items.map((x) => (
          <div key={x.t} className="flex h-full flex-1 flex-col items-center justify-end">
            <div
              className="w-full rounded-t-md bg-[var(--rain)]"
              style={{ height: `${Math.max(x.mm >= 0.1 ? 8 : 2, (x.mm / max) * 100)}%`, opacity: x.mm >= 0.1 ? 0.9 : 0.25 }}
              title={`${formatTime(x.t - 15 * MINUTE)}–${formatTime(x.t)}: ${num(x.mm, 1)} mm`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint">
        <span>{formatTime(items[0].t - 15 * MINUTE)}</span>
        <span>{formatTime(items[Math.floor(items.length / 2)].t)}</span>
        <span>{formatTime(items[items.length - 1].t)}</span>
      </div>
      <p className="mt-2 text-[11px] text-faint">Po 15 minutách, model ICON-D2. Výška sloupce = množství srážek.</p>
    </Card>
  )
}
