import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const detectApiKeys = () => ({
  name: 'detect-api-keys',
  transform(code: string, id: string) {
    if (id.includes('node_modules')) return null;
    if (code.includes('AIzaSy')) {
      // eslint-disable-next-line no-console
      console.error('⚠️ WARNING: Possible hardcoded API key detected in', id);
    }
    return null;
  },
});

export default defineConfig(({ mode }) => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        detectApiKeys(),
        VitePWA({
          registerType: 'autoUpdate',
          manifest: {
            name: 'FrameMind Studio',
            short_name: 'FrameMind',
            description: 'AI fotostudio pro fotografy — žánrový culling, úpravy, RAW, galerie',
            theme_color: '#0a0a0a',
            background_color: '#0a0a0a',
            display: 'standalone',
            icons: [
              { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            ],
          },
          workbox: {
            skipWaiting: true,
            clientsClaim: true,
            runtimeCaching: [
              {
                urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'google-fonts-cache',
                  expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                  cacheableResponse: { statuses: [0, 200] },
                },
              },
              {
                urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'gstatic-fonts-cache',
                  expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                  cacheableResponse: { statuses: [0, 200] },
                },
              },
            ],
          },
        }),
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        sourcemap: false,
        rollupOptions: {
          output: {
            manualChunks: {
              vendor: ['react', 'react-dom'],
              motion: ['framer-motion'],
            },
          },
        },
      },
    };
});
