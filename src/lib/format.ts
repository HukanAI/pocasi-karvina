// České formátování čísel a jednotek

const nf = new Map<number, Intl.NumberFormat>()

/** Číslo s desetinnou čárkou; null/NaN → '–' */
export function num(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '–'
  let f = nf.get(digits)
  if (!f) {
    f = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    nf.set(digits, f)
  }
  // Intl dává pro záporná čísla '-', typograficky správné je minus '−'; zabráníme i '−0'
  const s = f.format(Object.is(Math.round(v * 10 ** digits), -0) ? 0 : v)
  return s.replace('-', '−')
}

export const temp = (v: number | null | undefined, digits = 1) => `${num(v, digits)} °C`
export const tempShort = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : `${num(v, 0)}°`)
export const mm = (v: number | null | undefined, digits = 1) => `${num(v, digits)} mm`
export const pct = (v: number | null | undefined) => `${num(v, 0)} %`
export const hPa = (v: number | null | undefined) => `${num(v, 0)} hPa`
export const kmh = (v: number | null | undefined) => `${num(v, 0)} km/h`
export const ms2kmh = (v: number) => v * 3.6
export const kmh2ms = (v: number) => v / 3.6

/** Odchylka se znaménkem: '+3,2 °C', '−1,0 °C' */
export function signed(v: number | null | undefined, digits = 1, unit = ' °C'): string {
  if (v == null || !Number.isFinite(v)) return '–'
  const r = Math.round(v * 10 ** digits) / 10 ** digits
  return `${r > 0 ? '+' : ''}${num(r, digits)}${unit}`
}

const DIRS_8 = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'] as const
const DIRS_8_LONG = ['severní', 'severovýchodní', 'východní', 'jihovýchodní', 'jižní', 'jihozápadní', 'západní', 'severozápadní'] as const

/** Směr, odkud vítr vane (meteorologická konvence): 0° = sever → 'S' */
export function windDir(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return '–'
  return DIRS_8[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

const DIRS_8_FROM = ['severu', 'severovýchodu', 'východu', 'jihovýchodu', 'jihu', 'jihozápadu', 'západu', 'severozápadu'] as const

/** „od severovýchodu“ – odkud vítr vane, 2. pád */
export function windFrom(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return '–'
  return DIRS_8_FROM[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

export function windDirLong(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return '–'
  return DIRS_8_LONG[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

/** Beaufortova stupnice z km/h */
export function beaufort(kmhValue: number): number {
  const limits = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]
  const i = limits.findIndex((l) => kmhValue < l)
  return i === -1 ? 12 : i
}

const BEAUFORT_CS = [
  'bezvětří', 'vánek', 'slabý vítr', 'mírný vítr', 'dosti čerstvý vítr', 'čerstvý vítr',
  'silný vítr', 'prudký vítr', 'bouřlivý vítr', 'vichřice', 'silná vichřice', 'mohutná vichřice', 'orkán',
] as const
export const beaufortLabel = (b: number) => BEAUFORT_CS[Math.max(0, Math.min(12, b))]

/** České skloňování: plural(5, ['den','dny','dní']) */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n)
  if (a === 1) return forms[0]
  if (a >= 2 && a <= 4 && Number.isInteger(a)) return forms[1]
  return forms[2]
}

export function uvLabel(uv: number | null | undefined): string {
  if (uv == null) return '–'
  if (uv < 3) return 'nízký'
  if (uv < 6) return 'střední'
  if (uv < 8) return 'vysoký'
  if (uv < 11) return 'velmi vysoký'
  return 'extrémní'
}

export function visibilityLabel(m: number | null | undefined): string {
  if (m == null) return '–'
  if (m >= 10_000) return `${num(m / 1000, 0)} km`
  if (m >= 1000) return `${num(m / 1000, 1)} km`
  return `${num(m, 0)} m`
}
