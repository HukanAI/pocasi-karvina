// Hodinová předpověď na 48 h (vodorovně posuvný pás) + 2h nowcast srážek

import { indexAtOrBefore } from '../../api/openMeteo.ts'
import { num, tempShort } from '../../lib/format.ts'
import { formatTime, HOUR, localDateKey, MINUTE, formatWeekdayShort } from '../../lib/time.ts'
import { wmoIcon, wmoLabel } from '../../lib/wmo.ts'
import { useNow } from '../../state/derived.ts'
import { useForecast } from '../../state/queries.ts'
import { Card, ErrorCard, LoadingCard, StaleNote } from '../ui.tsx'
import { WeatherIcon } from '../WeatherIcon.tsx'

export function HourlyStrip() {
  const now = useNow(60_000)
  const f = useForecast()
  if (f.isError && !f.data) return <ErrorCard title="Hodinová předpověď" error={f.error} onRetry={() => f.refetch()} />
  if (!f.data) return <LoadingCard title="Hodinová předpověď" />
  const h = f.data.hourly
  const start = Math.max(0, indexAtOrBefore(h.time, now))
  const idx = Array.from({ length: 48 }, (_, i) => start + i).filter((i) => i < h.time.length)
  return (
    <Card title="Hodinová předpověď" subtitle="48 hodin · teplota, srážky a jejich pravděpodobnost" pad={false} className="pb-3">
      <div className="no-scrollbar flex gap-1 overflow-x-auto px-3">
        {idx.map((i, k) => {
          const t = h.time[i]
          const newDay = k > 0 && localDateKey(t) !== localDateKey(h.time[i - 1])
          const prob = h.precipitation_probability[i]
          const p = h.precipitation[i]
          return (
            <div key={t} className={`flex min-w-[52px] flex-col items-center rounded-2xl px-1 py-2 ${k === 0 ? 'bg-white/30 dark:bg-white/10' : ''}`}>
              <div className="text-[11px] font-medium text-muted">{k === 0 ? 'Teď' : newDay ? formatWeekdayShort(t) : formatTime(t).slice(0, 2)}</div>
              <WeatherIcon name={wmoIcon(h.weather_code[i], h.is_day[i] === 1)} size={36} alt={wmoLabel(h.weather_code[i])} />
              <div className="tabular text-base font-semibold">{tempShort(h.temperature_2m[i])}</div>
              <div className="tabular h-4 text-[10px] text-[var(--rain)]">{prob != null && prob >= 10 ? `${num(prob, 0)} %` : ''}</div>
              <div className="tabular h-4 text-[10px] text-muted">{p != null && p >= 0.1 ? `${num(p, 1)}` : ''}</div>
            </div>
          )
        })}
      </div>
      <p className="mt-1 px-4 text-[11px] text-faint">Modrá čísla: pravděpodobnost srážek, šedá: úhrn mm za hodinu.</p>
      <StaleNote updatedAt={f.dataUpdatedAt} error={f.error} />
    </Card>
  )
}

/** Krátkodobá předpověď srážek po 15 min na 2 hodiny */
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
  const max = Math.max(0.5, ...items.map((x) => x.mm))
  let summary: string
  if (!wet.length) summary = 'V příštích 2 hodinách srážky nečekáme.'
  else if (items[0].mm >= 0.1) {
    const dryAt = items.find((x) => x.mm < 0.1)
    summary = dryAt ? `Srážky by měly ustat kolem ${formatTime(dryAt.t - 15 * MINUTE)}.` : 'Srážky budou pokračovat i v příštích 2 hodinách.'
  } else summary = `Srážky mohou začít kolem ${formatTime(wet[0].t - 15 * MINUTE)}.`
  return (
    <Card title="Srážky v příštích 2 hodinách" subtitle="model ICON-D2 po 15 minutách">
      <p className="mb-3 text-sm">{summary}</p>
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
        <span>{formatTime(items[items.length - 1].t)}</span>
      </div>
    </Card>
  )
}
