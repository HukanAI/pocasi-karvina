import '@fontsource-variable/inter'
import './index.css'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import { SettingsProvider } from './state/settings.tsx'

const WEEK = 7 * 24 * 3_600_000

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: WEEK, // uložená data musí v cache přežít, aby šla obnovit offline
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})

// Persistence do IndexedDB; při chybě úložiště (soukromý režim) aplikace funguje dál bez offline dat
const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (k) => {
      try {
        return (await get<string>(k)) ?? null
      } catch {
        return null
      }
    },
    setItem: async (k, v) => {
      try {
        await set(k, v)
      } catch {
        /* úložiště není dostupné */
      }
    },
    removeItem: async (k) => {
      try {
        await del(k)
      } catch {
        /* úložiště není dostupné */
      }
    },
  },
  key: 'pocasi-karvina:queries',
  throttleTime: 2000,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: WEEK, buster: 'v1' }}>
      <SettingsProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </SettingsProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)
