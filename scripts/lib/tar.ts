// Čtení archivu TAR (ustar) – předpovědi ČHMÚ jsou zabalené jako .tar se 6 obrázky

export interface TarEntry {
  name: string
  data: Uint8Array
}

export function readTar(buf: Uint8Array): TarEntry[] {
  const out: TarEntry[] = []
  const dec = new TextDecoder('latin1')
  let pos = 0
  while (pos + 512 <= buf.length) {
    const header = buf.subarray(pos, pos + 512)
    if (header.every((b) => b === 0)) break
    const str = (from: number, len: number) => dec.decode(header.subarray(from, from + len)).replace(/\0.*$/s, '')
    const name = str(0, 100)
    const prefix = str(345, 155)
    const size = parseInt(str(124, 12).trim() || '0', 8)
    const type = str(156, 1)
    const full = prefix ? `${prefix}/${name}` : name
    if (type === '0' || type === '') out.push({ name: full, data: buf.subarray(pos + 512, pos + 512 + size) })
    pos += 512 + Math.ceil(size / 512) * 512
  }
  return out
}
