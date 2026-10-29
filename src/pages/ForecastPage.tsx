// Předpověď: 16 dní s detailem, nejistota (ensemble ECMWF) a srovnání modelů

import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import type { Ensemble, Forecast, ModelsForecast } from '../api/openMeteo.ts'
import { axisStyle, baseOption, type ChartColors, useChartColors } from '../components/charts/chartTheme.ts'
import { EChart } from '../components/charts/EChart.tsx'
import { Card, ErrorCard, LoadingCard, Segmented, SourceNote, StaleNote } from '../components/ui.tsx'
import { WeatherIcon } from '../components/WeatherIcon.tsx'
import { MODELS } from '../config.ts'
import { kmh, mm, num, tempShort, uvLabel, windDir } from '../lib/format.ts'
import { max, mean, min } from '../lib/stats.ts'
import { DAY, formatDayMonth, formatDuration, formatTime, formatWeekdayLong, formatWeekdayShort, localDateKey } from '../lib/time.ts'
import { wmoIcon, wmoLabel } from '../lib/wmo.ts'
import { useNow } from '../state/derived.ts'
import { useEnsemble, useForecast, useModels } from '../state/queries.ts'

export default function ForecastPage() {
  const f = useForecast()
  return (
    <div className="space-y-3 pb-4">
      {f.isError && !f.data ? <ErrorCard title="Předpověď na 16 dní" error={f.error} onRetry={() => f.refetch()} /> : f.data ? <DailyList f={f.data} updatedAt={f.dataUpdatedAt} error={f.error} /> : <LoadingCard title="Předpověď na 16 dní" lines={8} />}
      <EnsembleCard />
      <ModelsCard />
    </div>
  )
}

// ------------------------------------------------------------------ 16denní seznam

function DailyList({ f, updatedAt, error }: { f: Forecast; updatedAt: number; error: unknown }) {
  const now = useNow(60_000)
  const today = localDateKey(now)
  const [open, setOpen] = useState<string | null>(null)
  const d = f.daily
  const days = d.time.map((t, i) => ({ t, i, key: localDateKey(t) })).filter((x) => x.key >= today)
  const lo = min(days.map((x) => d.temperature_2m_min[x.i])) ?? 0
  const hi = max(days.map((x) => d.temperature_2m_max[x.i])) ?? 1
  const span = Math.max(1, hi - lo)

  return (
    <Card title="Předpověď na 16 dní" subtitle="Klepněte na den pro hodinový průběh a podrobnosti" pad={false} className="pb-2">
      <ul className="divide-soft px-2">
        {days.map(({ t, i, key }, k) => {
          const tmin = d.temperature_2m_min[i]
          const tmax = d.temperature_2m_max[i]
          const prob = d.precipitation_probability_max[i]
          const sum = d.precipitation_sum[i]
          const isOpen = open === key
          return (
            <li key={key}>
              <button type="button" className="flex w-full items-center gap-2 px-2 py-2 text-left" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                <div className="w-[52px] shrink-0">
                  <div className="text-sm font-semibold capitalize">{k === 0 ? 'Dnes' : k === 1 ? 'Zítra' : formatWeekdayShort(t)}</div>
                  <div className="text-[11px] text-faint">{formatDayMonth(t)}</div>
                </div>
                <WeatherIcon name={wmoIcon(d.weather_code[i], true)} size={34} alt={wmoLabel(d.weather_code[i])} />
                <div className="tabular w-11 shrink-0 text-[11px] leading-tight text-[var(--rain)]">
                  {prob != null && prob >= 10 ? `${num(prob, 0)} %` : ''}
                  {sum != null && sum >= 0.1 ? <div className="text-muted">{num(sum, 1)} mm</div> : null}
                </div>
                <div className="tabular w-8 shrink-0 text-right text-sm text-muted">{tempShort(tmin)}</div>
                <div className="relative mx-1 h-1.5 flex-1 rounded-full bg-black/10 dark:bg-white/10">
                  {tmin != null && tmax != null && (
                    <div
                      className="absolute h-full rounded-full"
                      style={{
                        left: `${((tmin - lo) / span) * 100}%`,
                        width: `${Math.max(4, ((tmax - tmin) / span) * 100)}%`,
                        background: 'linear-gradient(90deg, var(--cold), #facc15, var(--warm))',
                      }}
                    />
                  )}
                </div>
                <div className="tabular w-8 shrink-0 text-sm font-semibold">{tempShort(tmax)}</div>
              </button>
              {isOpen && <DayDetail f={f} dayIndex={i} />}
            </li>
          )
        })}
      </ul>
      <div className="px-4">
        <SourceNote>Model Open-Meteo „best match“ (pro střední Evropu kombinace ICON-D2, ICON-EU, ECMWF a dalších). Spolehlivost po 7. dni výrazně klesá – viz graf nejistoty níže.</SourceNote>
        <StaleNote updatedAt={updatedAt} error={error} />
      </div>
    </Card>
  )
}

function DayDetail({ f, dayIndex }: { f: Forecast; dayIndex: number }) {
  const c = useChartColors()
  const d = f.daily
  const start = d.time[dayIndex]
  const end = start + DAY + 3_600_000 // hodina navíc kvůli dnům s 25 hodinami
  const h = f.hourly
  const idx = h.time.map((t, i) => [t, i] as const).filter(([t]) => t >= start && t <= Math.min(end, d.time[dayIndex + 1] ?? end))
  const option: EChartsOption = useMemo(
    () => ({
      ...baseOption(c),
      grid: { left: 4, right: 4, top: 20, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
      xAxis: { type: 'time', ...axisStyle(c), splitLine: { show: false }, axisLabel: { color: c.muted, fontSize: 10, formatter: (v: number) => formatTime(v) } },
      yAxis: [
        { type: 'value', scale: true, ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10, formatter: '{value}°' } },
        { type: 'value', min: 0, max: (v: { max: number }) => Math.max(2, v.max * 1.2), ...axisStyle(c), splitLine: { show: false }, axisLabel: { show: false } },
      ],
      tooltip: { ...(baseOption(c).tooltip as object), valueFormatter: (v) => (typeof v === 'number' ? num(v, 1) : String(v)) },
      series: [
        { name: 'Teplota °C', type: 'line', smooth: true, showSymbol: false, data: idx.map(([t, i]) => [t, h.temperature_2m[i]]), lineStyle: { color: c.warm, width: 2 }, itemStyle: { color: c.warm } },
        { name: 'Pocitová °C', type: 'line', smooth: true, showSymbol: false, data: idx.map(([t, i]) => [t, h.apparent_temperature[i]]), lineStyle: { color: c.warm, width: 1, type: 'dashed', opacity: 0.6 }, itemStyle: { color: c.warm } },
        { name: 'Srážky mm', type: 'bar', yAxisIndex: 1, data: idx.map(([t, i]) => [t - 1_800_000, h.precipitation[i]]), itemStyle: { color: c.rain, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 8 },
      ],
    }),
    [c, idx, h],
  )
  const rows: [string, string][] = [
    ['Stav', wmoLabel(d.weather_code[dayIndex])],
    ['Pocitová teplota', `${tempShort(d.apparent_temperature_min[dayIndex])} až ${tempShort(d.apparent_temperature_max[dayIndex])}`],
    ['Srážky', `${mm(d.precipitation_sum[dayIndex])} · ${num(d.precipitation_hours[dayIndex], 0)} h · ${num(d.precipitation_probability_max[dayIndex], 0)} %`],
    ...(d.snowfall_sum[dayIndex] ? [['Nový sníh', `${num(d.snowfall_sum[dayIndex], 1)} cm`] as [string, string]] : []),
    ['Vítr', `${kmh(d.wind_speed_10m_max[dayIndex])} ${windDir(d.wind_direction_10m_dominant[dayIndex])}, nárazy ${kmh(d.wind_gusts_10m_max[dayIndex])}`],
    ['Sluneční svit', d.sunshine_duration[dayIndex] != null ? formatDuration(d.sunshine_duration[dayIndex]! * 1000) : '–'],
    ['UV index', `${num(d.uv_index_max[dayIndex], 0)} (${uvLabel(d.uv_index_max[dayIndex])})`],
    ['Slunce', `${d.sunrise[dayIndex] ? formatTime(d.sunrise[dayIndex]!) : '–'} – ${d.sunset[dayIndex] ? formatTime(d.sunset[dayIndex]!) : '–'}`],
  ]
  return (
    <div className="px-2 pb-3">
      <p className="mb-1 text-xs font-medium text-muted capitalize">{formatWeekdayLong(start)} {formatDayMonth(start)}</p>
      {idx.length > 1 && <EChart option={option} height={150} />}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ------------------------------------------------------------------ Nejistota (ensemble)

function ensembleOption(e: Ensemble, c: ChartColors, now: number): EChartsOption {
  const idx = e.time.map((t, i) => [t, i] as const).filter(([t]) => t >= now - 3_600_000)
  const lower = idx.map(([t, i]) => [t, e.t10[i]])
  const band = idx.map(([t, i]) => [t, e.t90[i] != null && e.t10[i] != null ? e.t90[i]! - e.t10[i]! : null])
  return {
    ...baseOption(c),
    grid: { left: 4, right: 4, top: 28, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    legend: { top: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 14, itemHeight: 8, data: ['Medián', 'Rozpětí 10–90 %', 'Pravděpodobnost srážek'] },
    tooltip: {
      ...(baseOption(c).tooltip as object),
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[]
        const i = idx[ps[0]?.dataIndex ?? 0]?.[1]
        if (i == null) return ''
        return `${formatWeekdayShort(e.time[i])} ${formatDayMonth(e.time[i])} ${formatTime(e.time[i])}<br/>Medián <b>${num(e.t50[i], 1)} °C</b><br/>Rozpětí ${num(e.t10[i], 1)} až ${num(e.t90[i], 1)} °C<br/>Srážky: ${num(e.precipProb[i], 0)} % členů`
      },
    },
    xAxis: { type: 'time', ...axisStyle(c), splitLine: { show: false }, axisLabel: { color: c.muted, fontSize: 10, formatter: (v: number) => `${formatDayMonth(v)}` } },
    yAxis: [
      { type: 'value', scale: true, ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10, formatter: '{value}°' } },
      { type: 'value', min: 0, max: 100, ...axisStyle(c), splitLine: { show: false }, axisLabel: { show: false } },
    ],
    series: [
      { name: 'Spodní', type: 'line', data: lower, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, tooltip: { show: false } },
      { name: 'Rozpětí 10–90 %', type: 'line', data: band, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: c.warm, opacity: 0.22 }, itemStyle: { color: c.warm } },
      { name: 'Medián', type: 'line', data: idx.map(([t, i]) => [t, e.t50[i]]), symbol: 'none', smooth: true, lineStyle: { color: c.warm, width: 2 }, itemStyle: { color: c.warm } },
      { name: 'Pravděpodobnost srážek', type: 'bar', yAxisIndex: 1, data: idx.map(([t, i]) => [t, e.precipProb[i]]), itemStyle: { color: c.rain, opacity: 0.22 }, barMaxWidth: 2 },
    ],
  }
}

function EnsembleCard() {
  const now = useNow(600_000)
  const q = useEnsemble()
  const c = useChartColors()
  const option = useMemo(() => (q.data ? ensembleOption(q.data, c, now) : null), [q.data, c, now])
  if (q.isError && !q.data) return <ErrorCard title="Jistota předpovědi" error={q.error} onRetry={() => q.refetch()} />
  if (!q.data || !option) return <LoadingCard title="Jistota předpovědi" lines={6} />
  // Šířka rozpětí po dnech → slovní hodnocení
  const e = q.data
  const byDay = new Map<string, number[]>()
  e.time.forEach((t, i) => {
    if (t < now || e.t90[i] == null || e.t10[i] == null) return
    const k = localDateKey(t)
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k)!.push(e.t90[i]! - e.t10[i]!)
  })
  const days = [...byDay.entries()].map(([k, v]) => ({ k, spread: mean(v)! }))
  const reliableUntil = days.findIndex((d) => d.spread > 6)
  return (
    <Card title="Jistota předpovědi" subtitle={`ECMWF ensemble · ${e.members} variant výpočtu · 15 dní`}>
      <EChart option={option} height={220} />
      <p className="mt-2 text-sm">
        {reliableUntil === -1
          ? 'Varianty se shodují po celých 15 dní – předpověď je neobvykle jistá.'
          : reliableUntil <= 1
            ? 'Varianty se rozcházejí už v nejbližších dnech – počasí je těžko předvídatelné.'
            : `Teplotu lze spolehlivě předpovědět asi na ${reliableUntil} ${reliableUntil < 5 ? 'dny' : 'dní'}, pak se varianty rozcházejí o více než 6 °C.`}
      </p>
      <SourceNote>
        Stínovaný pás ukazuje, kde leží 80 % variant (10.–90. percentil). Čím širší pás, tím nejistější předpověď. Sloupce: podíl variant se srážkami ≥ 0,1 mm/h.
      </SourceNote>
    </Card>
  )
}

// ------------------------------------------------------------------ Srovnání modelů

type ModelVar = 'temperature_2m' | 'precipitation' | 'wind_gusts_10m'

function modelsOption(m: ModelsForecast, v: ModelVar, c: ChartColors, now: number): EChartsOption {
  const idx = m.hourlyTime.map((t, i) => [t, i] as const).filter(([t]) => t >= now - 3_600_000 && t <= now + 7 * DAY)
  return {
    ...baseOption(c),
    grid: { left: 4, right: 4, top: 52, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    legend: { top: 0, textStyle: { color: c.muted, fontSize: 10 }, itemWidth: 12, itemHeight: 6, itemGap: 8 },
    tooltip: { ...(baseOption(c).tooltip as object), valueFormatter: (x) => (typeof x === 'number' ? num(x, 1) : '–') },
    xAxis: { type: 'time', ...axisStyle(c), splitLine: { show: false }, axisLabel: { color: c.muted, fontSize: 10, formatter: (x: number) => formatDayMonth(x) } },
    yAxis: { type: 'value', scale: v === 'temperature_2m', min: v === 'temperature_2m' ? undefined : 0, ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10, formatter: v === 'temperature_2m' ? '{value}°' : '{value}' } },
    series: MODELS.map((model) => {
      const run = m.models.find((r) => r.id === model.id)!
      return {
        name: model.name,
        type: 'line' as const,
        showSymbol: false,
        connectNulls: false,
        data: idx.map(([t, i]) => [t, run.hourly[v][i] ?? null]),
        lineStyle: { color: model.color, width: 1.6 },
        itemStyle: { color: model.color },
        step: v === 'precipitation' ? ('end' as const) : undefined,
      }
    }),
  }
}

function ModelsCard() {
  const now = useNow(600_000)
  const q = useModels()
  const c = useChartColors()
  const [v, setV] = useState<ModelVar>('temperature_2m')
  const option = useMemo(() => (q.data ? modelsOption(q.data, v, c, now) : null), [q.data, v, c, now])
  if (q.isError && !q.data) return <ErrorCard title="Srovnání modelů" error={q.error} onRetry={() => q.refetch()} />
  if (!q.data || !option) return <LoadingCard title="Srovnání modelů" lines={6} />
  const m = q.data
  const today = localDateKey(now)
  const days = m.dailyTime.map((t, i) => ({ t, i })).filter((x) => localDateKey(x.t) >= today).slice(0, 7)

  return (
    <Card title="Srovnání modelů" subtitle="Jak se shodují jednotlivé předpovědní modely">
      <Segmented
        value={v}
        onChange={setV}
        options={[
          { value: 'temperature_2m', label: 'Teplota' },
          { value: 'precipitation', label: 'Srážky' },
          { value: 'wind_gusts_10m', label: 'Nárazy' },
        ]}
      />
      <div className="mt-2">
        <EChart option={option} height={240} />
      </div>
      <div className="no-scrollbar mt-3 overflow-x-auto">
        <table className="tabular w-full min-w-[460px] text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 text-left font-medium">Max. teplota</th>
              {days.map(({ t }) => (
                <th key={t} className="px-1 py-1 text-right font-medium capitalize">
                  {formatWeekdayShort(t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODELS.map((model) => {
              const run = m.models.find((r) => r.id === model.id)!
              return (
                <tr key={model.id} className="border-t border-[var(--divider)]">
                  <td className="py-1 pr-2 whitespace-nowrap">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: model.color }} />
                    {model.name}
                  </td>
                  {days.map(({ i }) => (
                    <td key={i} className="px-1 py-1 text-right">
                      {run.daily.temperature_2m_max[i] != null ? `${num(run.daily.temperature_2m_max[i], 0)}°` : <span className="text-faint">–</span>}
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr className="border-t border-[var(--divider)] font-semibold">
              <td className="py-1 pr-2">Shoda modelů</td>
              {days.map(({ i }) => {
                const vals = m.models.map((r) => r.daily.temperature_2m_max[i]).filter((x): x is number => x != null)
                const spread = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null
                const label = spread == null ? '–' : spread <= 2 ? 'vysoká' : spread <= 4 ? 'střední' : 'nízká'
                const color = spread == null ? '' : spread <= 2 ? 'text-emerald-600 dark:text-emerald-400' : spread <= 4 ? 'text-amber-600 dark:text-amber-300' : 'text-red-600 dark:text-red-400'
                return (
                  <td key={i} className={`px-1 py-1 text-right ${color}`} title={spread != null ? `rozdíl ${num(spread, 1)} °C` : ''}>
                    {label}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <SourceNote>
        {MODELS.map((x) => `${x.name} (${x.origin})`).join(', ')}. Pomlčka = model na tento den nepočítá. Shoda: rozdíl max. teplot mezi modely ≤ 2 °C vysoká, ≤ 4 °C střední, jinak nízká.
      </SourceNote>
    </Card>
  )
}
