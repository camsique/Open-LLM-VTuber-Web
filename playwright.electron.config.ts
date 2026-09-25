import { defineConfig } from '@playwright/test';

// Drives the built Electron app (npx electron-vite build first). Needs an X
// display: a real desktop, or a virtual one, e.g. `Xvfb :97 &` + DISPLAY=:97.
export default defineConfig({
  testDir: 'tests/electron',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
});
