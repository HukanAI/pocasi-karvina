// Historie a klima: srovnání s normálem, rekordy, tento den v minulých letech, letošní rok,
// klimatický trend, suchá období a vlastní srovnání let. Zdroj: stanice ČHMÚ Karviná nebo ERA5.

import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { axisStyle, baseOption, useChartColors } from '../components/charts/chartTheme.ts'
import { EChart } from '../components/charts/EChart.tsx'
import { Card, ErrorCard, LoadingCard, Segmented, SourceNote } from '../components/ui.tsx'
import { CHMI_STATION, NORMAL_PERIOD } from '../config.ts'
import {
  cumulativePrecip,
  type DailySeries,
  dayHistory,
  dayNormal,
  dayRecords,
  dayWindowValues,
  drySpells,
  monthlyNormals,
  monthStats,
  type PeriodStats,
  periodStats,
  temperatureGaps,
  trendPerDecade,
  valueAt,
  yearlySeries,
  yearStats,
} from '../lib/climate.ts'
import { mm, num, plural, signed, temp } from '../lib/format.ts'
import { mean, percentileRank, round } from '../lib/stats.ts'
import { addDays, daysBetween, formatFullDate, localDateKey, localMidnight, localParts } from '../lib/time.ts'
import { useNow } from '../state/derived.ts'
import { useEra5Daily, useForecast, useStationDaily } from '../state/queries.ts'
import { useSettings } from '../state/useSettings.ts'

const MONTHS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']
const MONTHS_LONG = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']
/** 2. pád: „29. října“ */
const MONTHS_GENITIVE = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince']
const fmtDate = (key: string) => formatFullDate(localMidnight(key) + 12 * 3_600_000)

export default function HistoryPage() {
  const { settings, update } = useSettings()
  const src = settings.historySource
  const station = useStationDaily(src === 'chmi')
  const era5 = useEra5Daily(src === 'era5')
  const q = src === 'chmi' ? station : era5

  return (
    <div className="space-y-3 pb-4">
      <Card title="Zdroj historických dat">
        <Segmented
          value={src}
          onChange={(v) => update({ historySource: v })}
          options={[
            { value: 'chmi', label: 'Stanice ČHMÚ (měření)' },
            { value: 'era5', label: 'ERA5 (model)' },
          ]}
        />
        <p className="mt-2 text-xs text-muted">
          {src === 'chmi'
            ? `Skutečná měření stanice ČHMÚ ${CHMI_STATION.name} (${CHMI_STATION.elevation} m n. m.) od roku 1877. Řada má mezery – stanice v některých obdobích teplotu neměřila.`
            : 'Reanalýza ERA5 (ECMWF) pro zvolený bod: souvislá řada od roku 1940 bez mezer, ale v hrubém rozlišení (~25 km), proto se od měření může lišit o 1–2 °C.'}
        </p>
      </Card>
      {q.isError && !q.data ? (
        <ErrorCard title="Historická data" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <LoadingCard title="Načítám historická data…" lines={6} />
      ) : (
        <HistoryContent key={src} s={q.data} />
      )}
    </div>
  )
}

function HistoryContent({ s }: { s: DailySeries }) {
  const now = useNow(3_600_000)
  const p = localParts(now)
  const yearly = useMemo(() => yearlySeries(s), [s])
  const normals = useMemo(() => monthlyNormals(s), [s])
  return (
    <>
      <TodayVsNormal s={s} today={localDateKey(now)} month={p.month} day={p.day} year={p.year} />
      <ThisDayHistory s={s} month={p.month} day={p.day} />
      <ThisYear s={s} year={p.year} normals={normals} />
      <Trend s={s} yearly={yearly} />
      <DrySpells s={s} year={p.year} />
      <Compare s={s} yearly={yearly} normals={normals} />
    </>
  )
}

// ------------------------------------------------------------------ Dnes vs. normál

function TodayVsNormal({ s, today, month, day, year }: { s: DailySeries; today: string; month: number; day: number; year: number }) {
  const f = useForecast()
  const yesterday = addDays(today, -1)
  const nMax = dayNormal(s, 'tmax', month, day)
  const nMin = dayNormal(s, 'tmin', month, day)
  const nMean = dayNormal(s, 'tmean', month, day)
  const rec = dayRecords(s, month, day, year - 1)
  const di = f.data ? f.data.daily.time.findIndex((t) => localDateKey(t) === today) : -1
  const fc = di >= 0 && f.data ? { tmax: f.data.daily.temperature_2m_max[di], tmin: f.data.daily.temperature_2m_min[di], tmean: f.data.daily.temperature_2m_mean[di] } : null

  // Percentil dnešního maxima mezi všemi maximy v okně ±7 dní normálového období
  const window = dayWindowValues(s, 'tmax', month, day).values
  const rank = fc?.tmax != null ? percentileRank(window, fc.tmax) : null

  const yMax = valueAt(s, 'tmax', yesterday)
  const yMin = valueAt(s, 'tmin', yesterday)
  const yP = localParts(localMidnight(yesterday) + 12 * 3_600_000)
  const nyMax = dayNormal(s, 'tmax', yP.month, yP.day)
  const nyMin = dayNormal(s, 'tmin', yP.month, yP.day)

  return (
    <Card title={`Dnes (${day}. ${month}.) vs. normál`} subtitle={`Normál ${NORMAL_PERIOD.from}–${NORMAL_PERIOD.to} z ${nMean.years || nMax.years} let, okno ±7 dní`}>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="text-left font-medium">Dnes (předpověď)</th>
            <th className="text-right font-medium">Hodnota</th>
            <th className="text-right font-medium">Normál</th>
            <th className="text-right font-medium">Odchylka</th>
          </tr>
        </thead>
        <tbody>
          <NormalRow label="Maximum" value={fc?.tmax} normal={nMax} />
          <NormalRow label="Průměr" value={fc?.tmean} normal={nMean} />
          <NormalRow label="Minimum" value={fc?.tmin} normal={nMin} />
        </tbody>
      </table>
      {rank != null && (
        <p className="mt-2 text-sm">
          Dnešní maximum je teplejší než <b>{num(rank, 0)} %</b> dní v tomto období roku
          {rank >= 90 ? ' – výrazně nadprůměrně teplo.' : rank <= 10 ? ' – výrazně podprůměrně chladno.' : '.'}
        </p>
      )}
      {(yMax != null || yMin != null) && (
        <p className="mt-2 text-sm text-muted">
          Včera {s.source === 'chmi' ? 'naměřeno' : 'podle ERA5'}: max {temp(yMax)} ({signed(yMax != null && nyMax.mean != null ? yMax - nyMax.mean : null)}), min {temp(yMin)} (
          {signed(yMin != null && nyMin.mean != null ? yMin - nyMin.mean : null)}).
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <RecordTile label="Nejvyšší maximum" e={rec.highestMax} unit="°C" warm />
        <RecordTile label="Nejnižší minimum" e={rec.lowestMin} unit="°C" />
        <RecordTile label="Nejchladnější den (max)" e={rec.lowestMax} unit="°C" />
        <RecordTile label="Nejteplejší noc (min)" e={rec.highestMin} unit="°C" warm />
        <RecordTile label="Nejvíc srážek" e={rec.wettest} unit="mm" rain />
        <div className="rounded-2xl bg-black/5 p-2 dark:bg-white/5">
          <div className="text-xs text-muted">{s.source === 'chmi' ? 'Teplota tohoto dne měřena' : 'Data pro tento den'}</div>
          <div className="tabular font-semibold">
            {rec.years} {plural(rec.years, ['rok', 'roky', 'let'])} od {rec.firstYear ?? '–'}
          </div>
        </div>
      </div>
      <SourceNote>Rekordy pro kalendářní den {day}. {month}. bez letošního roku. {s.source === 'chmi' ? 'Maxima/minima ČHMÚ za období 21–21 h SEČ, srážky 7–7 h SEČ.' : ''}</SourceNote>
    </Card>
  )
}

function NormalRow({ label, value, normal }: { label: string; value: number | null | undefined; normal: { mean: number | null } }) {
  const diff = value != null && normal.mean != null ? value - normal.mean : null
  return (
    <tr className="border-t border-[var(--divider)]">
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-right font-semibold">{temp(value)}</td>
      <td className="py-1.5 text-right text-muted">{temp(normal.mean)}</td>
      <td className={`py-1.5 text-right font-medium ${diff == null ? '' : diff > 0 ? 'text-[var(--warm)]' : 'text-[var(--cold)]'}`}>{signed(diff)}</td>
    </tr>
  )
}

function RecordTile({ label, e, unit, warm, rain }: { label: string; e: { value: number; year: number } | null; unit: string; warm?: boolean; rain?: boolean }) {
  const bg = rain ? 'bg-blue-500/15' : warm ? 'bg-orange-500/15' : 'bg-sky-500/15'
  return (
    <div className={`rounded-2xl p-2 ${bg}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular font-semibold">{e ? `${num(e.value, 1)} ${unit}` : '–'}</div>
      <div className="text-xs text-faint">{e ? `v roce ${e.year}` : ''}</div>
    </div>
  )
}

// ------------------------------------------------------------------ Tento den v minulých letech

function ThisDayHistory({ s, month, day }: { s: DailySeries; month: number; day: number }) {
  const c = useChartColors()
  const [showAll, setShowAll] = useState(false)
  const rows = useMemo(() => dayHistory(s, month, day), [s, month, day])
  const first = rows[0]?.year ?? 1940
  const last = rows[rows.length - 1]?.year ?? 2025
  const option: EChartsOption = useMemo(() => {
    const years = Array.from({ length: last - first + 1 }, (_, i) => first + i)
    const by = new Map(rows.map((r) => [r.year, r]))
    return {
      ...baseOption(c),
      grid: { left: 4, right: 4, top: 28, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
      legend: { top: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 6 },
      tooltip: { ...(baseOption(c).tooltip as object), valueFormatter: (v) => (typeof v === 'number' ? `${num(v, 1)}` : '–') },
      xAxis: { type: 'category', data: years.map(String), ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10 } },
      yAxis: [
        { type: 'value', scale: true, ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10, formatter: '{value}°' } },
        { type: 'value', min: 0, ...axisStyle(c), splitLine: { show: false }, axisLabel: { show: false } },
      ],
      dataZoom: [{ type: 'inside', start: years.length > 60 ? 50 : 0, end: 100 }],
      series: [
        { name: 'Maximum', type: 'line', data: years.map((y) => by.get(y)?.tmax ?? null), connectNulls: false, symbolSize: 4, lineStyle: { color: c.warm, width: 1.5 }, itemStyle: { color: c.warm } },
        { name: 'Minimum', type: 'line', data: years.map((y) => by.get(y)?.tmin ?? null), connectNulls: false, symbolSize: 4, lineStyle: { color: c.cold, width: 1.5 }, itemStyle: { color: c.cold } },
        { name: 'Srážky mm', type: 'bar', yAxisIndex: 1, data: years.map((y) => by.get(y)?.prcp ?? null), itemStyle: { color: c.rain, opacity: 0.45 }, barMaxWidth: 4 },
      ],
    }
  }, [rows, c, first, last])
  const list = [...rows].reverse()
  const shown = showAll ? list : list.slice(0, 12)
  return (
    <Card title={`${day}. ${MONTHS_GENITIVE[month - 1]} v minulých letech`} subtitle={`${rows.length} let s daty (${first}–${last}) · graf lze posouvat a přibližovat`}>
      <EChart option={option} height={220} />
      <table className="tabular mt-3 w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="text-left font-medium">Rok</th>
            <th className="text-right font-medium">Max</th>
            <th className="text-right font-medium">Min</th>
            <th className="text-right font-medium">Srážky</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.year} className="border-t border-[var(--divider)]">
              <td className="py-1">{r.year}</td>
              <td className="py-1 text-right">{temp(r.tmax)}</td>
              <td className="py-1 text-right">{temp(r.tmin)}</td>
              <td className="py-1 text-right">{r.prcp != null ? mm(r.prcp) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > 12 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-sm font-medium text-[var(--accent)]">
          {showAll ? 'Zobrazit méně' : `Zobrazit všech ${list.length} let`}
        </button>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------ Letošní rok

function ThisYear({ s, year, normals }: { s: DailySeries; year: number; normals: ReturnType<typeof monthlyNormals> }) {
  const c = useChartColors()
  const lastDate = s.end
  const lastP = localParts(localMidnight(lastDate) + 12 * 3_600_000)
  const months = useMemo(() => {
    const out: { m: number; st: PeriodStats; partial: boolean }[] = []
    for (let m = 1; m <= 12; m++) {
      if (year > lastP.year || (year === lastP.year && m > lastP.month)) break
      const partial = year === lastP.year && m === lastP.month && lastP.day < new Date(Date.UTC(year, m, 0)).getUTCDate()
      const st = partial ? periodStats(s, `${year}-${String(m).padStart(2, '0')}-01`, lastDate) : monthStats(s, year, m)
      out.push({ m, st, partial })
    }
    return out
  }, [s, year, lastDate, lastP.year, lastP.month, lastP.day])
  const cum = useMemo(() => cumulativePrecip(s, year), [s, year])
  const ytd = useMemo(() => periodStats(s, `${year}-01-01`, lastDate), [s, year, lastDate])
  // Normál stejného období (1. 1. – poslední den s daty) pro počty charakteristických dní
  const ytdNormal = useMemo(() => {
    const rows: PeriodStats[] = []
    for (let y = NORMAL_PERIOD.from; y <= NORMAL_PERIOD.to; y++) {
      const st = periodStats(s, `${y}-01-01`, `${y}${lastDate.slice(4)}`)
      if (st.coverageT >= 0.9) rows.push(st)
    }
    const avg = (k: keyof PeriodStats) => mean(rows.map((r) => r[k] as number))
    return { tropicalDays: avg('tropicalDays'), summerDays: avg('summerDays'), frostDays: avg('frostDays'), iceDays: avg('iceDays'), tropicalNights: avg('tropicalNights'), years: rows.length }
  }, [s, lastDate])

  const anomalyOption: EChartsOption = useMemo(
    () => ({
      ...baseOption(c),
      grid: { left: 4, right: 4, top: 16, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
      tooltip: {
        ...(baseOption(c).tooltip as object),
        formatter: (ps: unknown) => {
          const i = (ps as { dataIndex: number }[])[0].dataIndex
          const row = months[i]
          const n = normals[row.m - 1]
          return `${MONTHS_LONG[row.m - 1]}${row.partial ? ' (dosud)' : ''}<br/>Průměr <b>${temp(row.st.tmean, 1)}</b>, normál ${temp(n.tmean, 1)}<br/>Srážky ${mm(row.st.prcp)}, normál ${mm(n.prcp)}`
        },
      },
      xAxis: { type: 'category', data: months.map((x) => MONTHS[x.m - 1]), ...axisStyle(c) },
      yAxis: { type: 'value', ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10, formatter: (v: number) => `${v > 0 ? '+' : ''}${v}°` } },
      series: [
        {
          name: 'Odchylka teploty',
          type: 'bar',
          data: months.map((x) => {
            const n = normals[x.m - 1].tmean
            const v = x.st.tmean != null && n != null ? round(x.st.tmean - n, 1) : null
            return { value: v, itemStyle: { color: v != null && v >= 0 ? c.warm : c.cold, opacity: x.partial ? 0.5 : 1, borderRadius: v != null && v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } }
          }),
          barMaxWidth: 18,
        },
      ],
    }),
    [c, months, normals],
  )

  const precipOption: EChartsOption = useMemo(() => {
    const start = Date.UTC(year, 0, 1)
    const days = cum.normal.map((_, i) => start + i * 86_400_000)
    return {
      ...baseOption(c),
      grid: { left: 4, right: 4, top: 28, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
      legend: { top: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 6 },
      tooltip: { ...(baseOption(c).tooltip as object), valueFormatter: (v) => (typeof v === 'number' ? `${num(v, 0)} mm` : '–') },
      xAxis: { type: 'time', ...axisStyle(c), splitLine: { show: false }, axisLabel: { color: c.muted, fontSize: 10, formatter: (v: number) => MONTHS[new Date(v).getUTCMonth()] } },
      yAxis: { type: 'value', ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10 } },
      series: [
        { name: `Normál ${NORMAL_PERIOD.from}–${NORMAL_PERIOD.to}`, type: 'line', showSymbol: false, data: days.map((t, i) => [t, cum.normal[i]]), lineStyle: { color: c.muted, type: 'dashed', width: 1.5 }, itemStyle: { color: c.muted } },
        { name: String(year), type: 'line', showSymbol: false, data: days.map((t, i) => [t, cum.actual[i]]), lineStyle: { color: c.rain, width: 2.5 }, itemStyle: { color: c.rain }, areaStyle: { color: c.rain, opacity: 0.12 } },
      ],
    }
  }, [c, cum, year])

  const lastIdx = daysBetween(`${year}-01-01`, lastDate)
  const actualToDate = cum.actual[lastIdx] ?? null
  const normalToDate = cum.normal[lastIdx] ?? null
  return (
    <Card title={`Rok ${year}`} subtitle={`Data do ${fmtDate(lastDate)}`}>
      <h3 className="text-sm font-semibold">Teplota po měsících – odchylka od normálu</h3>
      <EChart option={anomalyOption} height={180} />
      <h3 className="mt-3 text-sm font-semibold">Srážky od začátku roku</h3>
      <EChart option={precipOption} height={200} />
      {actualToDate != null && normalToDate != null && normalToDate > 0 && (
        <p className="mt-1 text-sm">
          Zatím spadlo <b>{mm(actualToDate, 0)}</b>, tj. <b>{num((actualToDate / normalToDate) * 100, 0)} %</b> normálu pro toto období ({mm(normalToDate, 0)}).
          {cum.missing && <span className="text-xs text-amber-700 dark:text-amber-300"> Některé dny chybí, skutečný úhrn může být vyšší.</span>}
        </p>
      )}
      <h3 className="mt-3 text-sm font-semibold">Charakteristické dny od 1. 1.</h3>
      <table className="tabular mt-1 w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="text-left font-medium" />
            <th className="text-right font-medium">{year}</th>
            <th className="text-right font-medium">Normál</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['Tropické dny (max ≥ 30 °C)', ytd.tropicalDays, ytdNormal.tropicalDays],
              ['Letní dny (max ≥ 25 °C)', ytd.summerDays, ytdNormal.summerDays],
              ['Tropické noci (min ≥ 20 °C)', ytd.tropicalNights, ytdNormal.tropicalNights],
              ['Mrazové dny (min < 0 °C)', ytd.frostDays, ytdNormal.frostDays],
              ['Ledové dny (max < 0 °C)', ytd.iceDays, ytdNormal.iceDays],
            ] as const
          ).map(([l, v, n]) => (
            <tr key={l} className="border-t border-[var(--divider)]">
              <td className="py-1">{l}</td>
              <td className="py-1 text-right font-semibold">{v}</td>
              <td className="py-1 text-right text-muted">{num(n, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SourceNote>Normál počtu dní = průměr za stejné období (1. 1. – {lastDate.slice(8, 10).replace(/^0/, '')}. {Number(lastDate.slice(5, 7))}.) let {NORMAL_PERIOD.from}–{NORMAL_PERIOD.to} ({ytdNormal.years} let s daty). Poloprůhledný sloupec = rozpracovaný měsíc.</SourceNote>
    </Card>
  )
}

// ------------------------------------------------------------------ Klimatický trend

function Trend({ s, yearly }: { s: DailySeries; yearly: ReturnType<typeof yearlySeries> }) {
  const c = useChartColors()
  const d = useMemo(() => {
    const valid = yearly.filter((r) => r.tmean != null)
    const first = valid[0]?.year
    return {
      valid,
      first,
      shown: yearly.filter((r) => first != null && r.year >= first),
      normal: mean(valid.filter((r) => r.year >= NORMAL_PERIOD.from && r.year <= NORMAL_PERIOD.to).map((r) => r.tmean)),
      gaps: temperatureGaps(yearly),
      trendAll: trendPerDecade(yearly),
      trend1961: trendPerDecade(yearly, 1961),
      warmest: [...valid].sort((a, b) => b.tmean! - a.tmean!).slice(0, 5),
    }
  }, [yearly])
  const { valid, first, shown, normal, gaps, trendAll, trend1961, warmest } = d

  const option: EChartsOption = useMemo(() => {
    const { valid, shown, trend1961, first } = d
    const reg = trend1961 ? valid.filter((r) => r.year >= 1961) : []
    // Trendová přímka z regrese (přes 1961→)
    let line: [number, number][] = []
    if (trend1961 && reg.length) {
      const xs = reg.map((r) => r.year)
      const ys = reg.map((r) => r.tmean!)
      const mx = mean(xs)!
      const my = mean(ys)!
      const slope = trend1961.perDecade / 10
      line = [
        [xs[0], my + slope * (xs[0] - mx)],
        [xs[xs.length - 1], my + slope * (xs[xs.length - 1] - mx)],
      ]
    }
    return {
      ...baseOption(c),
      grid: { left: 4, right: 4, top: 28, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
      legend: { top: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 6 },
      tooltip: { ...(baseOption(c).tooltip as object), valueFormatter: (v) => (typeof v === 'number' ? `${num(v, 2)} °C` : '–') },
      xAxis: {
        type: 'value',
        min: first,
        max: shown[shown.length - 1]?.year,
        ...axisStyle(c),
        splitLine: { show: false },
        // Jen kulaté roky – krajní hodnoty (např. 1877) by se s nimi překrývaly
        axisLabel: { color: c.muted, fontSize: 10, showMinLabel: false, showMaxLabel: false, formatter: (v: number) => String(v) },
      },
      yAxis: { type: 'value', scale: true, ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10, formatter: '{value}°' } },
      series: [
        { name: 'Roční průměr', type: 'line', data: shown.map((r) => [r.year, r.tmean]), connectNulls: false, symbolSize: 3, lineStyle: { color: c.warm, width: 1.5 }, itemStyle: { color: c.warm } },
        { name: 'Trend od 1961', type: 'line', data: line, symbol: 'none', lineStyle: { color: c.text, width: 1.5, type: 'dashed' }, itemStyle: { color: c.text } },
      ],
    }
  }, [c, d])

  if (!valid.length || normal == null) return null
  // Warming stripes: barva podle odchylky od normálu (−2 … +2 °C), mezery šedě
  const stripeColor = (t: number | null) => {
    if (t == null) return 'repeating-linear-gradient(45deg, rgba(148,163,184,.35) 0 2px, transparent 2px 4px)'
    const a = Math.max(-1, Math.min(1, (t - normal) / 2))
    return a >= 0 ? `rgb(${255}, ${Math.round(245 - 210 * a)}, ${Math.round(235 - 215 * a)})` : `rgb(${Math.round(240 + 210 * a)}, ${Math.round(248 + 120 * a)}, ${255 + Math.round(20 * a)})`
  }
  return (
    <Card title="Klimatický trend" subtitle={`Roční průměrná teplota ${first}–${shown[shown.length - 1]?.year}`}>
      <div className="flex h-16 overflow-hidden rounded-xl" role="img" aria-label="Pruhy oteplování">
        {shown.map((r) => (
          <div key={r.year} className="h-full flex-1" style={{ background: stripeColor(r.tmean) }} title={`${r.year}: ${r.tmean != null ? `${num(r.tmean, 2)} °C (${signed(r.tmean - normal, 2)})` : 'bez dat'}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint">
        <span>{first}</span>
        <span>modrá = chladnější, červená = teplejší než normál {num(normal, 1)} °C</span>
        <span>{shown[shown.length - 1]?.year}</span>
      </div>
      <div className="mt-3">
        <EChart option={option} height={200} />
      </div>
      <div className="mt-2 space-y-1 text-sm">
        {trend1961 && (
          <p>
            Od roku 1961 se v Karviné otepluje o <b>{signed(trend1961.perDecade, 2, ' °C')}</b> za desetiletí ({trend1961.n} let s daty).
          </p>
        )}
        {trendAll && trendAll.from < 1961 && (
          <p className="text-muted">
            Za celé období {trendAll.from}–{trendAll.to}: {signed(trendAll.perDecade, 2, ' °C')} za desetiletí.
          </p>
        )}
        <p className="text-muted">
          Nejteplejší roky:{' '}
          {warmest.map((r, i) => (
            <span key={r.year}>
              {i ? ', ' : ''}
              <b>{r.year}</b> ({num(r.tmean, 1)} °C)
            </span>
          ))}
        </p>
      </div>
      {gaps.length > 0 && (
        <SourceNote>
          Šrafované pruhy = roky bez úplných měření ({gaps.map((g) => (g.from === g.to ? g.from : `${g.from}–${g.to}`)).join(', ')}). Rok se počítá, jen pokud má data aspoň pro 90 % dní.
          {s.source === 'chmi' ? ' Pro souvislou řadu přepněte nahoře na ERA5.' : ''}
        </SourceNote>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------ Suchá období

function DrySpells({ s, year }: { s: DailySeries; year: number }) {
  const all = useMemo(() => drySpells(s), [s])
  const thisYear = useMemo(() => drySpells(s, `${year}-01-01`, s.end), [s, year])
  const hasPrecip = (s.vars.prcp ?? []).some((v) => v != null)
  if (!hasPrecip) return null
  const current = all.find((d) => d.end === s.end)
  return (
    <Card title="Suchá období" subtitle="Nejdelší řady dní se srážkami pod 1 mm">
      {current && (
        <p className="mb-2 text-sm">
          K {fmtDate(s.end)} trvá suché období <b>{current.days} {plural(current.days, ['den', 'dny', 'dní'])}</b> (od {fmtDate(current.start)}).
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <h3 className="text-xs font-semibold text-muted uppercase">Letos</h3>
          <ol className="mt-1 space-y-1 text-sm">
            {thisYear.slice(0, 5).map((d) => (
              <li key={d.start}>
                <b className="tabular">{d.days} d</b> <span className="text-xs text-muted">{d.start.slice(8).replace(/^0/, '')}. {Number(d.start.slice(5, 7))}. – {d.end.slice(8).replace(/^0/, '')}. {Number(d.end.slice(5, 7))}.</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-muted uppercase">Rekordy</h3>
          <ol className="mt-1 space-y-1 text-sm">
            {all.slice(0, 5).map((d) => (
              <li key={d.start}>
                <b className="tabular">{d.days} d</b> <span className="text-xs text-muted">{d.start.slice(0, 4)} ({Number(d.start.slice(5, 7))}.–{Number(d.end.slice(5, 7))}. měs.)</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <SourceNote>
        Suchý den = srážky pod 1 mm (mezinárodní definice CDD). Den s chybějícím údajem suché období přeruší.{s.source === 'chmi' ? ' Denní srážky ČHMÚ se měří od 7:00 do 7:00 SEČ.' : ''} Přesný čas od posledního deště najdete na kartě „Bez deště“.
      </SourceNote>
    </Card>
  )
}

// ------------------------------------------------------------------ Vlastní srovnání

function Compare({ s, yearly, normals }: { s: DailySeries; yearly: ReturnType<typeof yearlySeries>; normals: ReturnType<typeof monthlyNormals> }) {
  const c = useChartColors()
  const years = useMemo(() => yearly.filter((r) => r.coverageT >= 0.5 || r.coverageP >= 0.5).map((r) => r.year).reverse(), [yearly])
  const thisYear = Number(s.end.slice(0, 4))
  const allYears = [thisYear, ...years.filter((y) => y !== thisYear)]
  const [a, setA] = useState(allYears[0])
  const [b, setB] = useState(allYears[1] ?? allYears[0])

  const data = useMemo(() => {
    const row = (y: number) => Array.from({ length: 12 }, (_, i) => monthStats(s, y, i + 1))
    return { a: row(a), b: row(b), ya: yearStats(s, a), yb: yearStats(s, b) }
  }, [s, a, b])

  const option: EChartsOption = useMemo(
    () => ({
      ...baseOption(c),
      grid: { left: 4, right: 4, top: 28, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
      legend: { top: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 6 },
      tooltip: { ...(baseOption(c).tooltip as object), valueFormatter: (v) => (typeof v === 'number' ? num(v, 1) : '–') },
      xAxis: { type: 'category', data: MONTHS, ...axisStyle(c) },
      yAxis: [
        { type: 'value', scale: true, ...axisStyle(c), axisLabel: { color: c.muted, fontSize: 10, formatter: '{value}°' } },
        { type: 'value', min: 0, ...axisStyle(c), splitLine: { show: false }, axisLabel: { color: c.muted, fontSize: 10, formatter: '{value}' } },
      ],
      series: [
        { name: `${a} srážky`, type: 'bar', yAxisIndex: 1, data: data.a.map((m) => m.prcp), itemStyle: { color: c.rain, opacity: 0.55 }, barGap: '10%', barMaxWidth: 8 },
        { name: `${b} srážky`, type: 'bar', yAxisIndex: 1, data: data.b.map((m) => m.prcp), itemStyle: { color: c.muted, opacity: 0.45 }, barMaxWidth: 8 },
        { name: 'Normál', type: 'line', data: normals.map((n) => n.tmean), symbol: 'none', lineStyle: { color: c.muted, type: 'dashed', width: 1.5 }, itemStyle: { color: c.muted } },
        { name: String(a), type: 'line', data: data.a.map((m) => m.tmean), symbolSize: 5, lineStyle: { color: c.warm, width: 2.5 }, itemStyle: { color: c.warm }, connectNulls: false },
        { name: String(b), type: 'line', data: data.b.map((m) => m.tmean), symbolSize: 5, lineStyle: { color: c.cold, width: 2.5 }, itemStyle: { color: c.cold }, connectNulls: false },
      ],
    }),
    [c, a, b, data, normals],
  )

  const sel = (value: number, set: (v: number) => void, label: string) => (
    <label className="flex-1 text-xs text-muted">
      {label}
      <select value={value} onChange={(e) => set(Number(e.target.value))} className="glass-strong mt-1 block w-full rounded-xl border border-[var(--glass-border)] px-2 py-1.5 text-sm text-[var(--fg)]">
        {allYears.map((y) => (
          <option key={y} value={y}>
            {y}
            {y === thisYear ? ' (letos)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
  const partial = (y: number) => y === thisYear && !s.end.endsWith('-12-31')
  const rows: [string, (st: PeriodStats) => string][] = [
    ['Průměrná teplota', (st) => temp(st.tmean, 2)],
    ['Nejvyšší teplota', (st) => temp(st.absMax)],
    ['Nejnižší teplota', (st) => temp(st.absMin)],
    ['Srážky celkem', (st) => mm(st.prcp, 0)],
    ['Tropické dny', (st) => String(st.tropicalDays)],
    ['Letní dny', (st) => String(st.summerDays)],
    ['Mrazové dny', (st) => String(st.frostDays)],
    ['Ledové dny', (st) => String(st.iceDays)],
    ['Dny se srážkami ≥ 1 mm', (st) => String(st.wetDays)],
  ]
  return (
    <Card title="Vlastní srovnání let" subtitle="Měsíční průměry teplot a úhrny srážek">
      <div className="flex gap-2">
        {sel(a, setA, 'Rok A')}
        {sel(b, setB, 'Rok B')}
      </div>
      <div className="mt-3">
        <EChart option={option} height={240} />
      </div>
      <table className="tabular mt-3 w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="text-left font-medium" />
            <th className="text-right font-medium text-[var(--warm)]">
              {a}
              {partial(a) ? '*' : ''}
            </th>
            <th className="text-right font-medium text-[var(--cold)]">
              {b}
              {partial(b) ? '*' : ''}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([l, f]) => (
            <tr key={l} className="border-t border-[var(--divider)]">
              <td className="py-1">{l}</td>
              <td className="py-1 text-right">{f(data.ya)}</td>
              <td className="py-1 text-right">{f(data.yb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SourceNote>
        {partial(a) || partial(b) ? '* Letošní rok zatím není úplný – průměr a úhrn se nezobrazí, dokud chybí víc než 10 % dní; počty dní jsou zatím průběžné. ' : ''}
        Pomlčka = v daném roce/měsíci chybí data. Měsíční úhrn srážek se počítá jen z úplných měsíců.
      </SourceNote>
    </Card>
  )
}
