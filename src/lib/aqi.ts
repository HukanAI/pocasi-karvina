// Evropský index kvality ovzduší (EAQI, jak ho počítá Open-Meteo z modelu CAMS) a limity škodlivin

export interface Band {
  max: number
  label: string
  color: string
  advice: string
}

/** Pásma EAQI 0–20–40–60–80–100–… (barvy dle EEA) */
export const EAQI_BANDS: Band[] = [
  { max: 20, label: 'Dobrá', color: '#50f0e6', advice: 'Kvalita ovzduší je dobrá, venkovní aktivity bez omezení.' },
  { max: 40, label: 'Přijatelná', color: '#50ccaa', advice: 'Venkovní aktivity bez omezení.' },
  { max: 60, label: 'Střední', color: '#f0e641', advice: 'Citliví lidé by měli zvážit omezení náročné činnosti venku.' },
  { max: 80, label: 'Špatná', color: '#ff5050', advice: 'Citliví lidé: omezte pobyt venku. Ostatní: omezte náročnou činnost.' },
  { max: 100, label: 'Velmi špatná', color: '#960032', advice: 'Omezte pobyt venku, zejména děti, senioři a lidé s nemocemi srdce a plic.' },
  { max: Infinity, label: 'Extrémně špatná', color: '#7d2181', advice: 'Vyhněte se pobytu venku.' },
]

export function eaqiBand(v: number | null | undefined): Band | null {
  if (v == null || !Number.isFinite(v)) return null
  return EAQI_BANDS.find((b) => v <= b.max) ?? EAQI_BANDS[EAQI_BANDS.length - 1]
}

export interface Pollutant {
  key: 'pm10' | 'pm2_5' | 'nitrogen_dioxide' | 'ozone' | 'sulphur_dioxide'
  name: string
  short: string
  /** Hranice pásem EAQI pro hodinové koncentrace (µg/m³), stejné pořadí jako EAQI_BANDS */
  bands: number[]
  /** Zákonný limit (popis) */
  limit: string
}

export const POLLUTANTS: Pollutant[] = [
  { key: 'pm10', name: 'Prachové částice PM10', short: 'PM10', bands: [20, 40, 50, 100, 150], limit: 'Denní imisní limit 50 µg/m³ (max. 35× ročně)' },
  { key: 'pm2_5', name: 'Jemné částice PM2,5', short: 'PM2,5', bands: [10, 20, 25, 50, 75], limit: 'Roční limit 20 µg/m³, od 2030 denní 25 µg/m³' },
  { key: 'nitrogen_dioxide', name: 'Oxid dusičitý', short: 'NO₂', bands: [40, 90, 120, 230, 340], limit: 'Hodinový limit 200 µg/m³' },
  { key: 'ozone', name: 'Přízemní ozon', short: 'O₃', bands: [50, 100, 130, 240, 380], limit: 'Cílová hodnota 120 µg/m³ (8h průměr)' },
  { key: 'sulphur_dioxide', name: 'Oxid siřičitý', short: 'SO₂', bands: [100, 200, 350, 500, 750], limit: 'Hodinový limit 350 µg/m³' },
]

export function pollutantBand(p: Pollutant, v: number | null | undefined): Band | null {
  if (v == null || !Number.isFinite(v)) return null
  const i = p.bands.findIndex((b) => v <= b)
  return EAQI_BANDS[i === -1 ? EAQI_BANDS.length - 1 : i]
}

export interface PollenType {
  key: 'alder_pollen' | 'birch_pollen' | 'grass_pollen' | 'mugwort_pollen' | 'ragweed_pollen'
  name: string
  season: string
  /** Orientační hranice nízká/střední/vysoká (zrn/m³) */
  levels: [number, number, number]
}

export const POLLEN: PollenType[] = [
  { key: 'alder_pollen', name: 'Olše', season: 'leden–duben', levels: [1, 10, 100] },
  { key: 'birch_pollen', name: 'Bříza', season: 'březen–květen', levels: [1, 10, 100] },
  { key: 'grass_pollen', name: 'Trávy', season: 'květen–srpen', levels: [1, 20, 50] },
  { key: 'mugwort_pollen', name: 'Pelyněk', season: 'červenec–září', levels: [1, 10, 50] },
  { key: 'ragweed_pollen', name: 'Ambrozie', season: 'srpen–říjen', levels: [1, 10, 50] },
]

export function pollenLevel(p: PollenType, v: number | null | undefined): { label: string; color: string; level: number } {
  if (v == null || !Number.isFinite(v)) return { label: 'bez dat', color: '#94a3b8', level: -1 }
  if (v < p.levels[0]) return { label: 'žádný', color: '#94a3b8', level: 0 }
  if (v < p.levels[1]) return { label: 'nízký', color: '#50ccaa', level: 1 }
  if (v < p.levels[2]) return { label: 'střední', color: '#f0c541', level: 2 }
  return { label: 'vysoký', color: '#ff5050', level: 3 }
}
