// Každá ikona, kterou aplikace používá, musí být v seznamu zabalených ikon (import.meta.glob ve WeatherIcon.tsx).
// Jinak se v aplikaci zobrazí „N/A“ – soubor existuje v balíčku, ale do sestavení se nedostane.

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { moonPhaseName } from '../lib/astro.ts'
import { WMO_CODES, wmoIcon } from '../lib/wmo.ts'

const dir = fileURLToPath(new URL('.', import.meta.url))
const src = readFileSync(`${dir}WeatherIcon.tsx`, 'utf8')
const bundled = new Set(/fill\/all\/\{([^}]+)\}\.svg/.exec(src)![1].split(','))

/** Všechny literály <WeatherIcon name="…"> ve zdrojových souborech */
function literalIconNames(): string[] {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}${e.name}/`)
      else if (/\.tsx$/.test(e.name)) for (const m of readFileSync(`${d}${e.name}`, 'utf8').matchAll(/WeatherIcon name="([a-z-]+)"/g)) out.push(m[1])
    }
  }
  walk(root)
  return out
}

describe('zabalené ikony', () => {
  it('ikony všech kódů počasí (den i noc)', () => {
    for (const code of WMO_CODES) for (const day of [true, false]) expect(bundled, `${code} ${day}`).toContain(wmoIcon(code, day))
  })
  it('ikony fází Měsíce', () => {
    for (let p = 0; p < 1; p += 0.01) expect(bundled).toContain(moonPhaseName(p).icon)
  })
  it('ikony použité přímo v komponentách', () => {
    const names = literalIconNames()
    expect(names.length).toBeGreaterThan(5)
    for (const n of names) expect(bundled, n).toContain(n)
  })
  it('náhradní ikona not-available', () => {
    expect(bundled).toContain('not-available')
  })
})
