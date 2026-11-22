// Naměřené hodnoty ze stanice ČHMÚ Karviná + graf posledních 24 h, který pokračuje předpovědí na 24 h

import { CHMI_STATION } from '../../config.ts'
import { kmh, mm, ms2kmh, num, pct, temp, windDir } from '../../lib/format.ts'
import { buildTimeline } from '../../lib/stationTimeline.ts'
import { formatAgo, formatTime } from '../../lib/time.ts'
import { STATION_FRESH_MS, useNow } from '../../state/derived.ts'
import { useForecast, useStationNow } from '../../state/queries.ts'
import { useChartColors } from '../charts/chartTheme.ts'
import { Card, ErrorCard, LoadingCard, SourceNote, Stat } from '../ui.tsx'
import { TimelineChart } from './TimelineChart.tsx'

export function StationCard() {
  const now = useNow(60_000)
  const q = useStationNow()
  const f = useForecast()
  const c = useChartColors()
  if (q.isError && !q.data) return <ErrorCard title={`Naměřeno · ČHMÚ ${CHMI_STATION.name}`} error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <LoadingCard title={`Naměřeno · ČHMÚ ${CHMI_STATION.name}`} />
  const { last, today, series } = q.data
  if (!last) return null
  const old = now - last.t > STATION_FRESH_MS

  const tl = buildTimeline(series, f.data?.hourly, now)

  return (
    <Card
      title={`Naměřeno · ČHMÚ ${CHMI_STATION.name}`}
      subtitle={`${formatTime(last.t)} (${formatAgo(last.t, now)}) · ${CHMI_STATION.elevation} m n. m.`}
    >
      {old && <p className="mb-2 rounded-xl bg-amber-500/15 px-3 py-1.5 text-xs">Poslední měření je starší než {STATION_FRESH_MS / 60_000} minut – ČHMÚ nebo automatická aktualizace mají zpoždění.</p>}
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
      <h3 className="mt-4 mb-1 text-xs font-semibold text-muted">Posledních 24 h a předpověď na 24 h</h3>
      <TimelineChart tl={tl} c={c} />
      <SourceNote>
        Data: ČHMÚ, opendata.chmi.cz (stanice {CHMI_STATION.wsi}). Měření se zveřejňují jednou za hodinu, poslední hodnoty jsou nezkontrolované. „Dnes“ = od místní půlnoci.
        Předpověď: Open-Meteo (stejná jako v hodinové předpovědi); teplota je prvních 6 h posunutá tak, aby navazovala na poslední měření.
      </SourceNote>
    </Card>
  )
}
