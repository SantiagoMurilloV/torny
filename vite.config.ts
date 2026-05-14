import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    VitePWA({
      // InjectManifest lets us ship our own service worker (src/sw.ts) that
      // adds `push` + `notificationclick` listeners on top of the Workbox
      // precache. That's what enables real push notifications on Android
      // Chrome / desktop Firefox and iOS 16.4+ (installed PWA).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,eot}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      includeAssets: ['icon-192.png', 'icon-512.png', 'spk-cup-logo-v4.svg', 'spk-cup-logo-horizontal.svg'],
      manifest: {
        name: 'Torny — Sistema de Torneos',
        short_name: 'Torny',
        description: 'Plataforma para organizar torneos deportivos: inscripciones, programación, marcadores en vivo y estadísticas.',
        start_url: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#E31E24',
        // "any" lets the installed PWA respect the phone's own rotation
        // setting — admins in kiosk mode want landscape for the referee
        // console, spectators often flip their phone to see the bracket
        // wider. Previously this was locked to portrait-primary which
        // ignored the OS rotation toggle entirely.
        orientation: 'any',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    proxy: {
      // Backend lives on 3001 (server/src/index.ts: `const PORT = ... : 3001;`).
      // Vite proxies /api/* to it so dev frontend at :5173 can reach the
      // Express server without CORS gymnastics. If you change the backend
      // PORT env var, update this target too.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },

  build: {
    // Split heavy vendor dependencies into named chunks so one big "index.js"
    // doesn't dominate the bundle. Keep groups focused to improve cache hit rate.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-motion': ['motion'],
          'vendor-mui': ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          'vendor-charts': ['recharts'],
          'vendor-icons': ['lucide-react'],
          'vendor-dates': ['date-fns'],
        },
      },
    },
    // Raise warning threshold slightly since lazy routes + chunking keep
    // individual chunks well-sized; we don't want to chase false positives.
    chunkSizeWarningLimit: 600,
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
