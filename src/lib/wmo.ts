// Kódy počasí WMO (tabulka 4677, podmnožina používaná Open-Meteo) → český popis, ikona, typ pozadí
// Ikona se sluncem/měsícem jen u přeháněk (80–86) a bouřek – trvalé srážky padají ze zatažené oblohy.

export type SkyKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'sleet' | 'storm'

interface WmoEntry {
  label: string
  /** Název ikony Meteocons; '{dn}' se nahradí 'day' / 'night' */
  icon: string
  sky: SkyKind
}

export const WMO: Record<number, WmoEntry> = {
  0: { label: 'Jasno', icon: 'clear-{dn}', sky: 'clear' },
  1: { label: 'Skoro jasno', icon: 'partly-cloudy-{dn}', sky: 'partly' },
  2: { label: 'Polojasno', icon: 'partly-cloudy-{dn}', sky: 'partly' },
  3: { label: 'Zataženo', icon: 'overcast', sky: 'cloudy' },
  45: { label: 'Mlha', icon: 'fog-{dn}', sky: 'fog' },
  48: { label: 'Mlha s námrazou', icon: 'fog', sky: 'fog' },
  51: { label: 'Slabé mrholení', icon: 'drizzle', sky: 'drizzle' },
  53: { label: 'Mrholení', icon: 'drizzle', sky: 'drizzle' },
  55: { label: 'Silné mrholení', icon: 'drizzle', sky: 'drizzle' },
  56: { label: 'Slabé mrznoucí mrholení', icon: 'sleet', sky: 'sleet' },
  57: { label: 'Silné mrznoucí mrholení', icon: 'sleet', sky: 'sleet' },
  61: { label: 'Slabý déšť', icon: 'rain', sky: 'rain' },
  63: { label: 'Déšť', icon: 'rain', sky: 'rain' },
  65: { label: 'Silný déšť', icon: 'rain', sky: 'rain' },
  66: { label: 'Slabý mrznoucí déšť', icon: 'sleet', sky: 'sleet' },
  67: { label: 'Silný mrznoucí déšť', icon: 'sleet', sky: 'sleet' },
  71: { label: 'Slabé sněžení', icon: 'snow', sky: 'snow' },
  73: { label: 'Sněžení', icon: 'snow', sky: 'snow' },
  75: { label: 'Silné sněžení', icon: 'snow', sky: 'snow' },
  77: { label: 'Sněhová zrna', icon: 'snow', sky: 'snow' },
  80: { label: 'Slabé přeháňky', icon: 'partly-cloudy-{dn}-rain', sky: 'rain' },
  81: { label: 'Dešťové přeháňky', icon: 'partly-cloudy-{dn}-rain', sky: 'rain' },
  82: { label: 'Silné přeháňky', icon: 'rain', sky: 'rain' },
  85: { label: 'Sněhové přeháňky', icon: 'partly-cloudy-{dn}-snow', sky: 'snow' },
  86: { label: 'Silné sněhové přeháňky', icon: 'snow', sky: 'snow' },
  95: { label: 'Bouřka', icon: 'thunderstorms-{dn}-rain', sky: 'storm' },
  96: { label: 'Bouřka s kroupami', icon: 'thunderstorms-rain', sky: 'storm' },
  99: { label: 'Silná bouřka s kroupami', icon: 'thunderstorms-rain', sky: 'storm' },
}

/** Všechny kódy, které Open-Meteo může vrátit */
export const WMO_CODES = Object.keys(WMO).map(Number)

const FALLBACK: WmoEntry = { label: 'Neznámý stav', icon: 'not-available', sky: 'cloudy' }

export function wmo(code: number | null | undefined): WmoEntry {
  return (code != null && WMO[code]) || FALLBACK
}

export function wmoLabel(code: number | null | undefined): string {
  return wmo(code).label
}

export function wmoIcon(code: number | null | undefined, isDay: boolean): string {
  return wmo(code).icon.replace('{dn}', isDay ? 'day' : 'night')
}

export function wmoSky(code: number | null | undefined): SkyKind {
  return wmo(code).sky
}

export const isThunder = (code: number | null | undefined) => code != null && code >= 95 && code <= 99
export const isFreezingPrecip = (code: number | null | undefined) => code === 56 || code === 57 || code === 66 || code === 67

/** Kód se srážkami (mrholení, déšť, sníh, přeháňky); mrznoucí srážky a bouřky sem nepatří */
export const isPrecipCode = (code: number | null | undefined) =>
  code != null && ((code >= 51 && code <= 55) || (code >= 61 && code <= 65) || (code >= 71 && code <= 77) || (code >= 80 && code <= 86))

/** Stav oblohy podle oblačnosti v % (bez údaje = zataženo) */
export function cloudCode(cloudCover: number | null | undefined): number {
  if (cloudCover == null || cloudCover >= 80) return 3
  return cloudCover >= 40 ? 2 : cloudCover >= 15 ? 1 : 0
}

/**
 * Kód počasí, který odpovídá zobrazeným srážkám. Open-Meteo vrací kód „slabý déšť“ i pro hodiny,
 * kde stejná předpověď počítá 0 mm (kód vychází z jiné veličiny než úhrn). Aby ikona a popis
 * neříkaly „prší“, zatímco srážky ukazují 0 mm, nahradí se takový kód stavem oblohy.
 */
export function effectiveCode(code: number | null | undefined, precipMm: number | null | undefined, cloudCover: number | null | undefined): number | null {
  if (!isPrecipCode(code)) return code ?? null
  return (precipMm ?? 0) > 0 ? code! : cloudCode(cloudCover)
}

/** Srážky naměřené, ale model je nehlásí: slabý déšť, při teplotě kolem nuly a níž sněžení */
export const measuredPrecipCode = (tempC: number | null | undefined) => (tempC != null && tempC <= 0.5 ? 71 : 61)

interface DayInput {
  hourly: { time: number[]; cloud_cover?: (number | null)[] }
  daily: { time: number[]; weather_code: (number | null)[]; precipitation_sum: (number | null)[] }
}

/** Stav pro den: kód srážek jen tehdy, když model na ten den nějaké srážky počítá, jinak průměrná oblačnost dne */
export function dayCode(f: DayInput, i: number): number | null {
  const code = f.daily.weather_code[i]
  if (!isPrecipCode(code) || (f.daily.precipitation_sum[i] ?? 0) > 0) return code ?? null
  const start = f.daily.time[i]
  const end = f.daily.time[i + 1] ?? start + 24 * 3_600_000
  const cc = f.hourly.cloud_cover
  const values: number[] = []
  if (cc) f.hourly.time.forEach((t, k) => t > start && t <= end && cc[k] != null && values.push(cc[k]!))
  return cloudCode(values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)
}
