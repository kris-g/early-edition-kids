/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import {
  APP_DESCRIPTION,
  APP_NAME,
  APP_SHORT_NAME,
  BASE_PATH,
  THEME_DARK,
  THEME_LIGHT,
} from './src/config.ts'

// The server has two ports (CONTRACT.md): the dashboard API on 8081, the Kindle
// routes on 8080. The mock serves both on one port; `npm run dev:mock` points both here.
const DASHBOARD_API = process.env.EARLY_EDITION_KIDS_DASHBOARD_API ?? 'http://localhost:8081'
const KINDLE_API = process.env.EARLY_EDITION_KIDS_API ?? 'http://localhost:8080'

// Order matters: the first matching prefix wins.
const proxy = {
  '/api/dashboard': { target: DASHBOARD_API, changeOrigin: false },
  '/api': { target: KINDLE_API, changeOrigin: false },
}

/** Fill %APP_NAME% and friends in index.html from src/config.ts, so the name lives in one place. */
function htmlConstants(): Plugin {
  const values: Record<string, string> = {
    APP_NAME,
    APP_SHORT_NAME,
    APP_DESCRIPTION,
    THEME_LIGHT,
    THEME_DARK,
  }
  return {
    name: 'early-edition-html-constants',
    transformIndexHtml: (html) => html.replace(/%(\w+)%/g, (m, key: string) => values[key] ?? m),
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: BASE_PATH,
  server: { proxy },
  preview: { proxy },
  plugins: [
    react(),
    tailwindcss(),
    htmlConstants(),
    VitePWA({
      registerType: 'autoUpdate',
      // The dashboard sits behind Authelia. Browsers fetch the manifest without
      // cookies unless told otherwise, get Authelia's login redirect instead, and
      // invent a home-screen name and icon. Send the sign-in cookie with it.
      useCredentials: true,
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // App shell: everything Vite emits plus the icons.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        // Navigations are NOT answered from the precache. They go to the network
        // first, so an expired Authelia session redirects to its sign-in page
        // instead of showing a stale shell; offline, the cached shell is used.
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request, sameOrigin }) => sameOrigin && request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'early-edition-pages',
              // Only real pages; Authelia's redirects (opaque, status 0) are never stored.
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 20 },
              // Offline and never visited: fall back to the precached app shell.
              precacheFallback: { fallbackURL: `${BASE_PATH}index.html` },
            },
          },
          {
            // Dashboard reads: network first, fall back to the last copy when offline.
            // Only GETs, never job polling, and nothing outside /api/dashboard/
            // (so the Kindle's /api/issue/* and /issues/* are untouched). The page
            // fetches with redirect: 'manual', so an Authelia redirect arrives as an
            // opaque response with status 0: statuses [200] keeps it out of the cache.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin &&
              url.pathname.startsWith('/api/dashboard/') &&
              !url.pathname.startsWith('/api/dashboard/jobs/'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'early-edition-api',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 14 * 24 * 60 * 60 },
            },
          },
        ],
      },
      manifest: {
        id: BASE_PATH,
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: APP_DESCRIPTION,
        lang: 'en-GB',
        theme_color: THEME_LIGHT,
        background_color: THEME_LIGHT,
        display: 'standalone',
        start_url: BASE_PATH,
        scope: BASE_PATH,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
