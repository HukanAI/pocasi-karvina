// Uživatelské nastavení (jen v tomto zařízení, localStorage)

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SettingsContext, type Settings } from './useSettings.ts'

const DEFAULTS: Settings = { theme: 'auto', rainMinTotal: 0.1, historySource: 'chmi' }
const KEY = 'pocasi-karvina:settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const s = JSON.parse(raw) as Partial<Settings>
    return {
      theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'auto',
      rainMinTotal: [0.1, 0.5, 1, 2].includes(s.rainMinTotal as number) ? (s.rainMinTotal as Settings['rainMinTotal']) : DEFAULTS.rainMinTotal,
      historySource: s.historySource === 'era5' ? 'era5' : 'chmi',
    }
  } catch {
    return DEFAULTS
  }
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY)
    const on = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)
  const systemDark = useSystemDark()
  const dark = settings.theme === 'auto' ? systemDark : settings.theme === 'dark'

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* soukromý režim apod. – nastavení platí jen do zavření */
      }
      return next
    })
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])

  const value = useMemo(() => ({ settings, update, dark }), [settings, update, dark])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
