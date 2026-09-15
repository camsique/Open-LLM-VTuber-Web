// End-to-end check against a running Open-LLM-VTuber backend (default
// localhost:12393): loads the built web app with the given renderer, sends one
// short message and records vessel state transitions + speech envelope.
// Usage: node scripts/wintermute-e2e.mjs [wintermute|live2d] [message]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const renderer = process.argv[2] ?? 'wintermute';
const message = process.argv[3] ?? 'Vessel build check: reply with one short sentence.';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4173/index.html';
const WS = process.env.WS ?? 'ws://127.0.0.1:12393/client-ws';
const HTTP = process.env.HTTP ?? 'http://127.0.0.1:12393';
const OUT = process.env.OUT ?? 'screenshots/e2e';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleLines = [];
page.on('console', (m) => {
  const text = m.text();
  if (/audio-playback|wintermute|Live2D|error/i.test(text)) consoleLines.push(`${m.type()}: ${text}`);
});
page.on('pageerror', (e) => consoleLines.push(`PAGEERROR: ${e.message}`));
await page.addInitScript(({ ws, http, r }) => {
  localStorage.setItem('wsUrl', JSON.stringify(ws));
  localStorage.setItem('baseUrl', JSON.stringify(http));
  localStorage.setItem('avatarRenderer', JSON.stringify(r));
  localStorage.setItem('wintermuteDebug', '1');
}, { ws: WS, http: HTTP, r: renderer });

await page.goto(BASE);
await page.waitForTimeout(1500);
const hasWintermute = await page.locator('[data-testid="wintermute-canvas"]').count();
const hasLive2D = await page.locator('#live2d-internal-wrapper').count();
console.log(`renderer=${renderer} wintermuteCanvas=${hasWintermute} live2dWrapper=${hasLive2D}`);

// Vessel state probe: the stats overlay (wintermute) or a DOM poll (live2d).
let stateProbe;
if (renderer === 'wintermute') {
  await page.waitForFunction(() => !!window.WintermuteDebug, null, { timeout: 15000 });
  await page.evaluate(() => window.WintermuteDebug.showStats(true));
  stateProbe = async () => {
    const t = await page.locator('[data-testid="wintermute-stats"]').textContent().catch(() => '');
    const m = /state (\S+)\s+rms ([\d.]+)/.exec(t ?? '');
    return m ? { state: m[1], rms: Number(m[2]) } : null;
  };
} else {
  stateProbe = async () => null;
}

// Wait for the backend handshake (loading → idle) up to 20 s.
const t0 = Date.now();
const transitions = [];
let last = null;
let maxRms = 0;
let sawSpeaking = false;
async function poll() {
  const s = await stateProbe();
  if (s) {
    maxRms = Math.max(maxRms, s.rms);
    if (s.state === 'speaking') sawSpeaking = true;
    if (s.state !== last) {
      transitions.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s.state}`);
      last = s.state;
      if (s.state === 'speaking') {
        await page.locator('[data-testid="wintermute-canvas"]').screenshot({ path: `${OUT}/${renderer}-speaking.png` }).catch(() => {});
      }
    }
  }
}
for (let i = 0; i < 100; i += 1) {
  await poll();
  if (last && last !== 'loading') break;
  await page.waitForTimeout(200);
}
const wsText = await page.locator('body').textContent();
console.log(`ws status text present: ${/connected/i.test(wsText ?? '')}`);

// Send the message through the footer input.
const input = page.locator('textarea').first();
await input.waitFor({ timeout: 10000 });
await input.fill(message);
await input.press('Enter');
console.log('message sent');

// Observe up to 60 s, stop 3 s after we return to idle following speech.
let idleSince = null;
for (let i = 0; i < 300; i += 1) {
  await poll();
  if (sawSpeaking && last === 'idle') {
    idleSince = idleSince ?? Date.now();
    if (Date.now() - idleSince > 3000) break;
  } else {
    idleSince = null;
  }
  await page.waitForTimeout(200);
}
await page.screenshot({ path: `${OUT}/${renderer}-final.png` });

// What did the chat show?
const chat = await page.locator('body').textContent();
const replied = /Vessel build check/i.test(chat ?? '');
console.log('transitions:', transitions.join(' → ') || '(no probe)');
console.log(`sawSpeaking=${sawSpeaking} maxRms=${maxRms.toFixed(2)} chatContainsPrompt=${replied}`);
console.log('--- console (filtered):');
consoleLines.slice(0, 40).forEach((l) => console.log('  ', l));
await browser.close();
