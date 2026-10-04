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

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig(({ mode }) => {
    return {
      // Cross-origin izolace odemyká SharedArrayBuffer → vícevláknový WASM pro
      // lokální retuš (LaMa na jednom vlákně běží několikrát déle). "credentialless"
      // pouští cizí zdroje bez CORP hlaviček (Google Fonts, MediaPipe, Hugging Face).
      // Studio provozujeme lokálně; hlavičky posílají dev i preview server.
      server: {
        port: 3000,
        host: '127.0.0.1',
        headers: ISOLATION_HEADERS,
      },
      preview: {
        host: '127.0.0.1',
        headers: ISOLATION_HEADERS,
      },
      plugins: [
        react(),
        detectApiKeys(),
        VitePWA({
          registerType: 'autoUpdate',
          manifest: {
            name: 'FrameMind Studio',
            short_name: 'FrameMind',
            description: 'Fotostudio v prohlížeči — výběr, úpravy, lokální retuš štětcem, export',
            theme_color: '#09090d',
            background_color: '#09090d',
            display: 'standalone',
            icons: [
              { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            skipWaiting: true,
            clientsClaim: true,
            // WASM runtime ONNX (~25 MB) je nad limitem precache; cachuje se při
            // prvním použití retuše, aby pak šla offline. Modely si drží worker
            // sám v Cache Storage (fm-inpaint-models-v1).
            globIgnores: ['**/*.wasm'],
            runtimeCaching: [
              {
                urlPattern: /\.wasm$/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'fm-ort-wasm',
                  expiration: { maxEntries: 4 },
                  cacheableResponse: { statuses: [0, 200] },
                },
              },
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
