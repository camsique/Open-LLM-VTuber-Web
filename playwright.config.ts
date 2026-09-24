import { defineConfig } from '@playwright/test';

// Visual/behavioural tests for the Wintermute renderer. They run against the
// built web bundle (npm run build:web) served on :4173 and use software GL,
// so they work headless on a box without a display.
export default defineConfig({
  testDir: 'tests/visual',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFileName}/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1320, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    // --host: vite binds 'localhost', which resolves to ::1 only on this Node, so
    // 127.0.0.1 never answered and the server always timed out.
    command: 'npx vite preview --config vite.config.ts --mode web --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
