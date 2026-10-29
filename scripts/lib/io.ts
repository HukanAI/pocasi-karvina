// Společné pomůcky skriptů: datový adresář, JSON, stahování s opakováním

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Adresář s obsahem data větve (v Actions checkout větve `data`, lokálně ./data-out) */
export const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data-out')
mkdirSync(DATA_DIR, { recursive: true })

export const dataPath = (name: string) => join(DATA_DIR, name)

export function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(dataPath(name), 'utf8')) as T
  } catch {
    return null
  }
}

/** Zápis přes dočasný soubor, aby se při pádu nezapsal poloviční JSON */
export function writeJson(name: string, data: unknown): void {
  const path = dataPath(name)
  writeFileSync(`${path}.tmp`, JSON.stringify(data))
  renameSync(`${path}.tmp`, path)
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) })
      if (res.ok || res.status === 404) return res
      lastErr = new Error(`HTTP ${res.status} ${url}`)
    } catch (e) {
      lastErr = e
    }
    await sleep(2000 * (i + 1))
  }
  throw lastErr
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return (await res.json()) as T
}

export interface Meta {
  [key: string]: string | undefined
}

/** Zaznamená čas poslední úspěšné aktualizace části dat do meta.json */
export function touchMeta(key: string, value = new Date().toISOString()): void {
  const meta = readJson<Meta>('meta.json') ?? {}
  meta[key] = value
  writeJson('meta.json', meta)
}

export const log = (...args: unknown[]) => console.log(`[${new Date().toISOString()}]`, ...args)
