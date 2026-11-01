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
