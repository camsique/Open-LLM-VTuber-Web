/**
 * Deterministic checks of the rendered orb: every state renders, corners
 * stay transparent, no light spills off the surface, the band is one
 * continuous horizontal ice-blue element, speech stays within its limits
 * and error never turns red. Plus pixel snapshots for the core states.
 */
import { test, expect, Page } from '@playwright/test';

type Spec = {
  state: string; rms?: number; tool?: string; reduced?: boolean; t?: number; sinceMs?: number;
};

interface Analysis {
  width: number;
  height: number;
  cornersTransparent: boolean;
  orb: { cx: number; cy: number; r: number } | null;
  spillPixels: number;
  band: {
    row: number;
    left: number;
    right: number;
    maxGap: number;
    tiltPx: number;
    heightPx: number;
    peakLuma: number;
    mean: { r: number; g: number; b: number };
  } | null;
}

declare global {
  interface Window {
    WintermuteDebug: {
      clearOverride(): void;
      setState(state: string, elapsedMs?: number): void;
      setRms(v: number): void;
      setTool(name: string | null, category?: string): void;
      setReducedMotion(v: boolean): void;
      setTimeOverride(t: number | null): void;
      getStats(): { fps: number; frames: number; contextLost: boolean } | null;
      captureFrame(): Promise<Blob>;
    };
  }
}

async function openHarness(page: Page): Promise<void> {
  await page.goto('/index.html?page=wintermute-dev');
  await page.waitForSelector('[data-wintermute-canvas]');
  await page.waitForFunction(() => !!window.WintermuteDebug);
  await page.waitForTimeout(300);
}

async function setup(page: Page, spec: Spec): Promise<void> {
  await page.evaluate((s) => {
    const D = window.WintermuteDebug;
    D.clearOverride();
    D.setRms(s.rms ?? 0);
    D.setTool(s.tool ? `${s.tool}-tool` : null, s.tool);
    D.setReducedMotion(!!s.reduced);
    D.setState(s.state, s.sinceMs ?? 0);
    D.setTimeOverride(s.t ?? 3.0);
  }, spec);
  await page.waitForTimeout(120);
}

/**
 * Read the frame back and measure it. The drawing buffer is not preserved
 * between frames, so we go through captureFrame(), which renders and reads
 * back in one tick.
 */
async function analyze(page: Page): Promise<Analysis> {
  return page.evaluate(async () => {
    const blob = await window.WintermuteDebug.captureFrame();
    const bmp = await createImageBitmap(blob);
    const w = bmp.width;
    const h = bmp.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    const at = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
    };
    const luma = (p: { r: number; g: number; b: number }) => (0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b) / 255;

    const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
    const cornersTransparent = corners.every((p) => p.a === 0);

    // Orb bounds from opaque pixels.
    let minX = w; let maxX = -1; let minY = h; let maxY = -1;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        if (at(x, y).a > 8) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    const orb = maxX >= 0
      ? { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, r: Math.max(maxX - minX, maxY - minY) / 2 }
      : null;

    // Light outside the orb silhouette (there should be none: no bloom).
    let spillPixels = 0;
    if (orb) {
      const limit = orb.r * 1.03;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const dx = x - orb.cx; const dy = y - orb.cy;
          if (dx * dx + dy * dy > limit * limit) {
            const p = at(x, y);
            if (p.a > 8 && luma(p) > 0.25) spillPixels += 1;
          }
        }
      }
    }

    // Band: the brightest row inside the orb, then its horizontal run.
    let band: Analysis['band'] = null;
    if (orb) {
      let bestRow = -1; let bestSum = 0;
      const rowSums: number[] = [];
      for (let y = Math.floor(orb.cy - orb.r); y <= Math.ceil(orb.cy + orb.r); y += 1) {
        let sum = 0;
        for (let x = Math.floor(orb.cx - orb.r); x <= Math.ceil(orb.cx + orb.r); x += 1) {
          if (x < 0 || x >= w || y < 0 || y >= h) continue;
          sum += luma(at(x, y));
        }
        rowSums[y] = sum;
        if (sum > bestSum) { bestSum = sum; bestRow = y; }
      }
      if (bestRow >= 0) {
        let peak = 0;
        for (let x = 0; x < w; x += 1) peak = Math.max(peak, luma(at(x, bestRow)));
        const thr = peak * 0.5;
        const bright: number[] = [];
        for (let x = 0; x < w; x += 1) if (luma(at(x, bestRow)) >= thr) bright.push(x);
        const left = bright[0]; const right = bright[bright.length - 1];
        let maxGap = 0;
        for (let i = 1; i < bright.length; i += 1) maxGap = Math.max(maxGap, bright[i] - bright[i - 1] - 1);
        // Tilt: brightest row at the left quarter vs the right quarter of the band.
        const colPeakRow = (x: number) => {
          let br = -1; let bl = 0;
          for (let y = Math.floor(orb!.cy - orb!.r); y <= Math.ceil(orb!.cy + orb!.r); y += 1) {
            const l = luma(at(x, y));
            if (l > bl) { bl = l; br = y; }
          }
          return br;
        };
        const xl = Math.round(left + (right - left) * 0.25);
        const xr = Math.round(left + (right - left) * 0.75);
        const tiltPx = Math.abs(colPeakRow(xl) - colPeakRow(xr));
        // Height at the centre column: rows >= 50% of the column peak.
        const xc = Math.round((left + right) / 2);
        let colPeak = 0;
        for (let y = 0; y < h; y += 1) colPeak = Math.max(colPeak, luma(at(xc, y)));
        let heightPx = 0;
        for (let y = 0; y < h; y += 1) if (luma(at(xc, y)) >= colPeak * 0.5) heightPx += 1;
        let sr = 0; let sg = 0; let sb = 0; let n = 0;
        for (let x = left; x <= right; x += 1) {
          const p = at(x, bestRow);
          if (luma(p) >= thr) { sr += p.r; sg += p.g; sb += p.b; n += 1; }
        }
        band = {
          row: bestRow, left, right, maxGap, tiltPx, heightPx, peakLuma: peak,
          mean: { r: sr / n, g: sg / n, b: sb / n },
        };
      }
    }
    return { width: w, height: h, cornersTransparent, orb, spillPixels, band };
  });
}

const STATES = ['idle', 'listening', 'waiting', 'thinking', 'working', 'speaking', 'approval', 'complete', 'error', 'interrupted', 'loading'];

test.describe('Wintermute renderer', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test('renders every state with transparent corners and no light spill', async ({ page }) => {
    for (const state of STATES) {
      await setup(page, { state, rms: state === 'speaking' ? 0.6 : 0, tool: state === 'working' ? 'web' : undefined, sinceMs: 300 });
      const a = await analyze(page);
      expect(a.orb, state).not.toBeNull();
      expect(a.cornersTransparent, `${state}: corners`).toBe(true);
      expect(a.spillPixels, `${state}: spill`).toBeLessThan(20);
      expect(a.band, `${state}: band`).not.toBeNull();
      expect(a.band!.maxGap, `${state}: band continuity`).toBeLessThanOrEqual(3);
    }
    const stats = await page.evaluate(() => window.WintermuteDebug.getStats());
    expect(stats?.contextLost).toBe(false);
  });

  test('idle: one continuous, horizontal, ice-blue band', async ({ page }) => {
    await setup(page, { state: 'idle' });
    const a = await analyze(page);
    const b = a.band!;
    expect(b.maxGap).toBeLessThanOrEqual(2);
    expect(b.tiltPx).toBeLessThanOrEqual(2);
    expect(b.right - b.left).toBeGreaterThan(a.orb!.r * 0.9); // spans most of the face
    expect(b.mean.b).toBeGreaterThan(b.mean.r * 1.3); // blue dominates, no amber cast
    expect(b.mean.b).toBeGreaterThan(150);
    expect(b.heightPx).toBeLessThan(a.orb!.r * 0.2); // a band, not a visor
  });

  test('listening tilts the band slightly, still one band', async ({ page }) => {
    await setup(page, { state: 'idle' });
    const idle = (await analyze(page)).band!;
    await setup(page, { state: 'listening' });
    const listening = (await analyze(page)).band!;
    expect(listening.tiltPx).toBeGreaterThan(idle.tiltPx);
    expect(listening.tiltPx).toBeLessThan(a11yTiltLimit(listening));
    expect(listening.maxGap).toBeLessThanOrEqual(3);
  });

  test('speech widens and brightens the band within limits, amber stays subordinate', async ({ page }) => {
    await setup(page, { state: 'idle' });
    const idle = (await analyze(page)).band!;
    await setup(page, { state: 'speaking', rms: 0.9 });
    const loud = (await analyze(page)).band!;
    expect(loud.heightPx).toBeGreaterThanOrEqual(idle.heightPx);
    expect(loud.heightPx).toBeLessThanOrEqual(idle.heightPx * 1.3 + 2);
    expect(loud.peakLuma).toBeGreaterThan(idle.peakLuma);
    expect(loud.peakLuma).toBeLessThanOrEqual(idle.peakLuma * 1.35);
    expect(loud.mean.b).toBeGreaterThan(loud.mean.r); // still blue
    await setup(page, { state: 'speaking', rms: 0.2 });
    const quiet = (await analyze(page)).band!;
    expect(quiet.heightPx).toBeLessThanOrEqual(loud.heightPx);
  });

  test('error dims and desaturates, never red', async ({ page }) => {
    await setup(page, { state: 'idle' });
    const idle = (await analyze(page)).band!;
    await setup(page, { state: 'error' });
    const err = (await analyze(page)).band!;
    expect(err.peakLuma).toBeLessThan(idle.peakLuma);
    expect(err.mean.r).toBeLessThan(err.mean.b); // not red
    const sat = (p: { r: number; g: number; b: number }) => (Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b)) / Math.max(1, Math.max(p.r, p.g, p.b));
    expect(sat(err.mean)).toBeLessThan(sat(idle.mean));
  });

  test('reduced motion still renders every state', async ({ page }) => {
    for (const state of ['idle', 'thinking', 'working', 'speaking']) {
      await setup(page, { state, reduced: true, rms: 0.5 });
      const a = await analyze(page);
      expect(a.band, state).not.toBeNull();
      expect(a.cornersTransparent).toBe(true);
    }
  });

  test('live loop runs when not frozen', async ({ page }) => {
    await page.evaluate(() => window.WintermuteDebug.setTimeOverride(null));
    const f1 = (await page.evaluate(() => window.WintermuteDebug.getStats()))!.frames;
    await page.waitForTimeout(700);
    const f2 = (await page.evaluate(() => window.WintermuteDebug.getStats()))!.frames;
    expect(f2 - f1).toBeGreaterThan(10);
  });

  for (const [name, spec] of [
    ['idle', { state: 'idle' }],
    ['listening', { state: 'listening' }],
    ['thinking', { state: 'thinking', t: 1.2 }],
    ['speaking-090', { state: 'speaking', rms: 0.9 }],
    ['error', { state: 'error' }],
  ] as Array<[string, Spec]>) {
    test(`snapshot: ${name}`, async ({ page }) => {
      await setup(page, spec);
      await expect(page.locator('[data-testid="wintermute-stage"]')).toHaveScreenshot(`${name}.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});

/** Listening tilt of 2.5° over the band width must stay a nudge, not a lean. */
function a11yTiltLimit(band: { left: number; right: number }): number {
  return Math.tan((6 * Math.PI) / 180) * (band.right - band.left) * 0.5 + 2;
}
