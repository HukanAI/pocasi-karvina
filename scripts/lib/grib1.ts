// Čtení GRIB1 (WMO FM 92) bez závislostí: jednoduché balení hodnot, mřížky lat/lon a Lambert.
// Používá se pro model ČHMÚ ALADIN (opendata.chmi.cz/meteorology/weather/nwp_aladin).

export interface LatLonGrid {
  type: 'latlon'
  nx: number
  ny: number
  la1: number
  lo1: number
  la2: number
  lo2: number
  dx: number // stupně
  dy: number
  scan: number
}

export interface LambertGrid {
  type: 'lambert'
  nx: number
  ny: number
  la1: number
  lo1: number
  lov: number
  dx: number // metry
  dy: number
  latin1: number
  latin2: number
  scan: number
  /** Poloměr Země podle příznaku rozlišení (GRIB1: koule 6367,47 km, jinak IAU elipsoid ~6378,16 km) */
  radius: number
}

export type Grid = LatLonGrid | LambertGrid

export interface GribMessage {
  param: number
  levelType: number
  /** Referenční čas (start běhu modelu), ms UTC */
  reference: number
  /** Délka předpovědi v hodinách */
  forecastHour: number
  grid: Grid
  /** Rozbalí hodnoty (řádek po řádku podle scanu; null = bod chybí v bitmapě) */
  values: () => Float32Array
}

/** 24bitové číslo se znaménkem v nejvyšším bitu (znaménko + velikost) */
const s24 = (b: Uint8Array, o: number) => {
  const v = (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]
  return v & 0x800000 ? -(v & 0x7fffff) : v
}
const u24 = (b: Uint8Array, o: number) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]
const s16 = (b: Uint8Array, o: number) => {
  const v = u16(b, o)
  return v & 0x8000 ? -(v & 0x7fff) : v
}

/** IBM System/360 single precision (referenční hodnota v GRIB1) */
export function ibmFloat(b: Uint8Array, o: number): number {
  const sign = b[o] & 0x80 ? -1 : 1
  const exp = (b[o] & 0x7f) - 64
  const mant = ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) / 0x1000000
  return sign * mant * 16 ** exp
}

function parseGrid(g: Uint8Array): Grid {
  const type = g[5]
  if (type === 0) {
    return {
      type: 'latlon',
      nx: u16(g, 6),
      ny: u16(g, 8),
      la1: s24(g, 10) / 1000,
      lo1: s24(g, 13) / 1000,
      la2: s24(g, 17) / 1000,
      lo2: s24(g, 20) / 1000,
      dx: u16(g, 23) / 1000,
      dy: u16(g, 25) / 1000,
      scan: g[27],
    }
  }
  if (type === 3) {
    return {
      type: 'lambert',
      nx: u16(g, 6),
      ny: u16(g, 8),
      la1: s24(g, 10) / 1000,
      lo1: s24(g, 13) / 1000,
      radius: g[16] & 0x40 ? 6378160 : 6367470,
      lov: s24(g, 17) / 1000,
      dx: u24(g, 20),
      dy: u24(g, 23),
      scan: g[27],
      latin1: s24(g, 28) / 1000,
      latin2: s24(g, 31) / 1000,
    }
  }
  throw new Error(`Nepodporovaná mřížka GRIB1 typu ${type}`)
}

export function* readGrib1(buf: Uint8Array): Generator<GribMessage> {
  let pos = 0
  while (pos + 8 <= buf.length) {
    // Najít „GRIB“
    let i = pos
    while (i + 4 <= buf.length && !(buf[i] === 0x47 && buf[i + 1] === 0x52 && buf[i + 2] === 0x49 && buf[i + 3] === 0x42)) i++
    if (i + 8 > buf.length) return
    if (buf[i + 7] !== 1) throw new Error(`Podporován je jen GRIB1, nalezena edice ${buf[i + 7]}`)
    const total = u24(buf, i + 4)
    let p = i + 8
    const pdsLen = u24(buf, p)
    const pds = buf.subarray(p, p + pdsLen)
    p += pdsLen
    const flag = pds[7]
    let gds: Uint8Array | null = null
    if (flag & 0x80) {
      const l = u24(buf, p)
      gds = buf.subarray(p, p + l)
      p += l
    }
    let bitmap: Uint8Array | null = null
    if (flag & 0x40) {
      const l = u24(buf, p)
      if (u16(buf, p + 4) !== 0) throw new Error('Předdefinovaná bitmapa GRIB1 není podporována')
      bitmap = buf.subarray(p + 6, p + l)
      p += l
    }
    const bdsLen = u24(buf, p)
    const bds = buf.subarray(p, p + bdsLen)
    if (!gds) throw new Error('Zpráva GRIB1 bez popisu mřížky')
    if (bds[3] & 0xc0) throw new Error('Podporováno je jen jednoduché balení mřížkových bodů')
    const grid = parseGrid(gds)
    const D = s16(pds, 26)
    const E = s16(bds, 4)
    const R = ibmFloat(bds, 6)
    const bits = bds[10]
    const data = bds.subarray(11)
    // Čas: rok v století + století (oktet 25)
    const year = (pds[24] - 1) * 100 + pds[12]
    const reference = Date.UTC(year, pds[13] - 1, pds[14], pds[15], pds[16])
    const unit = pds[17]
    const tr = pds[20]
    const p1 = tr === 10 ? u16(pds, 18) : pds[18]
    const p2 = tr === 10 ? 0 : pds[19]
    // Časový krok: 1 = hodina, 0 = minuta, 2 = den
    const unitHours = unit === 1 ? 1 : unit === 0 ? 1 / 60 : unit === 2 ? 24 : unit === 10 ? 3 : unit === 11 ? 6 : unit === 12 ? 12 : 1
    // Akumulace/průměr (tr 2–5) platí ke konci intervalu P2, okamžité hodnoty k P1
    const forecastHour = (tr >= 2 && tr <= 5 ? p2 : p1) * unitHours
    const n = grid.nx * grid.ny
    const scale = 2 ** E
    const dscale = 10 ** -D
    const values = () => {
      const out = new Float32Array(n)
      let bitPos = 0
      const read = () => {
        let v = 0
        for (let k = 0; k < bits; k++) {
          const byte = data[(bitPos + k) >> 3]
          v = v * 2 + ((byte >> (7 - ((bitPos + k) & 7))) & 1)
        }
        bitPos += bits
        return v
      }
      const fast = bits === 24 || bits === 16 || bits === 8
      for (let k = 0; k < n; k++) {
        if (bitmap && !((bitmap[k >> 3] >> (7 - (k & 7))) & 1)) {
          out[k] = Number.NaN
          continue
        }
        let x: number
        if (fast && !bitmap) {
          const o = k * (bits >> 3)
          x = bits === 24 ? u24(data, o) : bits === 16 ? u16(data, o) : data[o]
        } else if (bits === 0) x = 0
        else x = read()
        out[k] = (R + x * scale) * dscale
      }
      return out
    }
    yield { param: pds[8], levelType: pds[9], reference, forecastHour, grid, values }
    pos = i + total
  }
}

// ------------------------------------------------------------------ Projekce

const RAD = Math.PI / 180

/** Převod zeměpisných souřadnic na (zlomkové) indexy mřížky i (sloupec), j (řádek podle uložení) */
export function gridLocator(grid: Grid): (lat: number, lon: number) => { i: number; j: number } {
  const jPositive = (grid.scan & 0x40) !== 0 // body jdou od jihu k severu
  if (grid.type === 'latlon') {
    return (lat, lon) => ({
      i: (lon - grid.lo1) / grid.dx,
      j: jPositive ? (lat - grid.la1) / grid.dy : (grid.la1 - lat) / grid.dy,
    })
  }
  const φ1 = grid.latin1 * RAD
  const φ2 = grid.latin2 * RAD
  const n =
    Math.abs(grid.latin1 - grid.latin2) < 1e-9
      ? Math.sin(φ1)
      : Math.log(Math.cos(φ1) / Math.cos(φ2)) / Math.log(Math.tan(Math.PI / 4 + φ2 / 2) / Math.tan(Math.PI / 4 + φ1 / 2))
  const F = (Math.cos(φ1) * Math.tan(Math.PI / 4 + φ1 / 2) ** n) / n
  const R = grid.radius
  const project = (lat: number, lon: number) => {
    const ρ = (R * F) / Math.tan(Math.PI / 4 + (lat * RAD) / 2) ** n
    let dl = lon - grid.lov
    if (dl > 180) dl -= 360
    if (dl < -180) dl += 360
    const θ = n * dl * RAD
    return { x: ρ * Math.sin(θ), y: -ρ * Math.cos(θ) }
  }
  const o = project(grid.la1, grid.lo1)
  return (lat, lon) => {
    const p = project(lat, lon)
    return { i: (p.x - o.x) / grid.dx, j: jPositive ? (p.y - o.y) / grid.dy : (o.y - p.y) / grid.dy }
  }
}

/** Zeměpisná šířka z Mercatorovy souřadnice y (0 = rovník, v radiánech) */
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))
const invMercY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

/**
 * Převzorkuje pole z mřížky modelu do pravidelného rastru ve webové Mercatorově projekci (EPSG:3857),
 * řádek 0 = sever. Bilineární interpolace; mimo mřížku NaN.
 */
export function resampleToMercator(values: Float32Array, grid: Grid, bounds: Bounds, width: number, height: number): Float32Array {
  const locate = gridLocator(grid)
  const out = new Float32Array(width * height)
  const yN = mercY(bounds.north)
  const yS = mercY(bounds.south)
  const at = (i: number, j: number) => values[j * grid.nx + i]
  for (let r = 0; r < height; r++) {
    const lat = invMercY(yN - ((r + 0.5) / height) * (yN - yS))
    for (let c = 0; c < width; c++) {
      const lon = bounds.west + ((c + 0.5) / width) * (bounds.east - bounds.west)
      const { i, j } = locate(lat, lon)
      const i0 = Math.floor(i)
      const j0 = Math.floor(j)
      if (i0 < 0 || j0 < 0 || i0 + 1 >= grid.nx || j0 + 1 >= grid.ny) {
        out[r * width + c] = Number.NaN
        continue
      }
      const fi = i - i0
      const fj = j - j0
      out[r * width + c] =
        at(i0, j0) * (1 - fi) * (1 - fj) + at(i0 + 1, j0) * fi * (1 - fj) + at(i0, j0 + 1) * (1 - fi) * fj + at(i0 + 1, j0 + 1) * fi * fj
    }
  }
  return out
}

/** Výška rastru v pixelech, aby měl v Mercatorově projekci čtvercové pixely */
export function mercatorHeight(bounds: Bounds, width: number): number {
  const spanX = (bounds.east - bounds.west) * RAD
  const spanY = mercY(bounds.north) - mercY(bounds.south)
  return Math.round((width * spanY) / spanX)
}
