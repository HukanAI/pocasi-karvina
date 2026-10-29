// Výstrahy ČHMÚ (přes MeteoAlarm) pro ORP Karviná → warnings.json
// MeteoAlarm neposílá CORS hlavičky, proto je aplikace nemůže číst přímo.
//
// Spuštění: node scripts/fetch-warnings.ts

import { API, WARNING_AREA } from '../src/config.ts'
import type { WarningItem, WarningsFile } from '../src/lib/dataTypes.ts'
import { fetchJson, log, touchMeta, writeJson } from './lib/io.ts'

interface CapArea {
  areaDesc: string
  geocode?: { value: string; valueName: string }[]
}
interface CapInfo {
  language: string
  event: string
  severity: string
  certainty: string
  onset?: string
  effective?: string
  expires: string
  description?: string
  instruction?: string
  area?: CapArea[]
  parameter?: { valueName: string; value: string }[]
}
interface CapAlert {
  identifier: string
  sent: string
  msgType: string
  info: CapInfo[]
}
export interface MeteoalarmFeed {
  warnings: { alert: CapAlert; uuid?: string }[]
}

const LEVELS: Record<string, WarningItem['level']> = { yellow: 'yellow', orange: 'orange', red: 'red' }

export function areaMatches(a: CapArea): boolean {
  if (a.geocode?.some((g) => g.value === WARNING_AREA.emmaId || (g.valueName === 'CISORP' && g.value === WARNING_AREA.cisorp))) return true
  return WARNING_AREA.nameMatch.test(a.areaDesc)
}

/** Vybere platné výstrahy pro Karvinou v češtině, seřazené podle začátku */
export function extractWarnings(feed: MeteoalarmFeed, now: number): WarningItem[] {
  const out: WarningItem[] = []
  for (const { alert } of feed.warnings ?? []) {
    if (alert.msgType === 'Cancel') continue
    const info = alert.info.find((i) => i.language?.startsWith('cs')) ?? alert.info[0]
    if (!info) continue
    const area = info.area?.find(areaMatches)
    if (!area) continue
    if (Date.parse(info.expires) <= now) continue
    const levelParam = info.parameter?.find((p) => p.valueName === 'awareness_level')?.value ?? ''
    const levelName = levelParam.split(';')[1]?.trim().toLowerCase() ?? ''
    out.push({
      id: alert.identifier,
      event: info.event,
      severity: info.severity,
      level: LEVELS[levelName] ?? (info.severity === 'Extreme' ? 'red' : info.severity === 'Severe' ? 'orange' : info.severity === 'Moderate' ? 'yellow' : 'unknown'),
      certainty: info.certainty,
      onset: info.onset ?? info.effective ?? alert.sent,
      expires: info.expires,
      description: info.description ?? '',
      instruction: info.instruction ?? '',
      area: area.areaDesc,
      sent: alert.sent,
    })
  }
  return out.sort((a, b) => a.onset.localeCompare(b.onset))
}

async function main() {
  const feed = await fetchJson<MeteoalarmFeed>(API.meteoalarm)
  const items = extractWarnings(feed, Date.now())
  const file: WarningsFile = { updated: new Date().toISOString(), items }
  writeJson('warnings.json', file)
  log('warnings.json: celkem ve feedu', feed.warnings?.length ?? 0, '| pro Karvinou', items.length)
  for (const w of items) log(' -', w.level, w.event, w.onset, '→', w.expires)
  touchMeta('warnings')
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
