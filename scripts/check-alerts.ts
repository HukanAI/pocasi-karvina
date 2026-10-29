// Kontrola upozornění a odeslání přes ntfy.sh (spouští GitHub Actions každou hodinu)
//
// Spuštění:
//   NTFY_TOPIC=karvina-xyz node scripts/check-alerts.ts            běžná kontrola
//   node scripts/check-alerts.ts --dry-run                          jen vypíše, nic neodešle ani neuloží
//   NTFY_TOPIC=… node scripts/check-alerts.ts --test                pošle zkušební zprávu
//   NTFY_TOPIC=… node scripts/check-alerts.ts --summary-now         pošle ranní souhrn hned (test)

import { fetchAir, fetchForecast } from '../src/api/openMeteo.ts'
import { API, GITHUB } from '../src/config.ts'
import { type Alert, type AlertState, evaluateAlerts, isSummaryTime, morningSummary, newAlerts, recordSent } from '../src/lib/alerts.ts'
import type { StationNow, StationSra10, WarningsFile } from '../src/lib/dataTypes.ts'
import { buildRainEvents, type PrecipSample } from '../src/lib/rain.ts'
import { formatDuration, formatMoment, localDateKey, localMidnight } from '../src/lib/time.ts'
import { log, readJson, touchMeta, writeJson } from './lib/io.ts'

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
  if (isSummaryTime(now) || process.argv.includes('--summary-now')) {
    const st = readJson<StationNow>('station-now.json')
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

  const state = readJson<AlertState>('alerts-state.json') ?? { sent: {} }
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
