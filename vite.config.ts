/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const BASE = '/pocasi-karvina/'

// https://vite.dev/config/
export default defineConfig({
  base: BASE,
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
            // Předpočítaná data z data větve (klimatologie, měření ČHMÚ, výstrahy)
            urlPattern: ({ url }) => url.hostname === 'raw.githubusercontent.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'data-branch', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            // Podkladová mapa a radarové dlaždice
            urlPattern: ({ url }) =>
              url.hostname.endsWith('basemaps.cartocdn.com') || url.hostname === 'tilecache.rainviewer.com',
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 7 } },
          },
        ],
      },
    }),
  ],
  build: {
    // ECharts (~700 kB) je záměrně samostatný líně načítaný kus
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
