// Kvalita ovzduší a pyl (model CAMS přes Open-Meteo)

import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import type { Air } from '../api/openMeteo.ts'
import { axisStyle, baseOption, type ChartColors, useChartColors } from '../components/charts/chartTheme.ts'
import { EChart } from '../components/charts/EChart.tsx'
import { Card, ErrorCard, LoadingCard, Segmented, SourceNote, StaleNote } from '../components/ui.tsx'
import { EAQI_BANDS, eaqiBand, POLLEN, pollenLevel, POLLUTANTS, type Pollutant } from '../lib/aqi.ts'
import { num } from '../lib/format.ts'
import { mean } from '../lib/stats.ts'
import { formatDayMonth, formatTime, formatWeekdayShort, localDateKey } from '../lib/time.ts'
import { useNow } from '../state/derived.ts'
import { useAir } from '../state/queries.ts'

function Gauge({ value }: { value: number | null }) {
  const band = eaqiBand(value)
  const v = Math.min(120, Math.max(0, value ?? 0))
  const ang = Math.PI * (1 - v / 120)
  const x = 60 + 48 * Math.cos(ang)
  const y = 60 - 48 * Math.sin(ang)
  const seg = (from: number, to: number, color: string) => {
    const a1 = Math.PI * (1 - from / 120)
    const a2 = Math.PI * (1 - to / 120)
    return <path key={from} d={`M${60 + 48 * Math.cos(a1)} ${60 - 48 * Math.sin(a1)} A48 48 0 0 1 ${60 + 48 * Math.cos(a2)} ${60 - 48 * Math.sin(a2)}`} stroke={color} strokeWidth="10" fill="none" />
  }
  return (
    <svg viewBox="0 0 120 68" className="mx-auto w-full max-w-[240px]" aria-hidden="true">
      {EAQI_BANDS.map((b, i) => seg(i * 20, Math.min(120, i === EAQI_BANDS.length - 1 ? 120 : b.max), b.color))}
      <circle cx={x} cy={y} r="6" fill="white" stroke="#0f172a" strokeWidth="2" />
      <text x="60" y="56" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">
        {num(value, 0)}
      </text>
      <text x="60" y="66" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.7">
        {band?.label ?? '–'}
      </text>
    </svg>
  )
}

function airOption(a: Air, key: Pollutant['key'] | 'european_aqi', c: ChartColors, now: number): EChartsOption {
  const idx = a.hourly.time.map((t, i) => [t, i] as const).filter(([t]) => t >= now - 24 * 3_600_000)
  const p = POLLUTANTS.find((x) => x.key === key)
  const isIndex = key === 'european_aqi'
  return {
    ...baseOption(c),
    grid: { left: 4, right: 4, top: 16, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    tooltip: { ...(baseOption(c).tooltip as object), valueFormatter: (v) => (typeof v === 'number' ? `${num(v, 0)}${isIndex ? '' : ' µg/m³'}` : '–') },
    xAxis: { type: 'time', ...axisStyle(c), splitLine: { show: false }, axisLabel: { color: c.muted, fontSize: 10, formatter: (v: number) => formatWeekdayShort(v) } },
    yAxis: {
      type: 'value',
      min: 0,
      max: (v: { max: number }) => Math.ceil(Math.max(v.max, p?.limitValue ?? 0) * 1.1),
      ...axisStyle(c),
      axisLabel: { color: c.muted, fontSize: 10 },
    },
    // Barevná pásma jen u celkového indexu; u látek by hodinové hranice odporovaly indexu (ten počítá s průměry)
    ...(isIndex
      ? {
          visualMap: {
            show: false,
            pieces: EAQI_BANDS.map((b, i) => ({ gt: i === 0 ? -1 : EAQI_BANDS[i - 1].max, lte: Number.isFinite(b.max) ? b.max : 100000, color: b.color })),
            dimension: 1,
          },
        }
      : {}),
    series: [
      {
        name: isIndex ? 'EAQI' : p!.short,
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: idx.map(([t, i]) => [t, a.hourly[key][i]]),
        lineStyle: { width: 2.5, ...(isIndex ? {} : { color: c.accent }) },
        itemStyle: isIndex ? undefined : { color: c.accent },
        areaStyle: { opacity: 0.15 },
        markLine: {
          symbol: 'none',
          silent: true,
          data: [
            { xAxis: now, label: { show: false }, lineStyle: { color: c.muted, type: 'dashed' } },
            ...(p?.limitValue
              ? [{ yAxis: p.limitValue, label: { show: true, formatter: `limit ${p.limitValue}`, color: '#ef4444', fontSize: 10, position: 'insideEndTop' as const }, lineStyle: { color: '#ef4444', type: 'dashed' as const } }]
              : []),
          ],
        },
      },
    ],
  }
}

export default function AirPage() {
  const now = useNow(60_000)
  const q = useAir()
  const c = useChartColors()
  const [key, setKey] = useState<Pollutant['key'] | 'european_aqi'>('european_aqi')
  const option = useMemo(() => (q.data ? airOption(q.data, key, c, now) : null), [q.data, key, c, now])
  if (q.isError && !q.data) return <ErrorCard title="Kvalita ovzduší" error={q.error} onRetry={() => q.refetch()} />
  if (!q.data || !option) return <LoadingCard title="Kvalita ovzduší" lines={8} />
  const a = q.data
  const band = eaqiBand(a.current.european_aqi)

  // Denní průměry PM10 a PM2,5 (pro porovnání s denními limity)
  const days = new Map<string, { t: number; pm10: (number | null)[]; pm25: (number | null)[] }>()
  a.hourly.time.forEach((t, i) => {
    // Hodinová hodnota v čase t patří k hodině končící v t → den podle t − 1 ms
    const k = localDateKey(t - 1)
    if (k < localDateKey(now)) return
    if (!days.has(k)) days.set(k, { t, pm10: [], pm25: [] })
    days.get(k)!.pm10.push(a.hourly.pm10[i])
    days.get(k)!.pm25.push(a.hourly.pm2_5[i])
  })

  return (
    <div className="space-y-3 pb-4">
      <Card title="Kvalita ovzduší teď" subtitle={`Evropský index EAQI · ${formatTime(a.currentTime)}`}>
        <Gauge value={a.current.european_aqi} />
        {band && <p className="mt-1 text-center text-sm">{band.advice}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {POLLUTANTS.map((p) => {
            const v = a.current[p.key]
            // Barva podle dílčího indexu EAQI (stejný výpočet jako celkový index – klouzavé průměry)
            const b = eaqiBand(a.current[`european_aqi_${p.key}`])
            return (
              <div key={p.key} className="rounded-2xl bg-black/5 p-2.5 dark:bg-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{p.short}</span>
                  {b && (
                    <span className="flex items-center gap-1 text-[10px] text-muted">
                      {b.label}
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
                    </span>
                  )}
                </div>
                <div className="tabular text-lg font-semibold">
                  {num(v, 0)} <span className="text-xs font-normal text-muted">µg/m³</span>
                </div>
                <div className="text-[11px] leading-tight text-faint">{p.limit}</div>
              </div>
            )
          })}
          <div className="rounded-2xl bg-black/5 p-2.5 dark:bg-white/5">
            <span className="text-xs font-semibold">CO</span>
            <div className="tabular text-lg font-semibold">
              {num(a.current.carbon_monoxide, 0)} <span className="text-xs font-normal text-muted">µg/m³</span>
            </div>
            <div className="text-[11px] leading-tight text-faint">Limit 10 000 µg/m³ (8h průměr)</div>
          </div>
        </div>
        <StaleNote updatedAt={q.dataUpdatedAt} error={q.error} />
      </Card>

      <Card title="Průběh a výhled" subtitle="Posledních 24 h a předpověď na 4 dny">
        <Segmented
          value={key}
          onChange={setKey}
          options={[{ value: 'european_aqi' as const, label: 'EAQI' }, ...POLLUTANTS.map((p) => ({ value: p.key, label: p.short }))]}
          className="flex-wrap"
        />
        <div className="mt-2">
          <EChart option={option} height={200} />
        </div>
        <p className="mt-1 text-[11px] text-faint">{key === 'european_aqi' ? 'Barva čáry odpovídá pásmu kvality.' : 'Červená přerušovaná čára = limit pro zdraví.'} Svislá čára = teď.</p>
      </Card>

      <Card title="Prachové částice po dnech" subtitle="Denní průměry vs. limity (PM10 50, PM2,5 25 µg/m³)">
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-1 text-left font-medium">Den</th>
              <th className="py-1 text-right font-medium">PM10</th>
              <th className="py-1 text-right font-medium">PM2,5</th>
            </tr>
          </thead>
          <tbody>
            {[...days.entries()].slice(0, 5).map(([k, d]) => {
              const p10 = mean(d.pm10)
              const p25 = mean(d.pm25)
              const complete = d.pm10.filter((v) => v != null).length >= 20
              return (
                <tr key={k} className="border-t border-[var(--divider)]">
                  <td className="py-1.5 capitalize">
                    {formatWeekdayShort(d.t - 1)} {formatDayMonth(d.t - 1)}
                    {!complete && <span className="ml-1 text-[10px] text-faint">(neúplný)</span>}
                  </td>
                  <td className={`py-1.5 text-right ${p10 != null && Math.round(p10) > 50 ? 'font-bold text-red-600 dark:text-red-400' : ''}`}>{num(p10, 0)}</td>
                  <td className={`py-1.5 text-right ${p25 != null && Math.round(p25) > 25 ? 'font-bold text-red-600 dark:text-red-400' : ''}`}>{num(p25, 0)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <SourceNote>Červeně = zobrazená hodnota je nad denním limitem. Karviná patří k místům s nejvyšším znečištěním prachem v ČR, zejména v zimě při inverzích.</SourceNote>
      </Card>

      <Card title="Pyl" subtitle="Předpověď na dnešek a nejbližší dny">
        <ul className="space-y-2">
          {POLLEN.map((p) => {
            const vals = a.hourly.time.map((t, i) => ({ t, v: a.hourly[p.key][i] })).filter((x) => x.t >= now && x.t <= now + 24 * 3_600_000)
            const peak = vals.reduce<number | null>((m, x) => (x.v != null && (m == null || x.v > m) ? x.v : m), null)
            const lvl = pollenLevel(p, peak)
            return (
              <li key={p.key} className="flex items-center gap-3">
                <span className="w-20 text-sm font-medium">{p.name}</span>
                <div className="flex h-2 flex-1 gap-1">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="flex-1 rounded-full" style={{ background: lvl.level >= n ? lvl.color : 'color-mix(in srgb, var(--fg) 12%, transparent)' }} />
                  ))}
                </div>
                <span className="w-24 text-right text-xs text-muted">
                  {lvl.label}
                  {peak != null && peak >= 1 ? ` (${num(peak, 0)})` : ''}
                </span>
              </li>
            )
          })}
        </ul>
        <SourceNote>
          Maximum na příštích 24 h v zrnech/m³. Sezóny: {POLLEN.map((p) => `${p.name.toLowerCase()} ${p.season}`).join(', ')}. Mimo sezónu model pyl nepočítá.
        </SourceNote>
      </Card>

      <SourceNote>
        Zdroj: Copernicus Atmosphere Monitoring Service (CAMS, rozlišení ~10 km) přes Open-Meteo. Jde o modelové hodnoty, ne o měření stanic ČHMÚ – skutečné koncentrace se mohou lišit, zvlášť při inverzích.
      </SourceNote>
    </div>
  )
}
