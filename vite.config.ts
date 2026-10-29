/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const BASE = '/pocasi-karvina/'

// https://vite.dev/config/
// Verze = datum sestavení (zobrazuje se v nastavení)
const VERSION = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  base: BASE,
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Počasí Karviná',
        short_name: 'Počasí KA',
        description: 'Detailní počasí, předpověď a klimatická historie pro Karvinou',
        lang: 'cs',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b1a33',
        theme_color: '#0b1a33',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Čeština potřebuje jen latin a latin-ext, ostatní sady písma necháme na vyžádání
        globIgnores: ['**/inter-{vietnamese,greek,greek-ext,cyrillic,cyrillic-ext}-*.woff2', 'dev-data/**'],
        navigateFallback: `${BASE}index.html`,
        runtimeCaching: [
          {
            // Předpočítaná data z data větve (měření ČHMÚ, výstrahy, klimatologie).
            // NetworkFirst: vždy nejčerstvější data, cache jen když síť nedopoví (StaleWhileRevalidate by vracel starou verzi)
            urlPattern: ({ url }) => url.hostname === 'raw.githubusercontent.com',
            handler: 'NetworkFirst',
            options: { cacheName: 'data-branch', networkTimeoutSeconds: 8, expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            // Podkladová mapa a radarové dlaždice
            urlPattern: ({ url }) =>
              url.hostname === 'server.arcgisonline.com' || url.hostname === 'tilecache.rainviewer.com',
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 7 } },
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    // Líně načítané knihovny předoptimalizovat hned, jinak je dev server objeví až za běhu (chyba 504)
    include: ['leaflet', 'suncalc', 'echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
  },
  build: {
    // ECharts (~700 kB) je záměrně samostatný líně načítaný kus
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
