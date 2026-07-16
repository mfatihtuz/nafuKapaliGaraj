import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Uygulama sunucuda public_html/depo_yonetimi/ altında yaşar.
const BASE = '/depo_yonetimi/'

// https://vitejs.dev/config/
export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'robots.txt'],
      manifest: {
        name: 'DEPO — Garaj Envanteri',
        short_name: 'DEPO',
        description: 'Offline-first elektronik parça / atölye envanteri',
        lang: 'tr',
        dir: 'ltr',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#14213d',
        background_color: '#000000',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Uygulama kabuğu + varlıklar precache; API (sync) ASLA cache'lenmez
        // (offline daima IndexedDB'den okunur — ARCHITECTURE §1).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/api\//],
        cleanupOutdatedCaches: true,
        // İSTİSNA: /api/files/* ikili ek baytı içerik-adreslidir (sha256) ve immutable —
        // CacheFirst ile SW'ye alınır → ilk görüntülemeden sonra ÇEVRİMDIŞI açılır (bulgu #8).
        // Yalnızca /files; /sync ve diğer uçlar cache DIŞI kalır (LWW/no-store bozulmaz).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/api/files/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'depo-attachments',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 60 }, // 60 gün
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Geliştirmede PHP built-in sunucusuna yönlendir: php -S localhost:8000 -t api/public
      '/depo_yonetimi/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/depo_yonetimi/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2021',
  },
})
