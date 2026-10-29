// Barvy a společné volby grafů podle motivu

import type { EChartsOption } from 'echarts'
import { useMemo } from 'react'
import { useSettings } from '../../state/useSettings.ts'

export interface ChartColors {
  text: string
  muted: string
  grid: string
  warm: string
  cold: string
  rain: string
  accent: string
  tooltipBg: string
  tooltipBorder: string
}

export function useChartColors(): ChartColors {
  const { dark } = useSettings()
  return useMemo(
    () =>
      dark
        ? {
            text: '#f1f5f9',
            muted: 'rgba(241,245,249,0.6)',
            grid: 'rgba(255,255,255,0.08)',
            warm: '#fb923c',
            cold: '#38bdf8',
            rain: '#60a5fa',
            accent: '#60a5fa',
            tooltipBg: 'rgba(15,23,42,0.92)',
            tooltipBorder: 'rgba(255,255,255,0.12)',
          }
        : {
            text: '#0f172a',
            muted: 'rgba(15,23,42,0.6)',
            grid: 'rgba(15,23,42,0.08)',
            warm: '#ea580c',
            cold: '#0284c7',
            rain: '#2563eb',
            accent: '#2563eb',
            tooltipBg: 'rgba(255,255,255,0.96)',
            tooltipBorder: 'rgba(15,23,42,0.1)',
          },
    [dark],
  )
}

/** Společné výchozí nastavení os, tooltipu a písma */
export function baseOption(c: ChartColors): EChartsOption {
  return {
    animationDuration: 500,
    textStyle: { fontFamily: 'Inter Variable, system-ui, sans-serif', color: c.text },
    grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.text, fontSize: 12 },
      axisPointer: { lineStyle: { color: c.muted } },
    },
  }
}

export function axisStyle(c: ChartColors) {
  return {
    axisLine: { lineStyle: { color: c.grid } },
    axisTick: { show: false },
    axisLabel: { color: c.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: c.grid } },
  }
}
