// Srážky po dnech za zvolený měsíc (stanice ČHMÚ Karviná) s přepínáním měsíců a let.
// Aktuální měsíc se průběžně doplňuje: denní úhrny ČHMÚ + dny, které ještě nevyšly, z 10min měření.

import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { CHMI_STATION, NORMAL_PERIOD } from '../../config.ts'
import type { DailySeries } from '../../lib/climate.ts'
import type { RegularSeries } from '../../lib/dataTypes.ts'
import { mm, num, plural } from '../../lib/format.ts'
import { firstPrecipMonth, monthPrecip, type PrecipDay } from '../../lib/monthPrecip.ts'
import { formatTime, formatWeekdayShort, localMidnight, localParts } from '../../lib/time.ts'
import { useNow } from '../../state/derived.ts'
import { useStationDaily, useStationSra } from '../../state/queries.ts'
import { axisStyle, baseOption, useChartColors } from '../charts/chartTheme.ts'
import { EChart } from '../charts/EChart.tsx'
import { Card, ErrorCard, LoadingCard, SourceNote } from '../ui.tsx'

const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']

interface Ym {
  year: number
  month: number
}
const ymIndex = (x: Ym) => x.year * 12 + x.month - 1
const fromIndex = (i: number): Ym => ({ year: Math.floor(i / 12), month: (i % 12) + 1 })

export function MonthPrecipCard() {
  const daily = useStationDaily(true)
  const sra = useStationSra()
  if (daily.isError && !daily.data) return <ErrorCard title="Srážky po dnech" error={daily.error} onRetry={() => daily.refetch()} />
  if (!daily.data) return <LoadingCard title="Srážky po dnech" lines={5} />
  return <MonthPrecipContent s={daily.data} sra={sra.data ?? null} />
}

function MonthPrecipContent({ s, sra }: { s: DailySeries; sra: RegularSeries | null }) {
  const c = useChartColors()
  // Obnova po 5 min: rozpracovaný den a přelom měsíce sednou i bez nového načtení dat
  // (10min měření se znovu stahují každých 15 min, denní úhrny ČHMÚ při návratu do aplikace)
  const now = useNow(5 * 60_000)
  const p = localParts(now)
  const current: Ym = { year: p.year, month: p.month }
  const first = useMemo(() => firstPrecipMonth(s) ?? { year: Number(s.start.slice(0, 4)), month: 1 }, [s])
  // null = vždy aktuální měsíc (po přelomu měsíce se sám posune)
  const [picked, setPicked] = useState<Ym | null>(null)
  const sel = picked ?? current
  const minI = ymIndex(first)
  const maxI = ymIndex(current)
  const selI = Math.min(maxI, Math.max(minI, ymIndex(sel)))
  const go = (i: number) => setPicked(i >= maxI ? null : fromIndex(Math.max(minI, i)))
  const { year, month } = fromIndex(selI)
  const isCurrent = selI === maxI

  // Starší měsíce už jsou uzavřené – pevný čas, aby se graf (a otevřený tooltip) zbytečně nepřekresloval.
  // Minulý měsíc se počítá s živým časem: jeho poslední srážkový den končí až 1. v 7:00 SEČ.
  const calcNow = selI >= maxI - 1 ? now : Date.UTC(current.year, current.month - 1, 1)
  const data = useMemo(() => monthPrecip(s, sra, year, month, calcNow), [s, sra, year, month, calcNow])

  const option: EChartsOption = useMemo(() => {
    const { days, cumulative, normalCumulative } = data
    const bar = (d: PrecipDay) => ({
      value: d.mm,
      itemStyle: { color: c.rain, opacity: d.status === 'partial' ? 0.45 : 0.9, borderRadius: [3, 3, 0, 0] },
    })
    const maxMm = Math.max(0, ...days.map((d) => d.mm ?? 0))
    return {
      ...baseOption(c),
      grid: { left: 4, right: 4, top: 46, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
      legend: {
        top: 0,
        textStyle: { color: c.muted, fontSize: 11 },
        itemWidth: 12,
        itemHeight: 6,
        // Šedé dny bez měření vysvětluje text nad grafem; čtvrtá položka by se na mobilu zalomila
        data: ['Denní úhrn', 'Součet od 1.', 'Normál'],
      },
      tooltip: {
        ...(baseOption(c).tooltip as object),
        axisPointer: { type: 'shadow' },
        formatter: (ps: unknown) => {
          const i = (ps as { dataIndex: number }[])[0]?.dataIndex
          const d = days[i]
          if (!d) return ''
          const date = localMidnight(d.date) + 12 * 3_600_000
          const head = `<b>${formatWeekdayShort(date)} ${d.day}. ${month}. ${year}</b>`
          const status =
            d.status === 'future'
              ? 'zatím bez dat'
              : d.status === 'missing'
                ? 'chybí měření'
                : d.status === 'partial'
                  ? `zatím (do ${formatTime(d.until!)})`
                  : d.status === 'prelim'
                    ? 'předběžně z 10min měření'
                    : ''
          const gap = d.gapMinutes ? `<br/><span style="opacity:.7">chybí ${d.gapMinutes} min měření</span>` : ''
          const lines = [head]
          if (d.mm != null) lines.push(`Srážky <b>${mm(d.mm)}</b>${status ? ` · ${status}` : ''}`)
          else lines.push(status)
          if (cumulative[i] != null) lines.push(`Od 1. ${month}.: ${mm(cumulative[i])}`)
          if (normalCumulative[i] != null) lines.push(`Normál do tohoto dne: ${mm(normalCumulative[i])}`)
          return lines.join('<br/>') + gap
        },
      },
      xAxis: {
        type: 'category',
        data: days.map((d) => String(d.day)),
        ...axisStyle(c),
        axisLabel: { color: c.muted, fontSize: 10, interval: (i: number) => i === 0 || (i + 1) % 5 === 0 },
      },
      yAxis: [
        {
          type: 'value',
          min: 0,
          // Bez srážek by osa neměla měřítko – aspoň 0–2 mm
          max: maxMm < 2 ? 2 : undefined,
          name: 'mm za den',
          nameGap: 8,
          nameTextStyle: { color: c.muted, fontSize: 10, align: 'left' },
          ...axisStyle(c),
          axisLabel: { color: c.muted, fontSize: 10, formatter: (v: number) => num(v, v % 1 ? 1 : 0) },
        },
        {
          type: 'value',
          min: 0,
          ...axisStyle(c),
          splitLine: { show: false },
          name: 'součet mm',
          nameGap: 8,
          nameTextStyle: { color: c.muted, fontSize: 10, align: 'right' },
          axisLabel: { color: c.muted, fontSize: 10, formatter: (v: number) => num(v, 0) },
        },
        // Pomocná skrytá osa pro šedé pozadí dní bez měření (vždy přes celou výšku)
        { type: 'value', min: 0, max: 1, show: false },
      ],
      series: [
        {
          name: 'Denní úhrn',
          type: 'bar',
          data: days.map(bar),
          barMaxWidth: 14,
          barCategoryGap: '25%',
          label: {
            show: true,
            position: 'top',
            fontSize: 9,
            color: c.muted,
            formatter: (x: { value: unknown }) => (typeof x.value === 'number' && x.value >= 1 ? num(x.value, x.value >= 10 ? 0 : 1) : ''),
          },
          labelLayout: { hideOverlap: true },
        },
        {
          name: 'Bez měření',
          type: 'bar',
          yAxisIndex: 2,
          // Překrývá sloupec stejného dne (barGap −100 %) a sahá přes celou výšku grafu
          barGap: '-100%',
          barMaxWidth: 14,
          silent: true,
          z: 0,
          data: days.map((d) => (d.status === 'missing' ? 1 : null)),
          itemStyle: { color: c.muted, opacity: 0.18 },
          tooltip: { show: false },
        },
        {
          name: 'Součet od 1.',
          type: 'line',
          yAxisIndex: 1,
          data: cumulative,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color: c.text, width: 1.5, opacity: 0.75 },
          itemStyle: { color: c.text },
        },
        {
          name: 'Normál',
          type: 'line',
          yAxisIndex: 1,
          data: normalCumulative,
          showSymbol: false,
          lineStyle: { color: c.muted, width: 1.5, type: 'dashed' },
          itemStyle: { color: c.muted },
        },
      ],
    }
  }, [c, data, month, year])

  const years = Array.from({ length: current.year - first.year + 1 }, (_, i) => current.year - i)
  const selectCls = 'glass-strong rounded-xl border border-[var(--glass-border)] px-2 py-1.5 text-sm text-[var(--fg)]'
  const arrowCls = 'grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg font-semibold text-[var(--accent)] active:scale-95 disabled:opacity-30'
  const pctOf = (a: number, b: number | null) => (b && b > 0 ? Math.round((a / b) * 100) : null)
  const lastDay = data.lastIndex >= 0 ? data.days[data.lastIndex] : null
  const toDatePct = pctOf(data.total, isCurrent ? data.normalToDate : data.normalTotal)
  const hasEstimate = data.days.some((d) => d.status === 'prelim' || d.status === 'partial')

  return (
    <Card title="Srážky po dnech" subtitle={`Měření ČHMÚ ${CHMI_STATION.name} · klepněte na sloupec`}>
      <div className="flex items-center gap-2">
        <button type="button" className={arrowCls} onClick={() => go(selI - 1)} disabled={selI <= minI} aria-label="Předchozí měsíc">
          ‹
        </button>
        <select
          aria-label="Měsíc"
          className={`${selectCls} min-w-0 flex-1`}
          value={month}
          onChange={(e) => go(year * 12 + Number(e.target.value) - 1)}
        >
          {MONTHS.map((name, i) => {
            const idx = year * 12 + i
            return (
              <option key={name} value={i + 1} disabled={idx < minI || idx > maxI}>
                {name}
              </option>
            )
          })}
        </select>
        <select
          aria-label="Rok"
          className={`${selectCls} w-[5.5rem]`}
          value={year}
          onChange={(e) => go(Math.min(maxI, Math.max(minI, Number(e.target.value) * 12 + month - 1)))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button type="button" className={arrowCls} onClick={() => go(selI + 1)} disabled={selI >= maxI} aria-label="Další měsíc">
          ›
        </button>
      </div>
      {!isCurrent && (
        <button type="button" onClick={() => setPicked(null)} className="mt-1 text-xs font-medium text-[var(--accent)]">
          Zpět na aktuální měsíc
        </button>
      )}

      {data.lastIndex < 0 ? (
        <p className="mt-3 text-sm text-muted">První srážkový den měsíce začíná v 7:00 SEČ.</p>
      ) : data.knownDays === 0 ? (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Pro tento měsíc nejsou data ze stanice.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span>
              {isCurrent ? 'Zatím spadlo' : 'Spadlo'} <b className="tabular text-base">{mm(data.total)}</b>
            </span>
            {/* Procento normálu jen bez chybějících dní – jinak by klamalo */}
            {data.missingDays === 0 && toDatePct != null && (
              <span className="text-muted">
                {toDatePct} % normálu{isCurrent && lastDay ? ` do ${lastDay.day}. ${month}.` : ''} ({mm(isCurrent ? data.normalToDate : data.normalTotal, 0)})
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {data.wetDays} {plural(data.wetDays, ['den', 'dny', 'dní'])} se srážkami ≥ 1 mm
            {data.max ? ` · nejvíc ${mm(data.max.mm)} (${data.max.day}. ${month}.)` : ' · bez srážek'}
            {data.normalTotal != null && (isCurrent || data.missingDays > 0) ? ` · normál měsíce ${mm(data.normalTotal, 0)}` : ''}
          </p>
          {data.missingDays > 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              Změřeno jen {data.knownDays} z {data.lastIndex + 1} dní, {data.missingDays} {plural(data.missingDays, ['den', 'dny', 'dní'])} bez měření (šedě) – skutečný
              úhrn může být vyšší.
            </p>
          )}
        </>
      )}

      <div className="mt-2">
        <EChart option={option} height={230} />
      </div>
      <SourceNote>
        Den = 7:00–7:00 SEČ (8:00–8:00 v letním čase), jak srážky měří ČHMÚ – déšť v noci se počítá k předchozímu dni. Normál = průměr {NORMAL_PERIOD.from}–
        {NORMAL_PERIOD.to}.
        {hasEstimate
          ? ' Dny, které ČHMÚ ještě nezveřejnilo, jsou sečtené z 10min měření stanice a doplňují se průběžně; poloprůhledný sloupec = den ještě běží.'
          : ''}
      </SourceNote>
    </Card>
  )
}
