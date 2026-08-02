import { defineConfig } from 'vitest/config';

// Samostatný config — vite.config.ts s PWA pluginem se pro testy nespouští.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
