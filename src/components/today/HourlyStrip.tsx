// Hodinová předpověď na 48 h (vodorovně posuvný pás) + 2h výhled srážek

import { indexAtOrBefore } from '../../api/openMeteo.ts'
import { num, tempShort } from '../../lib/format.ts'
import { nowcastQuarters, nowcastSummary } from '../../lib/rain.ts'
import { formatTime, formatWeekdayShort, localDateKey } from '../../lib/time.ts'
import { effectiveCode, wmoIcon, wmoLabel } from '../../lib/wmo.ts'
import { useCurrentWeather, useNow, useNowTemp } from '../../state/derived.ts'
import { useForecast } from '../../state/queries.ts'
import { PrecipBars } from '../PrecipBars.tsx'
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
  const cw = useCurrentWeather(now)
  const nowTemp = useNowTemp(now)
  if (f.isError && !f.data) return <ErrorCard title="Hodinová předpověď" error={f.error} onRetry={() => f.refetch()} />
  if (!f.data) return <LoadingCard title="Hodinová předpověď" />
  const h = f.data.hourly
  const start = Math.max(0, indexAtOrBefore(h.time, now))
  // Sloupec „19“ = hodina 19:00–20:00. Teplota platí v 19:00, srážky a pravděpodobnost Open-Meteo udává
  // za předchozí hodinu, takže pro tuto hodinu se berou z hodnoty v 20:00 (index + 1).
  const idx = Array.from({ length: 48 }, (_, i) => start + i).filter((i) => i + 1 < h.time.length)
  const prob = (i: number) => h.precipitation_probability[i + 1]
  // Ikona odpovídá srážkám té hodiny (kód „déšť“ při 0 mm se nahradí oblačností)
  // Sloupec „Teď“ ukazuje totéž co nadpis (měřená teplota, aktuální stav)
  const code = (i: number) => (i === start && cw ? cw.code : effectiveCode(h.weather_code[i + 1], h.precipitation[i + 1], h.cloud_cover[i + 1]))
  // Řádek srážek jen tehdy, když v příštích 48 h nějaké hrozí
  const showRain = idx.some((i) => (prob(i) ?? 0) >= 10 || (h.precipitation[i + 1] ?? 0) >= 0.1)
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
              <WeatherIcon name={wmoIcon(code(i), k === 0 && cw ? cw.isDay : h.is_day[i] === 1)} size={38} alt={wmoLabel(code(i))} />
              <div className="tabular text-base font-semibold">{tempShort(k === 0 ? nowTemp : h.temperature_2m[i])}</div>
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
  const q = nowcastQuarters(f.data.minutely15.time, f.data.minutely15.precipitation, now)
  const s = nowcastSummary(q)
  if (!s) return null
  if (s.kind === 'dry') {
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
  const summary =
    s.kind === 'ongoing'
      ? s.dryAt
        ? `Srážky by měly ustat kolem ${formatTime(s.dryAt)}.`
        : 'Srážky budou pokračovat i v příštích 2 hodinách.'
      : `Srážky mohou začít kolem ${formatTime(s.at)}.`
  return (
    <Card title="Srážky v příštích 2 hodinách">
      <p className="text-sm font-medium">{summary}</p>
      <p className="mb-2 text-xs text-muted">Celkem asi {num(s.total, 1)} mm za 2 hodiny</p>
      <PrecipBars bars={q} values />
      <p className="mt-2 text-[11px] text-faint">Po 15 minutách, model ICON-D2. Výška sloupce = množství srážek za 15 minut.</p>
    </Card>
  )
}
