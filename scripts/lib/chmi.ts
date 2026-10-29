// Čtení otevřených dat ČHMÚ (opendata.chmi.cz/meteorology/climate)
//
// Formát: { data: { data: { header: "STATION,ELEMENT,[VTYPE,]DT,VAL,FLAG,QUALITY", values: [[...], ...] } } }
// Časy jsou v UTC. Kvalita (QUALITY): 0 kvalitní, 1 podezřelá, 2 nízká kvalita – nepoužívat,
// 3 odhad, 4 chybí, 5 neznámá (čerstvá nezkontrolovaná data).

import { API, CHMI_STATION } from '../../src/config.ts'
import { fetchWithRetry } from './io.ts'

export interface ChmiRow {
  element: string
  vtype: string | null
  /** Čas měření v ms UTC */
  t: number
  /** Datum 'YYYY-MM-DD' z DT (pro denní data) */
  date: string
  value: number | null
  flag: string
  quality: number | null
}

interface ChmiFile {
  data: { data: { header: string; values: unknown[][] } }
}

/** Hodnoty s kvalitou 2 (nepoužívat) a 4 (chybí) se zahodí */
export const UNUSABLE_QUALITY = new Set([2, 4])

export function parseChmi(json: ChmiFile): ChmiRow[] {
  const { header, values } = json.data.data
  const h = header.split(',')
  const iEl = h.indexOf('ELEMENT')
  const iVt = h.indexOf('VTYPE')
  const iDt = h.indexOf('DT')
  const iVal = h.indexOf('VAL')
  const iFlag = h.indexOf('FLAG')
  const iQ = h.indexOf('QUALITY')
  if (iEl < 0 || iDt < 0 || iVal < 0) throw new Error(`Neočekávaná hlavička ČHMÚ: ${header}`)
  const rows: ChmiRow[] = []
  for (const r of values) {
    const dt = String(r[iDt])
    const raw = r[iVal]
    const q = iQ >= 0 && r[iQ] !== '' && r[iQ] != null ? Number(r[iQ]) : null
    const num = raw === '' || raw == null ? null : Number(raw)
    rows.push({
      element: String(r[iEl]),
      vtype: iVt >= 0 ? String(r[iVt]) : null,
      t: Date.parse(dt),
      date: dt.slice(0, 10),
      value: num != null && Number.isFinite(num) && !(q != null && UNUSABLE_QUALITY.has(q)) ? num : null,
      flag: iFlag >= 0 && r[iFlag] != null ? String(r[iFlag]) : '',
      quality: q,
    })
  }
  return rows
}

/** Seznam souborů v adresáři (HTML výpis serveru nginx) */
export async function listDir(path: string): Promise<string[]> {
  const res = await fetchWithRetry(`${API.chmiClimate}/${path}`)
  if (!res.ok) return []
  const html = await res.text()
  return [...html.matchAll(/href="([^"?/][^"]*)"/g)].map((m) => decodeURIComponent(m[1]))
}

/** Stáhne a rozparsuje soubor; 404 → null (soubor ještě/už neexistuje) */
export async function fetchChmi(path: string): Promise<ChmiRow[] | null> {
  const res = await fetchWithRetry(`${API.chmiClimate}/${path}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`)
  return parseChmi((await res.json()) as ChmiFile)
}

export const WSI = CHMI_STATION.wsi
