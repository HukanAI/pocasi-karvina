// Karta „Bez deště“: živé počítadlo od konce posledního deště (měřeno ČHMÚ, doplněno modelem)

import { CHMI_STATION } from '../../config.ts'
import { mm, num } from '../../lib/format.ts'
import { DAY, formatAgo, formatDuration, formatMoment, formatTime, HOUR, MINUTE } from '../../lib/time.ts'
import { useNow, useRain } from '../../state/derived.ts'
import { Card, LoadingCard, SourceNote } from '../ui.tsx'
import { WeatherIcon } from '../WeatherIcon.tsx'

function Big({ ms }: { ms: number }) {
  const d = Math.floor(ms / DAY)
  const h = Math.floor((ms % DAY) / HOUR)
  const m = Math.floor((ms % HOUR) / MINUTE)
  const s = Math.floor((ms % MINUTE) / 1000)
  const unit = (v: number, u: string) => (
    <span className="mr-2 inline-flex items-baseline">
      <span className="tabular text-4xl font-semibold tracking-tight">{v}</span>
      <span className="ml-0.5 text-base text-muted">{u}</span>
    </span>
  )
  return (
    <div className="flex flex-wrap items-baseline" aria-label={formatDuration(ms)}>
      {d > 0 && unit(d, 'd')}
      {unit(h, 'h')}
      {unit(m, 'min')}
      <span className="tabular w-8 text-base text-faint">{String(s).padStart(2, '0')} s</span>
    </div>
  )
}

const srcLabel = (src: 'station' | 'model') => (src === 'station' ? `měřeno ČHMÚ ${CHMI_STATION.name}` : 'odhad modelu (měření za tuto dobu ještě není zveřejněno)')

export function RainCard() {
  // Stav deště (tisíce vzorků) stačí přepočítat jednou za minutu; sekundy tiká jen zobrazení
  const now = useNow(1000)
  const rain = useRain(useNow(60_000))
  if (rain.isLoading && rain.state.kind === 'unknown') return <LoadingCard title="Bez deště" lines={2} />
  const { state, next, expectedEnd } = rain
  const thresholdNote = rain.minTotal > 0.1 ? ` Počítají se jen deště s úhrnem aspoň ${num(rain.minTotal, 1)} mm (lze změnit v nastavení).` : ''

  if (state.kind === 'raining') {
    return (
      <Card title="Právě prší" action={<WeatherIcon name="raindrops" size={36} />}>
        <p className="text-sm text-muted">Prší už</p>
        <Big ms={now - state.since} />
        <p className="mt-1 text-sm">
          od {formatMoment(state.since, now)} · zatím <b>{mm(state.total)}</b>
        </p>
        {expectedEnd != null && (
          <p className="mt-1 text-sm text-muted">
            {expectedEnd <= now + 15 * MINUTE ? 'Podle modelu by měl déšť brzy ustat.' : `Podle modelu skončí kolem ${formatTime(expectedEnd)}${expectedEnd - now > DAY ? ` (${formatMoment(expectedEnd, now)})` : ''}.`}
          </p>
        )}
        <SourceNote>
          {state.startSrc === state.src
            ? `Zdroj: ${srcLabel(state.src)}.`
            : `Začátek deště: ${srcLabel(state.startSrc)}. Že stále prší: ${srcLabel(state.src)}.`}
          {rain.lastStationT ? ` Poslední měření ČHMÚ ${formatAgo(rain.lastStationT, now)}.` : ''}
          {thresholdNote}
        </SourceNote>
      </Card>
    )
  }

  if (state.kind === 'unknown') {
    return (
      <Card title="Bez deště">
        <p className="text-sm">
          {state.coveredFrom != null
            ? `V dostupných datech (od ${formatMoment(state.coveredFrom, now)}) nepršelo.`
            : 'Data o srážkách zatím nejsou k dispozici.'}
        </p>
        {next && <NextRain next={next} now={now} />}
      </Card>
    )
  }

  const ev = state.lastEvent
  return (
    <Card title="Bez deště" action={<WeatherIcon name="umbrella" size={36} />}>
      <Big ms={now - state.since} />
      <p className="mt-1 text-sm">
        Naposledy pršelo <b>{formatMoment(state.since, now)}</b>
      </p>
      <p className="text-xs text-muted">
        Déšť trval {formatDuration(ev.end - ev.start)} a spadlo {mm(ev.total)}
        {ev.peakRate >= 1 ? ` (nejvíc ${num(ev.peakRate, 1)} mm/h)` : ''}.
      </p>
      {state.drizzleNow && <p className="mt-1 text-xs text-muted">Právě slabě mrholí, ale zatím pod nastaveným prahem.</p>}
      {next ? <NextRain next={next} now={now} /> : <p className="mt-2 text-sm text-muted">V příštích 16 dnech se déšť podle modelu nečeká.</p>}
      {state.missingMs > HOUR && <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">Pozor: od posledního deště chybí {formatDuration(state.missingMs)} měření.</p>}
      <SourceNote>
        Konec deště: {srcLabel(ev.endSrc)}
        {rain.lastStationT ? `, poslední měření ${formatAgo(rain.lastStationT, now)}` : ''}. Déšť = srážka ≥ 0,1 mm, přestávky do 30 min se slučují.
        {thresholdNote}
      </SourceNote>
    </Card>
  )
}

function NextRain({ next, now }: { next: { at: number; mm: number; prob: number | null }; now: number }) {
  const soon = next.at - now < 2 * HOUR
  // Za více než 2 dny je přesný čas jen odhad – stačí den
  if (next.at - now > 2 * DAY) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-black/5 px-3 py-2 text-sm dark:bg-white/5">
        <WeatherIcon name="raindrop" size={26} />
        <div>
          <div>
            Další déšť nejdříve <b>{formatMoment(next.at, now).replace(/ v \d{2}:\d{2}$/, '')}</b>
          </div>
          {next.prob != null && <div className="text-xs text-muted">pravděpodobnost {num(next.prob, 0)} % · výhled na více dní je nejistý</div>}
        </div>
      </div>
    )
  }
  return (
    <div className="mt-3 flex items-center gap-2 rounded-2xl bg-black/5 px-3 py-2 text-sm dark:bg-white/5">
      <WeatherIcon name="raindrop" size={26} />
      <div>
        <div>
          Další déšť: <b>{soon ? `za ${formatDuration(Math.max(0, next.at - now))}` : formatMoment(next.at, now)}</b>
        </div>
        <div className="text-xs text-muted">
          {soon ? `kolem ${formatTime(next.at)}` : `za ${formatDuration(next.at - now)}`}
          {next.prob != null ? ` · pravděpodobnost ${num(next.prob, 0)} %` : ''}
        </div>
      </div>
    </div>
  )
}
