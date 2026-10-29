// Sdílená konfigurace aplikace i skriptů pro GitHub Actions.
// Nesmí záviset na prohlížeči ani na Vite (import.meta.env), protože ji importuje i Node.

export const LOCATION = {
  name: 'Karviná',
  // Bod zvolený uživatelem: 49°52'30.7"N 18°33'02.5"E
  latitude: 49.87519,
  longitude: 18.55069,
  timezone: 'Europe/Prague',
} as const

export const CHMI_STATION = {
  wsi: '0-203-0-11795',
  name: 'Karviná',
  latitude: 49.8549,
  longitude: 18.5332,
  elevation: 224,
  since: 1876,
} as const

export const GITHUB = {
  owner: 'HukanAI',
  repo: 'pocasi-karvina',
  dataBranch: 'data',
} as const

export const DEFAULT_DATA_BASE_URL = `https://raw.githubusercontent.com/${GITHUB.owner}/${GITHUB.repo}/${GITHUB.dataBranch}/`

export const API = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  ensemble: 'https://ensemble-api.open-meteo.com/v1/ensemble',
  airQuality: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
  rainviewer: 'https://api.rainviewer.com/public/weather-maps.json',
  meteoalarm: 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-czechia',
  chmiClimate: 'https://opendata.chmi.cz/meteorology/climate',
  ntfy: 'https://ntfy.sh',
} as const

/** Modely pro srovnání předpovědí (Open-Meteo) */
export const MODELS = [
  { id: 'ecmwf_ifs025', name: 'ECMWF IFS', origin: 'Evropské centrum (ECMWF)', color: '#60a5fa' },
  { id: 'icon_seamless', name: 'ICON', origin: 'DWD, Německo', color: '#f472b6' },
  { id: 'icon_d2', name: 'ICON-D2', origin: 'DWD, 2 km, 2 dny', color: '#c084fc' },
  { id: 'gfs_seamless', name: 'GFS', origin: 'NOAA, USA', color: '#fbbf24' },
  { id: 'meteofrance_seamless', name: 'ARPEGE/AROME', origin: 'Météo-France', color: '#34d399' },
  { id: 'ukmo_seamless', name: 'UKMO', origin: 'Met Office, UK', color: '#f87171' },
] as const

export type ModelId = (typeof MODELS)[number]['id']

/** Výstrahy MeteoAlarm: ORP Karviná */
export const WARNING_AREA = {
  emmaId: 'CZ08111',
  cisorp: '8111',
  nameMatch: /karvin/i,
} as const

/** Prahy pro upozornění (notifikace přes ntfy) */
export const ALERT_RULES = {
  /** Mráz: minimální teplota v noci pod touto hodnotou (°C), ostře menší */
  frostBelow: 0,
  /** Silný mráz (°C), menší nebo rovno */
  strongFrostAtOrBelow: -10,
  /** Prudký pokles teploty za 24 h (°C), větší nebo rovno */
  tempDrop24h: 10,
  /** Denní úhrn srážek (mm), větší nebo rovno */
  dailyRainAtLeast: 20,
  /** Hodinový úhrn srážek (mm), větší nebo rovno */
  hourlyRainAtLeast: 10,
  /** Nárazy větru (km/h), větší nebo rovno */
  gustAtLeast: 60,
  /** Denní průměr PM10 (µg/m³), ostře větší (denní imisní limit ČR/EU je 50) */
  pm10DailyAbove: 50,
  /** Denní průměr PM2.5 (µg/m³), ostře větší (denní limit EU od 2030 je 25) */
  pm25DailyAbove: 25,
  /** Ranní souhrn, místní čas */
  morningSummary: { hour: 6, minute: 30, latestHour: 10 },
} as const

/** Normálové období WMO */
export const NORMAL_PERIOD = { from: 1991, to: 2020 } as const
