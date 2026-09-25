/**
 * Pet mode of the real Electron app, main process included.
 *
 * With the Wintermute renderer, pet mode must be the compact window: small,
 * always on top, near the bottom-right corner, NEVER click-through (that is
 * what stranded the orb on Linux), draggable, resized when the input box is
 * toggled, remembered across restarts, and restored to the normal window on
 * the way back. Live2D keeps upstream's full-screen overlay.
 */
import {
  test, expect, _electron as electron, ElectronApplication, Page,
} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

type Bounds = { x: number; y: number; width: number; height: number };

async function launch(userDataDir: string, renderer: 'wintermute' | 'live2d' = 'wintermute') {
  const app = await electron.launch({
    args: [ROOT, '--no-sandbox', `--user-data-dir=${userDataDir}`],
    cwd: ROOT,
    env: { ...process.env },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((r) => {
    if (localStorage.getItem('avatarRenderer') !== JSON.stringify(r)) {
      localStorage.setItem('avatarRenderer', JSON.stringify(r));
      location.reload();
    }
  }, renderer);
  await page.waitForTimeout(1500);
  // Record every setIgnoreMouseEvents call the main process makes.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const g = globalThis as unknown as { ignoreCalls: boolean[] };
    g.ignoreCalls = [];
    const orig = w.setIgnoreMouseEvents.bind(w);
    w.setIgnoreMouseEvents = ((ignore: boolean, opts?: Electron.IgnoreMouseEventsOptions) => {
      g.ignoreCalls.push(ignore);
      return orig(ignore, opts);
    }) as typeof w.setIgnoreMouseEvents;
  });
  return { app, page };
}

const bounds = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
const onTop = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop());
const workArea = (app: ElectronApplication) => app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
const ignoreCalls = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { ignoreCalls: boolean[] }).ignoreCalls);

async function setMode(page: Page, mode: 'pet' | 'window') {
  await page.evaluate((m) => (window as unknown as { api: { setMode(x: string): void } }).api.setMode(m), mode);
  await page.waitForTimeout(1800); // upstream waits 500 ms, then React re-renders and re-measures
}

async function waitForBounds(app: ElectronApplication, pred: (b: Bounds) => boolean, ms = 5000): Promise<Bounds> {
  const end = Date.now() + ms;
  let b = await bounds(app);
  while (!pred(b) && Date.now() < end) {
    await new Promise((r) => { setTimeout(r, 100); });
    b = await bounds(app);
  }
  return b;
}

test.describe('compact pet window (Wintermute)', () => {
  let userData: string;

  test.beforeAll(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pet-'));
  });

  test.afterAll(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('enter, drag, resize, persist, leave', async () => {
    const { app, page } = await launch(userData);
    const windowed = await bounds(app);
    const wa = await workArea(app);

    await setMode(page, 'pet');
    await expect(page.locator('[data-testid="compact-pet"]')).toBeVisible();
    await expect(page.locator('[data-testid="compact-pet-orb"] [data-wintermute-canvas]')).toHaveCount(1);

    // Nothing opaque behind the orb: the page itself must be transparent.
    const backgrounds = await page.evaluate(() => [document.documentElement, document.body, document.getElementById('root')!]
      .map((el) => getComputedStyle(el).backgroundColor));
    for (const c of backgrounds) expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(c);

    // Small, on top, bottom-right, never click-through.
    const layout = await page.locator('[data-testid="compact-pet"]').boundingBox();
    const pet = await waitForBounds(app, (b) => b.width < 700);
    expect(pet.width).toBe(Math.ceil(layout!.width));
    expect(pet.height).toBe(Math.ceil(layout!.height));
    expect(pet.width).toBeLessThan(windowed.width);
    expect(await onTop(app)).toBe(true);
    expect(pet.x + pet.width).toBe(wa.x + wa.width - 24);
    expect(pet.y + pet.height).toBe(wa.y + wa.height - 24);
    expect(await ignoreCalls(app)).not.toContain(true);

    // Renderer hover reports and passthrough toggles must not make it click-through.
    await page.evaluate(() => {
      const api = (window as unknown as { api: Record<string, (...a: unknown[]) => void> }).api;
      api.updateComponentHover('input-subtitle', false);
      api.setIgnoreMouseEvents(true);
      api.toggleForceIgnoreMouse();
    });
    await page.waitForTimeout(300);
    expect(await ignoreCalls(app)).not.toContain(true);

    // Drag through the IPC the orb uses: the window follows the pointer delta.
    await page.evaluate(() => {
      const api = (window as unknown as { api: { petDrag(p: string, x?: number, y?: number): void } }).api;
      api.petDrag('start', 1000, 800);
      api.petDrag('move', 700, 600);
      api.petDrag('end');
    });
    const moved = await waitForBounds(app, (b) => b.x !== pet.x);
    expect(moved.x).toBe(pet.x - 300);
    expect(moved.y).toBe(pet.y - 200);

    // Dragging far off-screen is pulled back inside the work area.
    await page.evaluate(() => {
      const api = (window as unknown as { api: { petDrag(p: string, x?: number, y?: number): void } }).api;
      api.petDrag('start', 500, 500);
      api.petDrag('move', -5000, -5000);
      api.petDrag('end');
    });
    const clamped = await waitForBounds(app, (b) => b.x === wa.x && b.y === wa.y);
    expect(clamped.x).toBe(wa.x);
    expect(clamped.y).toBe(wa.y);

    // Real pointer drag on the orb (renderer -> IPC -> main). Keep the pointer's
    // screen position consistent while the window moves under it.
    await page.evaluate(() => {
      const api = (window as unknown as { api: { petDrag(p: string, x?: number, y?: number): void } }).api;
      api.petDrag('start', 0, 0); api.petDrag('move', 300, 200); api.petDrag('end');
    });
    const before = await waitForBounds(app, (b) => b.x === wa.x + 300);
    const orb = await page.locator('[data-testid="compact-pet-orb"]').boundingBox();
    const start = { x: orb!.x + orb!.width / 2, y: orb!.y + orb!.height / 2 };
    // Synthetic (CDP) mouse events report screenX === clientX (measured: a
    // window at x=333 got clientX 50 / screenX 50), whereas real pointer events
    // carry true screen coordinates from the display server. So drive the drag
    // in screen space directly: after pressing on the orb, every move is a
    // screen delta of (40, 25), and the window must follow it exactly.
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(start.x + i * 40, start.y + i * 25);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    const dragged = await waitForBounds(app, (b) => b.x === before.x + 400 && b.y === before.y + 250);
    expect({ x: dragged.x, y: dragged.y }).toEqual({ x: before.x + 400, y: before.y + 250 });

    // Hiding the input box shrinks the window around the orb's top-centre.
    const withInput = await bounds(app);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('toggle-input-subtitle'));
    const orbOnly = await waitForBounds(app, (b) => b.height < withInput.height);
    expect(orbOnly.width).toBe(240);
    expect(orbOnly.height).toBe(240);
    expect(orbOnly.y).toBe(withInput.y);
    expect(Math.abs((orbOnly.x + orbOnly.width / 2) - (withInput.x + withInput.width / 2))).toBeLessThanOrEqual(1);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('toggle-input-subtitle'));
    const restoredInput = await waitForBounds(app, (b) => b.height === withInput.height);
    expect(restoredInput.height).toBe(withInput.height);

    // Position persisted for the next launch.
    const stored = JSON.parse(fs.readFileSync(path.join(userData, 'wintermute-pet-window.json'), 'utf8'));
    const last = await bounds(app);
    expect(stored).toEqual(last);

    // Back to the normal window.
    await setMode(page, 'window');
    const back = await waitForBounds(app, (b) => b.width === windowed.width);
    expect(back).toEqual(windowed);
    expect(await onTop(app)).toBe(false);
    await app.close();

    // Next launch: pet mode comes back where it was left.
    const second = await launch(userData);
    await setMode(second.page, 'pet');
    const again = await waitForBounds(second.app, (b) => b.x === last.x && b.y === last.y);
    expect({ x: again.x, y: again.y }).toEqual({ x: last.x, y: last.y });
    await second.page.screenshot({ path: path.join(ROOT, 'screenshots', 'electron-compact-pet.png') }).catch(() => undefined);
    await second.app.close();
  });
});

test('Live2D keeps the upstream full-screen overlay', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pet-l2d-'));
  try {
    const { app, page } = await launch(userData, 'live2d');
    await setMode(page, 'pet');
    const b = await bounds(app);
    const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map((d) => d.bounds));
    const maxX = Math.max(...displays.map((d) => d.x + d.width));
    // Chromium on X11 keeps a frameless window 1 px short of the screen.
    expect(b.width).toBeGreaterThanOrEqual(maxX - Math.min(...displays.map((d) => d.x)) - 1);
    expect(await ignoreCalls(app)).toContain(true);
    await expect(page.locator('[data-testid="compact-pet"]')).toHaveCount(0);
    await app.close();
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
