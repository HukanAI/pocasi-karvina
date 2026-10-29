// Graf se načítá líně: knihovna ECharts (~1 MB) se stáhne až s prvním grafem na obrazovce

import type { EChartsOption } from 'echarts'
import { lazy, Suspense } from 'react'
import { Skeleton } from '../ui.tsx'

const EChartImpl = lazy(() => import('./EChartImpl.tsx'))

export function EChart(props: { option: EChartsOption; height?: number; className?: string }) {
  return (
    <Suspense fallback={<div style={{ height: props.height ?? 220 }}><Skeleton className="h-full w-full" /></div>}>
      <EChartImpl {...props} />
    </Suspense>
  )
}
