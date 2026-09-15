import { defineConfig } from 'vitest/config';
import path from 'path';

// Unit tests are pure TypeScript (no DOM): state machines, envelope math,
// config validation. Keep them under src/renderer/src/**/__tests__.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/renderer/src/**/*.test.ts'],
  },
});
