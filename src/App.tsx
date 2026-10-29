import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav } from './components/BottomNav.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { LoadingCard } from './components/ui.tsx'
import { WeatherBackground } from './components/WeatherBackground.tsx'
import { LOCATION } from './config.ts'
import { formatAgo } from './lib/time.ts'
import TodayPage from './pages/TodayPage.tsx'
import { useNow, useSky } from './state/derived.ts'
import { useForecast } from './state/queries.ts'
import { useSettings } from './state/useSettings.ts'

// Méně používané záložky se načítají až při otevření (grafy a mapa jsou velké)
const ForecastPage = lazy(() => import('./pages/ForecastPage.tsx'))
const RadarPage = lazy(() => import('./pages/RadarPage.tsx'))
const AirPage = lazy(() => import('./pages/AirPage.tsx'))
const HistoryPage = lazy(() => import('./pages/HistoryPage.tsx'))
const SettingsPage = lazy(() => import('./pages/SettingsPage.tsx'))

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

function Header({ now }: { now: number }) {
  const forecast = useForecast()
  const online = useOnline()
  const { pathname } = useLocation()
  return (
    <header className="relative z-20 mx-auto flex max-w-xl items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2">
      <div>
        <h1 className="flex items-center gap-1.5 text-lg font-semibold">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
          </svg>
          {LOCATION.name}
        </h1>
        <p className="text-xs text-muted">
          {!online ? (
            <span className="font-medium text-amber-700 dark:text-amber-300">Offline · </span>
          ) : null}
          {forecast.dataUpdatedAt ? `Aktualizováno ${formatAgo(forecast.dataUpdatedAt, now)}` : 'Načítám…'}
          {forecast.isFetching && online ? ' · obnovuji…' : ''}
        </p>
      </div>
      {pathname !== '/nastaveni' && (
        <Link to="/nastaveni" className="glass rounded-full p-2" aria-label="Nastavení">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
          </svg>
        </Link>
      )}
    </header>
  )
}

export default function App() {
  const now = useNow(60_000)
  const { dark } = useSettings()
  const { sky, phase, intensity } = useSky(now)
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  // Barva stavového řádku podle motivu
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1a33' : '#5b8fd0')
  }, [dark])

  return (
    <>
      <WeatherBackground sky={sky} phase={phase} dark={dark} intensity={intensity} />
      <div className="relative z-10 min-h-dvh pb-[calc(76px+env(safe-area-inset-bottom))]">
        <Header now={now} />
        <main className="mx-auto max-w-xl px-4">
          <ErrorBoundary key={pathname}>
          <Suspense fallback={<LoadingCard lines={5} />}>
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/predpoved" element={<ForecastPage />} />
              <Route path="/radar" element={<RadarPage />} />
              <Route path="/ovzdusi" element={<AirPage />} />
              <Route path="/historie" element={<HistoryPage />} />
              <Route path="/nastaveni" element={<SettingsPage />} />
              <Route path="*" element={<TodayPage />} />
            </Routes>
          </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <BottomNav />
    </>
  )
}
