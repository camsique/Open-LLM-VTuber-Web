// Headless screenshots of the Wintermute dev harness, one per state.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173/index.html?page=wintermute-dev';
const OUT = process.env.OUT ?? 'screenshots/wintermute';
const only = process.argv[2] ? process.argv[2].split(',') : null;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1320, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(BASE);
await page.waitForSelector('[data-wintermute-canvas]', { timeout: 15000 });
await page.waitForFunction(() => !!window.WintermuteDebug, null, { timeout: 15000 });
await page.waitForTimeout(600);

const stats = await page.evaluate(() => window.WintermuteDebug.getStats());
console.log('stats', JSON.stringify(stats));

const shots = [
  ['idle', { state: 'idle' }],
  ['listening', { state: 'listening' }],
  ['waiting', { state: 'waiting' }],
  ['thinking', { state: 'thinking', t: 1.2 }],
  ['working', { state: 'working', tool: 'web', t: 1.0 }],
  ['speaking-020', { state: 'speaking', rms: 0.2 }],
  ['speaking-050', { state: 'speaking', rms: 0.5 }],
  ['speaking-090', { state: 'speaking', rms: 0.9 }],
  ['approval', { state: 'approval' }],
  ['complete', { state: 'complete', sinceMs: 450 }],
  ['error', { state: 'error' }],
  ['interrupted', { state: 'interrupted', sinceMs: 130 }],
  ['loading', { state: 'loading', t: 2.0 }],
  ['idle-reduced', { state: 'idle', reduced: true }],
];

async function setup(spec) {
  await page.evaluate((s) => {
    const D = window.WintermuteDebug;
    D.clearOverride();
    D.setRms(s.rms ?? 0);
    D.setTool(s.tool ? `${s.tool}-tool` : null, s.tool);
    D.setReducedMotion(!!s.reduced);
    D.setState(s.state, s.sinceMs ?? 0);
    D.setTimeOverride(s.t ?? 3.0);
  }, spec);
  await page.waitForTimeout(80);
}

for (const [name, spec] of shots) {
  if (only && !only.includes(name)) continue;
  await setup(spec);
  await page.waitForTimeout(120);
  const stage = page.locator('[data-testid="wintermute-stage"]');
  await stage.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

// Backdrops and viewports for idle.
for (const backdrop of ['light', 'dark', 'wallpaper']) {
  if (only && !only.includes(`idle-${backdrop}`)) continue;
  await page.selectOption('select >> nth=2', backdrop);
  await setup({ state: 'idle' });
  await page.waitForTimeout(150);
  await page.locator('[data-testid="wintermute-stage"]').screenshot({ path: `${OUT}/idle-${backdrop}.png` });
  console.log('shot', `idle-${backdrop}`);
}
await page.selectOption('select >> nth=2', 'checker');
for (const aspect of ['portrait', 'narrow', 'square']) {
  if (only && !only.includes(`idle-${aspect}`)) continue;
  await page.selectOption('select >> nth=3', aspect);
  await setup({ state: 'idle' });
  await page.waitForTimeout(250);
  await page.locator('[data-testid="wintermute-stage"]').screenshot({ path: `${OUT}/idle-${aspect}.png` });
  console.log('shot', `idle-${aspect}`);
}

// Live (unfrozen) frame count sanity: does the loop run?
await page.evaluate(() => window.WintermuteDebug.setTimeOverride(null));
const f1 = (await page.evaluate(() => window.WintermuteDebug.getStats())).frames;
await page.waitForTimeout(1000);
const f2 = (await page.evaluate(() => window.WintermuteDebug.getStats())).frames;
console.log(`live frames in 1s: ${f2 - f1}`);
await browser.close();
