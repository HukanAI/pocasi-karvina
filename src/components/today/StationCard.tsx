// Naměřené hodnoty ze stanice ČHMÚ Karviná + 48h graf teploty a srážek

import type { EChartsOption } from 'echarts'
import { CHMI_STATION } from '../../config.ts'
import { kmh, mm, ms2kmh, num, pct, temp, windDir } from '../../lib/format.ts'
import { formatAgo, formatTime } from '../../lib/time.ts'
import { STATION_FRESH_MS, useNow } from '../../state/derived.ts'
import { useStationNow } from '../../state/queries.ts'
import { EChart } from '../charts/EChart.tsx'
import { axisStyle, baseOption, useChartColors } from '../charts/chartTheme.ts'
import { Card, ErrorCard, LoadingCard, SourceNote, Stat } from '../ui.tsx'

export function StationCard() {
  const now = useNow(60_000)
  const q = useStationNow()
  const c = useChartColors()
  if (q.isError && !q.data) return <ErrorCard title={`Naměřeno · ČHMÚ ${CHMI_STATION.name}`} error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <LoadingCard title={`Naměřeno · ČHMÚ ${CHMI_STATION.name}`} />
  const { last, today, series } = q.data
  if (!last) return null
  const old = now - last.t > STATION_FRESH_MS

  const times = series.T.map((_, i) => series.start + i * series.step)
  // Hodinové úhrny pro sloupce (součet 6 × 10 min, interval končící v celou hodinu)
  const hourly: [number, number][] = []
  for (let i = 0; i < series.SRA.length; i++) {
    const t = times[i]
    if (t % 3_600_000 !== 0) continue
    let s = 0
    let any = false
    for (let k = 0; k < 6 && i - k >= 0; k++) {
      const v = series.SRA[i - k]
      if (v != null) {
        s += v
        any = true
      }
    }
    if (any) hourly.push([t - 1_800_000, Math.round(s * 10) / 10])
  }

  const option: EChartsOption = {
    ...baseOption(c),
    grid: { left: 4, right: 4, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      ...(baseOption(c).tooltip as object),
      valueFormatter: (v) => (typeof v === 'number' ? num(v, 1) : String(v)),
    },
    xAxis: {
      type: 'time',
      ...axisStyle(c),
      splitLine: { show: false },
      axisLabel: { color: c.muted, fontSize: 10, formatter: (v: number) => formatTime(v) },
    },
    yAxis: [
      { type: 'value', scale: true, ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10, formatter: '{value}°' } },
      { type: 'value', min: 0, max: (v) => Math.max(2, v.max * 1.3), ...axisStyle(c), splitLine: { show: false }, axisLabel: { show: false } },
    ],
    series: [
      {
        name: 'Teplota °C',
        type: 'line',
        showSymbol: false,
        smooth: true,
        data: times.map((t, i) => [t, series.T[i]]),
        lineStyle: { color: c.warm, width: 2 },
        itemStyle: { color: c.warm },
        connectNulls: false,
      },
      { name: 'Srážky mm/h', type: 'bar', yAxisIndex: 1, data: hourly, itemStyle: { color: c.rain, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 6 },
    ],
  }

  return (
    <Card
      title={`Naměřeno · ČHMÚ ${CHMI_STATION.name}`}
      subtitle={`${formatTime(last.t)} (${formatAgo(last.t, now)}) · ${CHMI_STATION.elevation} m n. m.`}
    >
      {old && <p className="mb-2 rounded-xl bg-amber-500/15 px-3 py-1.5 text-xs">Poslední měření je starší než 90 minut – ČHMÚ data zatím nezveřejnil.</p>}
      <div className="grid grid-cols-3 gap-x-3 gap-y-3">
        <Stat label="Teplota" value={temp(last.T)} sub={last.TPM != null ? `u země ${temp(last.TPM)}` : undefined} />
        <Stat label="Vlhkost" value={pct(last.H)} />
        <Stat
          label="Vítr"
          value={last.F != null ? `${num(last.F, 1)} m/s` : '–'}
          sub={last.F != null ? `${kmh(ms2kmh(last.F))} · ${windDir(last.D)}` : undefined}
        />
        <Stat label="Dnes max" value={temp(today?.tmax)} sub={today?.tmaxAt ? `v ${formatTime(today.tmaxAt)}` : undefined} />
        <Stat label="Dnes min" value={temp(today?.tmin)} sub={today?.tminAt ? `v ${formatTime(today.tminAt)}` : undefined} />
        <Stat
          label="Srážky dnes"
          value={mm(today?.prcp)}
          sub={today?.gustMax != null ? `náraz až ${num(today.gustMax, 1)} m/s` : undefined}
        />
      </div>
      <div className="mt-3">
        <EChart option={option} height={150} />
      </div>
      <SourceNote>
        Data: ČHMÚ, opendata.chmi.cz (stanice {CHMI_STATION.wsi}). Měření se zveřejňují jednou za hodinu, poslední hodnoty jsou nezkontrolované. „Dnes“ = od místní půlnoci.
      </SourceNote>
    </Card>
  )
}
