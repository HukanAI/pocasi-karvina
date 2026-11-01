// Minimální čtení a zápis PNG (bez závislostí): indexované nebo šedotónové 8bitové obrázky bez prokládání

import { deflateSync, inflateSync } from 'node:zlib'

export interface DecodedPng {
  width: number
  height: number
  /** Hodnota pixelu: index palety (barevný typ 3) nebo úroveň šedi (typ 0) */
  pixels: Uint8Array
  palette: [number, number, number][] | null
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export function decodePng(buf: Uint8Array): DecodedPng {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
  if (!b.subarray(0, 8).equals(SIGNATURE)) throw new Error('Není PNG')
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let palette: [number, number, number][] | null = null
  const idat: Buffer[] = []
  let pos = 8
  while (pos < b.length) {
    const len = b.readUInt32BE(pos)
    const type = b.toString('latin1', pos + 4, pos + 8)
    const data = b.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      palette = []
      for (let i = 0; i + 2 < len; i += 3) palette.push([data[i], data[i + 1], data[i + 2]])
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 0 && colorType !== 3) || interlace !== 0) {
    throw new Error(`Nepodporované PNG: hloubka ${bitDepth}, typ ${colorType}, prokládání ${interlace}`)
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width
  const pixels = new Uint8Array(width * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x > 0 ? out[x - 1] : 0
      const up = prev[x]
      const c = x > 0 ? prev[x - 1] : 0
      const v = line[x]
      out[x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + up : f === 3 ? v + ((a + up) >> 1) : v + paeth(a, up, c)) & 0xff
    }
    prev = out
  }
  return { width, height, pixels, palette }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** Zapíše 8bitové šedotónové PNG (filtr „Sub“ – řídká data se dobře komprimují) */
export function encodeGrayPng(width: number, height: number, pixels: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (width + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 1
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x]
      const left = x > 0 ? pixels[y * width + x - 1] : 0
      raw[y * (width + 1) + 1 + x] = (v - left) & 0xff
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bitová hloubka
  ihdr[9] = 0 // šedotónové
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array())])
}
