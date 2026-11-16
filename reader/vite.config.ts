/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'

// The server serves the built reader at <mount>/read/ on the Kindle port (CONTRACT.md "iPad reader"),
// for the root profile and every /p/<id>/ mount, so every path is relative: one build fits every mount.
// In development Vite serves it at / and proxies the Kindle routes to the server.
const KINDLE_API = process.env.EARLY_EDITION_KIDS_API ?? 'http://localhost:8080'
const proxy = {
  '/api': { target: KINDLE_API, changeOrigin: false },
  '/issues': { target: KINDLE_API, changeOrigin: false },
}

/** The server puts the profile's title in place of __EEK_TITLE__; in development, use the default. */
function devTitle(): Plugin {
  return {
    name: 'early-edition-reader-dev-title',
    apply: 'serve',
    transformIndexHtml: (html) => html.replaceAll('__EEK_TITLE__', 'Early Edition'),
  }
}

export default defineConfig({
  base: './',
  plugins: [devTitle()],
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 5174, proxy },
  build: {
    // iPadOS 15 and later.
    target: ['safari15', 'es2020'],
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
