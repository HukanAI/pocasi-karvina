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
import { mean } from '../lib/stats.ts'
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

// ------------------------------------------------------------------ 16denní přehled

/** Barva čísla teploty: mráz modře, teplo oranžově, horko červeně */
function tempClass(t: number | null | undefined): string {
  if (t == null) return ''
  if (t <= 0) return 'text-sky-600 dark:text-sky-300'
  if (t >= 30) return 'text-red-600 dark:text-red-400'
  if (t >= 20) return 'text-orange-600 dark:text-orange-300'
  return ''
}

const dayName = (t: number, k: number) => (k === 0 ? 'Dnes' : k === 1 ? 'Zítra' : formatWeekdayShort(t))

function Drop() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c-3.3 4.4-6.5 8.3-6.5 11.7a6.5 6.5 0 0 0 13 0c0-3.4-3.2-7.3-6.5-11.7Z" />
    </svg>
  )
}

/** Graf teplot a srážek na 16 dní – trend je vidět na první pohled */
function OverviewChart({ f, days }: { f: Forecast; days: { t: number; i: number }[] }) {
  const c = useChartColors()
  const d = f.daily
  const option: EChartsOption = useMemo(
    () => ({
      ...baseOption(c),
      grid: { left: 4, right: 4, top: 30, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
      legend: { top: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 6 },
      tooltip: {
        ...(baseOption(c).tooltip as object),
        formatter: (ps: unknown) => {
          const k = (ps as { dataIndex: number }[])[0].dataIndex
          const { t, i } = days[k]
          return `<b>${dayName(t, k)} ${formatDayMonth(t)}</b><br/>${wmoLabel(d.weather_code[i])}<br/>max ${tempShort(d.temperature_2m_max[i])}, min ${tempShort(d.temperature_2m_min[i])}<br/>srážky ${mm(d.precipitation_sum[i])} (${num(d.precipitation_probability_max[i], 0)} %)`
        },
      },
      xAxis: { type: 'category', data: days.map(({ t }, k) => (k < 2 ? dayName(t, k) : `${formatWeekdayShort(t)}\n${formatDayMonth(t)}`)), ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 9, interval: 1 } },
      yAxis: [
        { type: 'value', scale: true, ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10, formatter: '{value}°' } },
        { type: 'value', min: 0, max: (v: { max: number }) => Math.max(10, Math.ceil(v.max * 1.4)), ...axisStyle(c), splitLine: { show: false }, axisLabel: { show: false } },
      ],
      series: [
        { name: 'Srážky (mm)', type: 'bar', yAxisIndex: 1, data: days.map(({ i }) => d.precipitation_sum[i]), itemStyle: { color: c.rain, opacity: 0.45, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 10 },
        { name: 'Max', type: 'line', smooth: true, symbolSize: 5, data: days.map(({ i }) => d.temperature_2m_max[i]), lineStyle: { color: c.warm, width: 2.5 }, itemStyle: { color: c.warm } },
        { name: 'Min', type: 'line', smooth: true, symbolSize: 5, data: days.map(({ i }) => d.temperature_2m_min[i]), lineStyle: { color: c.cold, width: 2.5 }, itemStyle: { color: c.cold } },
      ],
    }),
    [c, d, days],
  )
  return <EChart option={option} height={190} />
}

function DailyList({ f, updatedAt, error }: { f: Forecast; updatedAt: number; error: unknown }) {
  const now = useNow(60_000)
  const today = localDateKey(now)
  const [open, setOpen] = useState<string | null>(null)
  const d = f.daily
  const days = useMemo(() => d.time.map((t, i) => ({ t, i, key: localDateKey(t) })).filter((x) => x.key >= today), [d, today])

  return (
    <>
      <Card title="Teploty a srážky na 16 dní" subtitle="Oranžová = nejvyšší denní teplota, modrá = noční minimum, sloupce = srážky">
        <OverviewChart f={f} days={days} />
      </Card>
      <Card title="Předpověď po dnech" subtitle="Klepnutím na den zobrazíte průběh po hodinách" pad={false} className="pb-2">
        <div className="flex items-center gap-2 px-4 pb-1 text-[10px] font-semibold tracking-wide text-faint uppercase">
          <span className="w-[56px]">Den</span>
          <span className="w-9" />
          <span className="flex-1">Srážky</span>
          <span className="w-[76px] text-right">Max / min</span>
          <span className="w-3" />
        </div>
        <ul className="divide-soft px-2">
          {days.map(({ t, i, key }, k) => {
            const tmin = d.temperature_2m_min[i]
            const tmax = d.temperature_2m_max[i]
            const prob = d.precipitation_probability_max[i]
            const sum = d.precipitation_sum[i]
            const isOpen = open === key
            const rainy = (prob ?? 0) >= 10 || (sum ?? 0) >= 0.1
            return (
              <li key={key}>
                <button type="button" className="flex w-full items-center gap-2 px-2 py-2.5 text-left" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                  <div className="w-[56px] shrink-0">
                    <div className="text-sm font-semibold capitalize">{dayName(t, k)}</div>
                    <div className="text-[11px] text-faint">{formatDayMonth(t)}</div>
                  </div>
                  <WeatherIcon name={wmoIcon(d.weather_code[i], true)} size={36} alt={wmoLabel(d.weather_code[i])} />
                  <div className="tabular min-w-0 flex-1 text-xs leading-tight">
                    {rainy ? (
                      <>
                        <div className="flex items-center gap-1 font-medium text-[var(--rain)]">
                          <Drop />
                          {num(prob, 0)} %
                        </div>
                        {sum != null && sum >= 0.1 && <div className="mt-0.5 text-muted">{num(sum, 1)} mm</div>}
                      </>
                    ) : (
                      <span className="text-faint">–</span>
                    )}
                  </div>
                  <div className="tabular w-[76px] shrink-0 text-right">
                    <span className={`text-base font-semibold ${tempClass(tmax)}`}>{tempShort(tmax)}</span>
                    <span className="text-faint"> / </span>
                    <span className={`text-sm text-muted ${tempClass(tmin)}`}>{tempShort(tmin)}</span>
                  </div>
                  <svg viewBox="0 0 24 24" className={`h-3 w-3 shrink-0 text-faint transition ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
                {isOpen && <DayDetail f={f} dayIndex={i} />}
              </li>
            )
          })}
        </ul>
        <div className="px-4">
          <SourceNote>Model Open-Meteo „best match“ (pro střední Evropu kombinace ICON-D2, ICON-EU, ECMWF a dalších). Po 7. dni spolehlivost výrazně klesá – viz „Jistota předpovědi“ níže.</SourceNote>
          <StaleNote updatedAt={updatedAt} error={error} />
        </div>
      </Card>
    </>
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
  const days = m.dailyTime.map((t, i) => ({ t, i })).filter((x) => localDateKey(x.t) >= today).slice(0, 5)

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
      <div className="mt-3">
        <table className="tabular w-full table-fixed text-xs">
          <thead>
            <tr className="text-muted">
              <th className="w-[34%] py-1 text-left font-medium">Max. teplota</th>
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
                const color = spread == null ? '#94a3b8' : spread <= 2 ? '#10b981' : spread <= 4 ? '#f59e0b' : '#ef4444'
                return (
                  <td key={i} className="px-1 py-1.5 text-right" title={spread != null ? `rozdíl ${num(spread, 1)} °C` : ''}>
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <SourceNote>
        Shoda modelů: <span className="text-emerald-600">●</span> vysoká (rozdíl max. teplot ≤ 2 °C), <span className="text-amber-500">●</span> střední (≤ 4 °C), <span className="text-red-500">●</span> nízká.
        Pomlčka = model na tento den nepočítá. {MODELS.map((x) => `${x.name} (${x.origin})`).join(', ')}.
      </SourceNote>
    </Card>
  )
}
