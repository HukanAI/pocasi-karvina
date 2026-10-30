// Instalace PWA: zachytí výzvu prohlížeče (beforeinstallprompt) co nejdřív po startu,
// aby ji šlo vyvolat vlastním tlačítkem. Import tohoto modulu musí být v main.tsx.

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let justInstalled = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Potlačí výchozí lištu prohlížeče, výzvu vyvoláme tlačítkem
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    justInstalled = true
    notify()
  })
}

export type Platform = 'ios' | 'android' | 'desktop'

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  // iPadOS se hlásí jako Mac, ale má dotykovou obrazovku
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export type InstallState =
  /** Aplikace právě běží jako nainstalovaná (z plochy) */
  | 'installed'
  /** Právě nainstalováno v tomto okně */
  | 'just-installed'
  /** Prohlížeč nabízí instalaci – stačí klepnout na tlačítko */
  | 'can-prompt'
  /** iPhone/iPad: instalace jen ručně přes Sdílet → Přidat na plochu */
  | 'ios-manual'
  /** Prohlížeč instalaci (zatím) nenabídl – čekáme */
  | 'waiting'
  /** Prohlížeč instalaci nenabízí (typicky už nainstalováno, nebo nepodporovaný prohlížeč) */
  | 'unavailable'

/** Jak dlouho čekat na výzvu prohlížeče, než ukážeme náhradní postup */
const WAIT_MS = 4000

export function useInstall() {
  const [, force] = useState(0)
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    const t = setTimeout(() => setWaited(true), WAIT_MS)
    return () => {
      listeners.delete(l)
      clearTimeout(t)
    }
  }, [])

  const platform = detectPlatform()
  let state: InstallState
  if (isStandalone()) state = 'installed'
  else if (justInstalled) state = 'just-installed'
  else if (deferred) state = 'can-prompt'
  else if (platform === 'ios') state = 'ios-manual'
  else state = waited ? 'unavailable' : 'waiting'

  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const ev = deferred
    if (!ev) return 'unavailable'
    await ev.prompt()
    const { outcome } = await ev.userChoice
    // Výzvu lze použít jen jednou
    deferred = null
    notify()
    return outcome
  }

  return { state, platform, install }
}
