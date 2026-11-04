// Kontrola upozornění a odeslání přes ntfy.sh (spouští GitHub Actions každých 10 minut)
//
// Spuštění:
//   NTFY_TOPIC=karvina-xyz node scripts/check-alerts.ts            běžná kontrola
//   node scripts/check-alerts.ts --dry-run                          jen vypíše, nic neodešle ani neuloží
//   NTFY_TOPIC=… node scripts/check-alerts.ts --test                pošle zkušební zprávu
//   NTFY_TOPIC=… node scripts/check-alerts.ts --summary-now         pošle ranní souhrn hned (test)

import { readFileSync } from 'node:fs'
import { fetchAir, fetchForecast } from '../src/api/openMeteo.ts'
import { ALERT_RULES, API, GITHUB, LOCATION } from '../src/config.ts'
import {
  type Alert,
  type AlertState,
  evaluateAlerts,
  isSummaryTime,
  lastSentAt,
  morningSummary,
  newAlerts,
  type RadarPoint,
  rainSoonAlert,
  recordSent,
} from '../src/lib/alerts.ts'
import type { StationNow, StationSra10, WarningsFile } from '../src/lib/dataTypes.ts'
import { type FrameData, type GeoBounds, maxDbzNear, type RadarIndex } from '../src/lib/radarData.ts'
import { buildRainEvents, nowcastQuarters, type PrecipSample } from '../src/lib/rain.ts'
import { formatDuration, formatMoment, formatTime, localDateKey, localMidnight, MINUTE } from '../src/lib/time.ts'
import { dataPath, log, readJson, touchMeta, writeJson } from './lib/io.ts'
import { decodePng } from './lib/png.ts'

const APP_URL = `https://${GITHUB.owner.toLowerCase()}.github.io/${GITHUB.repo}/`

async function send(topic: string, a: Alert): Promise<void> {
  const res = await fetch(API.ntfy, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // JSON publikace: hlavičky HTTP neumí češtinu, tělo JSON ano
    body: JSON.stringify({ topic, title: a.title, message: a.message, priority: a.priority, tags: a.tags, click: APP_URL }),
  })
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}: ${await res.text()}`)
}

/** Řádek o posledním dešti pro ranní souhrn (z měření ČHMÚ) */
function rainLine(now: number): string | null {
  const sra = readJson<StationSra10>('station-sra10.json')
  if (!sra) return null
  const samples: PrecipSample[] = []
  sra.values.forEach((mm, i) => mm != null && samples.push({ t: sra.start + i * sra.step, dur: sra.step, mm, src: 'station' }))
  const last = buildRainEvents(samples).at(-1)
  if (!last) return null
  return `Naposledy pršelo ${formatMoment(last.end, now)} (před ${formatDuration(now - last.end).replace(/ \d+ min$/, '')}).`
}

/** Radar a nowcasting ČHMÚ kolem Karviné (snímky stáhl update-radar.ts v tomtéž běhu do data větve) */
function radarAround(): { obsHere: RadarPoint[]; obsNearby: number | null; nowcastHere: RadarPoint[] } {
  const S = ALERT_RULES.rainSoon
  const idx = readJson<RadarIndex>('radar/index.json')
  const frame = (file: string): FrameData | null => {
    try {
      const png = decodePng(readFileSync(dataPath(file)))
      return { width: png.width, height: png.height, values: png.pixels }
    } catch {
      return null
    }
  }
  const near = (f: FrameData, b: GeoBounds, km: number) => maxDbzNear(f, b, LOCATION.latitude, LOCATION.longitude, km)
  const obsHere: RadarPoint[] = []
  let obsNearby: number | null = null
  const obs = [...(idx?.obs?.frames ?? [])].sort((a, b) => a.t - b.t)
  obs.forEach((r, k) => {
    const f = frame(r.file)
    if (!f) return
    obsHere.push({ t: r.t, dbz: near(f, idx!.obs!.bounds, S.radiusKm) })
    if (k === obs.length - 1) obsNearby = near(f, idx!.obs!.bounds, S.confirmKm)
  })
  const nowcastHere: RadarPoint[] = []
  for (const r of idx?.nowcast?.frames ?? []) {
    const f = frame(r.file)
    if (f) nowcastHere.push({ t: r.t, dbz: near(f, idx!.nowcast!.bounds, S.radiusKm) })
  }
  return { obsHere, obsNearby, nowcastHere }
}

async function main() {
  const dry = process.argv.includes('--dry-run')
  const topic = process.env.NTFY_TOPIC?.trim()
  if (!dry && !topic) throw new Error('Chybí NTFY_TOPIC (GitHub Secret). Pro zkoušku použijte --dry-run.')
  const now = Date.now()

  if (process.argv.includes('--test')) {
    await send(topic!, { key: 'test', title: 'Počasí Karviná – zkouška', message: 'Upozornění fungují. ✔', priority: 3, tags: ['white_check_mark'] })
    log('Zkušební zpráva odeslána')
    return
  }

  const [forecast, air] = await Promise.all([fetchForecast(), fetchAir().catch((e) => (log('Ovzduší nedostupné:', e.message), null))])
  const warnings = readJson<WarningsFile>('warnings.json')?.items ?? []
  const input = { now, forecast, air, warnings }

  const alerts = evaluateAlerts(input)
  const state = readJson<AlertState>('alerts-state.json') ?? { sent: {} }

  // Brzy začne pršet (radar ČHMÚ + model ICON-D2 po 15 min)
  const radar = radarAround()
  const st = readJson<StationNow>('station-now.json')
  const stationT = st?.last && now - st.last.t < 2 * 3_600_000 ? st.last.T : null
  const rainSoon = rainSoonAlert({
    now,
    ...radar,
    quarters: nowcastQuarters(forecast.minutely15.time, forecast.minutely15.precipitation, now),
    tempC: stationT ?? forecast.current.temperature_2m,
    lastSentAt: lastSentAt(state, 'rainsoon:'),
  })
  const fmt = (p: RadarPoint) => `${formatTime(p.t)}=${p.dbz ?? '–'}`
  log(
    `Radar u Karviné (dBZ do ${ALERT_RULES.rainSoon.radiusKm} km): ${radar.obsHere.slice(-4).map(fmt).join(' ')}` +
      ` | do ${ALERT_RULES.rainSoon.confirmKm} km: ${radar.obsNearby ?? '–'} | nowcasting: ${radar.nowcastHere.map(fmt).join(' ') || 'žádný'}`,
  )
  if (radar.obsHere.length && now - radar.obsHere.at(-1)!.t > ALERT_RULES.rainSoon.maxRadarAgeMinutes * MINUTE) log('Radar je starý – „brzy začne pršet“ se nevyhodnocuje')
  if (rainSoon) alerts.push(rainSoon)
  if (isSummaryTime(now) || process.argv.includes('--summary-now')) {
    // Noční minimum: naměřené od 18:00 včerejška do teď
    let nightMin: number | null = null
    if (st?.series) {
      const from = localMidnight(localDateKey(now)) - 6 * 3_600_000
      st.series.T.forEach((v, i) => {
        const t = st.series.start + i * st.series.step
        if (v != null && t >= from && t <= now && (nightMin == null || v < nightMin)) nightMin = v
      })
    }
    const summary = morningSummary(input, { stationNightMin: nightMin, rainLine: rainLine(now) })
    if (summary) alerts.push(summary)
  }

  const fresh = newAlerts(alerts, state)
  log(`Pravidla: ${alerts.length} upozornění, nových: ${fresh.length}`)
  for (const a of alerts) log(fresh.includes(a) ? ' NOVÉ ' : ' (již odesláno)', a.key, '|', a.title, '|', a.message.replace(/\n/g, ' / '))
  if (dry) return

  const sentKeys: string[] = []
  for (const a of fresh) {
    try {
      await send(topic!, a)
      sentKeys.push(a.key)
    } catch (e) {
      // Neodeslané upozornění se zkusí znovu při dalším běhu
      console.error('Odeslání selhalo:', a.key, e)
    }
  }
  writeJson('alerts-state.json', recordSent(state, sentKeys, now))
  touchMeta('alerts')
  log('Odesláno:', sentKeys.length)
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
