// Kontext nastavení (oddělený od provideru kvůli Fast Refresh)

import { createContext, useContext } from 'react'

export type ThemeSetting = 'auto' | 'light' | 'dark'
export type HistorySource = 'chmi' | 'era5'

export interface Settings {
  theme: ThemeSetting
  /** Minimální úhrn srážkové epizody, která přeruší „období bez deště“ (mm) */
  rainMinTotal: 0.1 | 0.5 | 1 | 2
  historySource: HistorySource
}

export interface SettingsCtx {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  /** Výsledný motiv po zohlednění nastavení systému */
  dark: boolean
}

export const SettingsContext = createContext<SettingsCtx | null>(null)

export function useSettings(): SettingsCtx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings mimo SettingsProvider')
  return ctx
}
