// Společný formát radarových snímků v data větvi (radar ČHMÚ, nowcasting ČHMÚ, model ALADIN):
// šedotónové PNG v projekci EPSG:3857, řádek 0 = sever, hodnota pixelu kóduje odrazivost.
//   0 = bez srážek, 1 = mimo dosah dat,
//   4–255: v = 64 + 2·dBZ + sníh  (dBZ celé −30 … 95, nejnižší bit = sníh)

export const NO_ECHO = 0
export const NO_COVERAGE = 1

export function encodeDbz(dbz: number, snow = false): number {
  if (!Number.isFinite(dbz)) return NO_COVERAGE
  const d = Math.max(-30, Math.min(95, Math.round(dbz)))
  return 64 + 2 * d + (snow ? 1 : 0)
}

export function decodeDbz(v: number): { dbz: number; snow: boolean } | null {
  if (v < 4) return null
  const d = v - 64
  const snow = ((d % 2) + 2) % 2 === 1
  return { dbz: (d - (snow ? 1 : 0)) / 2, snow }
}

export interface GeoBounds {
  south: number
  west: number
  north: number
  east: number
}

/** Celý obrázek ČHMÚ (pacz2gmaps3, 680 × 460 px) podle radar_popis_cz.pdf */
export const CHMI_IMAGE = { width: 680, height: 460, bounds: { south: 48.047, west: 11.267, north: 52.167, east: 20.77 } } as const
/** Oblast s radarovými daty uvnitř obrázku (zbytek tvoří popisky a legenda) */
export const CHMI_DATA_BOUNDS: GeoBounds = { south: 48.047, west: 11.267, north: 51.458, east: 19.624 }

const RAD = Math.PI / 180
export const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))

/** Pixelové hranice datové oblasti v obrázku ČHMÚ (zaokrouhleno na celé pixely) */
export function chmiDataPixels() {
  const { width, height, bounds: b } = CHMI_IMAGE
  const x = (lon: number) => ((lon - b.west) / (b.east - b.west)) * width
  const y = (lat: number) => ((mercY(b.north) - mercY(lat)) / (mercY(b.north) - mercY(b.south))) * height
  return {
    x0: Math.round(x(CHMI_DATA_BOUNDS.west)),
    x1: Math.round(x(CHMI_DATA_BOUNDS.east)),
    y0: Math.round(y(CHMI_DATA_BOUNDS.north)),
    y1: Math.round(y(CHMI_DATA_BOUNDS.south)),
  }
}

/**
 * Index palety ČHMÚ → dBZ. Stupnice scl-dbz-mmh: 15 tříd po 4 dBZ, index 195 = 4–8 dBZ … 181 = ≥ 60 dBZ.
 * Hodnota je střed třídy. Index 242 (šedá) = mimo dosah radarů. Ostatní indexy jsou popisky a čáry.
 */
export function chmiIndexToValue(idx: number): number {
  if (idx >= 181 && idx <= 195) return encodeDbz(4 + (195 - idx) * 4 + 2)
  if (idx === 242) return NO_COVERAGE
  return NO_ECHO
}

/**
 * Model ALADIN: intenzita srážek z hodinových přírůstků (mm/h) → dBZ (Marshall–Palmer, Z = 200·R^1,6).
 * Pole simulované odrazivosti MAXSIM_REFLECTI nepoužíváme – ověřeno, že slabý a mírný déšť nezachytí
 * (při 1–3 mm/h průměrně jen 3 dBZ místo ~25 dBZ).
 */
export function modelRateToValue(rain: number, snow: number): number {
  if (!Number.isFinite(rain) || !Number.isFinite(snow)) return NO_COVERAGE
  const total = Math.max(0, rain) + Math.max(0, snow)
  if (total < 0.1) return NO_ECHO
  return encodeDbz(10 * Math.log10(200 * total ** 1.6), snow > rain)
}

export interface RadarFrameRef {
  /** Platnost snímku (ms UTC) */
  t: number
  /** Cesta v data větvi */
  file: string
}

/** radar/index.json */
export interface RadarIndex {
  updated: string
  /** Radar ČHMÚ (pseudoCAPPI 2 km), posledních ~2 h po 5 min */
  obs: { bounds: GeoBounds; frames: RadarFrameRef[] } | null
  /** Nowcasting ČHMÚ (COTREC), +10 … +60 min */
  nowcast: { base: number; bounds: GeoBounds; frames: RadarFrameRef[] } | null
  /** Model ČHMÚ ALADIN 2,3 km – intenzita srážek po hodinách (převedená na dBZ) */
  model: { run: number; bounds: GeoBounds; frames: RadarFrameRef[] } | null
}
