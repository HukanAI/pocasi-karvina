import { describe, expect, it } from 'vitest'
import { gridLocator, ibmFloat, mercatorHeight, readGrib1, resampleToMercator, type LambertGrid } from './grib1.ts'
import { decodePng, encodeGrayPng } from './png.ts'
import { readTar } from './tar.ts'

// ------------------------------------------------------------------ GRIB1

const u24 = (v: number) => [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
const s24 = (v: number) => u24(Math.abs(v) | (v < 0 ? 0x800000 : 0))
const s16 = (v: number) => [((Math.abs(v) >> 8) & 0x7f) | (v < 0 ? 0x80 : 0), Math.abs(v) & 0xff]

/** Sestaví zprávu GRIB1 s mřížkou lat/lon 3 × 2, referencí R = 0 a E = 0, D = 1 (hodnoty /10) */
function grib1(packed: number[], opts: { p1: number; tr: number; bits?: number }) {
  const bits = opts.bits ?? 8
  const pds = [0, 0, 28, 2, 89, 1, 255, 0x80, 61, 105, 0, 0, 26, 11, 1, 12, 0, 1, (opts.p1 >> 8) & 0xff, opts.p1 & 0xff, opts.tr, 0, 0, 0, 21, 0, ...s16(1)]
  pds.splice(0, 3, ...u24(pds.length))
  const gds = [0, 0, 32, 0, 255, 0, 0, 3, 0, 2, ...s24(48500), ...s24(12000), 0x80, ...s24(48510), ...s24(12040), 0, 20, 0, 10, 0x40, 0, 0, 0, 0]
  gds.splice(0, 3, ...u24(gds.length))
  const data: number[] = []
  if (bits === 8) data.push(...packed)
  else for (const v of packed) data.push(...u24(v))
  const bds = [0, 0, 0, 0, ...s16(0), 0, 0, 0, 0, bits, ...data]
  bds.splice(0, 3, ...u24(bds.length))
  const body = [...pds, ...gds, ...bds, 0x37, 0x37, 0x37, 0x37]
  const total = 8 + body.length
  return new Uint8Array([0x47, 0x52, 0x49, 0x42, ...u24(total), 1, ...body])
}

describe('GRIB1', () => {
  it('IBM float: 1,0 a −118,625', () => {
    expect(ibmFloat(new Uint8Array([0x41, 0x10, 0, 0]), 0)).toBe(1)
    expect(ibmFloat(new Uint8Array([0xc2, 0x76, 0xa0, 0]), 0)).toBe(-118.625)
  })

  it('přečte hlavičku, mřížku a hodnoty (8 i 24 bitů), čas předpovědi z tr = 10', () => {
    for (const bits of [8, 24]) {
      const msg = [...readGrib1(grib1([0, 5, 10, 15, 20, 255], { p1: 7, tr: 10, bits }))]
      expect(msg).toHaveLength(1)
      const m = msg[0]
      expect(m.param).toBe(61)
      expect(m.forecastHour).toBe(7)
      expect(new Date(m.reference).toISOString()).toBe('2026-11-01T12:00:00.000Z')
      expect(m.grid).toMatchObject({ type: 'latlon', nx: 3, ny: 2, la1: 48.5, lo1: 12, dx: 0.02, dy: 0.01, scan: 0x40 })
      expect([...m.values()].map((v) => Math.round(v * 10) / 10)).toEqual([0, 0.5, 1, 1.5, 2, 25.5])
    }
  })

  it('přečte více zpráv za sebou', () => {
    const a = grib1([1, 1, 1, 1, 1, 1], { p1: 1, tr: 10 })
    const b = grib1([2, 2, 2, 2, 2, 2], { p1: 2, tr: 10 })
    const both = new Uint8Array([...a, ...b])
    expect([...readGrib1(both)].map((m) => m.forecastHour)).toEqual([1, 2])
  })

  it('lat/lon lokátor: první bod (0,0), sever = vyšší j při scanu od jihu', () => {
    const [m] = [...readGrib1(grib1([0, 0, 0, 0, 0, 0], { p1: 1, tr: 10 }))]
    const loc = gridLocator(m.grid)
    expect(loc(48.5, 12)).toEqual({ i: 0, j: 0 })
    const p = loc(48.51, 12.04)
    expect(p.i).toBeCloseTo(2, 9)
    expect(p.j).toBeCloseTo(1, 9)
  })
})

describe('Lambertova projekce', () => {
  const grid: LambertGrid = { type: 'lambert', nx: 100, ny: 100, la1: 46, lo1: 10, lov: 17, dx: 2325, dy: 2325, latin1: 46.24, latin2: 46.24, scan: 0x40, radius: 6367470 }
  const loc = gridLocator(grid)

  it('první bod mřížky je (0, 0)', () => {
    const p = loc(46, 10)
    expect(p.i).toBeCloseTo(0, 9)
    expect(p.j).toBeCloseTo(0, 9)
  })

  it('na střední rovnoběžce odpovídá 1 krok mřížky 2 325 m (měřítko 1)', () => {
    // Posun o 0,1° k východu na 46,24° s. š. ≈ 0,1 × 111,13 × cos(46,24°) km
    const a = loc(46.24, 17)
    const b = loc(46.24, 17.1)
    const km = Math.hypot(b.i - a.i, b.j - a.j) * 2.325
    expect(km).toBeCloseTo(0.1 * ((Math.PI * 6367.47) / 180) * Math.cos((46.24 * Math.PI) / 180), 2)
  })

  it('sever je ve směru rostoucího j, východ rostoucího i (u centrálního poledníku)', () => {
    const c = loc(50, 17)
    expect(loc(50.5, 17).j).toBeGreaterThan(c.j)
    expect(Math.abs(loc(50.5, 17).i - c.i)).toBeLessThan(1e-6)
    expect(loc(50, 17.5).i).toBeGreaterThan(c.i)
  })
})

describe('převzorkování do Mercatora', () => {
  it('výška rastru dává čtvercové pixely; hodnoty z lat/lon mřížky se přenesou', () => {
    const bounds = { south: 49, west: 18, north: 50, east: 19 }
    const w = 100
    const h = mercatorHeight(bounds, w)
    expect(h).toBeGreaterThan(150) // 1° šířky je na 49,5° s. š. ~1,54× delší než 1° délky
    expect(h).toBeLessThan(160)
    // Mřížka 11 × 11 po 0,1°, hodnota = index sloupce → po převzorkování roste zleva doprava
    const grid = { type: 'latlon' as const, nx: 11, ny: 11, la1: 49, lo1: 18, la2: 50, lo2: 19, dx: 0.1, dy: 0.1, scan: 0x40 }
    const vals = new Float32Array(121).map((_, k) => k % 11)
    const out = resampleToMercator(vals, grid, bounds, w, h)
    const row = Math.floor(h / 2)
    expect(out[row * w + 0]).toBeCloseTo(0.05, 1)
    expect(out[row * w + w - 1]).toBeCloseTo(9.95, 1)
  })
})

// ------------------------------------------------------------------ PNG a TAR

describe('PNG', () => {
  it('zápis a zpětné čtení šedotónového obrázku', () => {
    const px = new Uint8Array(37 * 5).map((_, k) => (k * 7) % 256)
    const dec = decodePng(encodeGrayPng(37, 5, px))
    expect(dec.width).toBe(37)
    expect(dec.height).toBe(5)
    expect([...dec.pixels]).toEqual([...px])
  })
})

describe('TAR', () => {
  it('přečte soubory z archivu ustar', () => {
    const header = (name: string, size: number) => {
      const h = new Uint8Array(512)
      new TextEncoder().encodeInto(name, h)
      new TextEncoder().encodeInto(size.toString(8).padStart(11, '0'), h.subarray(124))
      h[156] = 0x30
      return h
    }
    const data = new TextEncoder().encode('ahoj')
    const pad = new Uint8Array(512 - data.length)
    const tar = new Uint8Array([...header('dir/a.png', 4), ...data, ...pad, ...new Uint8Array(1024)])
    const entries = readTar(tar)
    expect(entries.map((e) => e.name)).toEqual(['dir/a.png'])
    expect(new TextDecoder().decode(entries[0].data)).toBe('ahoj')
  })
})
