/**
 * Pure geometry for the compact pet window (the small always-on-top window
 * that holds just the orb and, optionally, the input box). No Electron
 * imports, so it runs under vitest.
 *
 * Coordinates are DIP screen coordinates, as used by BrowserWindow.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Hard limits for a renderer-requested window size. */
export const PET_SIZE_LIMITS = {
  min: 64,
  max: 1600,
} as const;

export const PET_MARGIN = 24;

function finite(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** Sanitise a size coming from the renderer over IPC. */
export function sanitizeSize(width: unknown, height: unknown, fallback: Size): Size {
  const clampDim = (v: unknown, fb: number) => Math.round(
    Math.min(PET_SIZE_LIMITS.max, Math.max(PET_SIZE_LIMITS.min, finite(v, fb))),
  );
  return { width: clampDim(width, fallback.width), height: clampDim(height, fallback.height) };
}

/** Bottom-right corner of a work area, inset by `margin`. */
export function defaultPetBounds(workArea: Rect, size: Size, margin = PET_MARGIN): Rect {
  return {
    x: Math.round(workArea.x + workArea.width - size.width - margin),
    y: Math.round(workArea.y + workArea.height - size.height - margin),
    width: size.width,
    height: size.height,
  };
}

/**
 * New bounds for a new size, keeping the top edge and the horizontal centre
 * fixed: the orb sits at the top-centre of the window, so it does not jump
 * when the input box below it appears or disappears.
 */
export function resizeKeepingTopCenter(bounds: Rect, size: Size): Rect {
  const centerX = bounds.x + bounds.width / 2;
  return {
    x: Math.round(centerX - size.width / 2),
    y: bounds.y,
    width: size.width,
    height: size.height,
  };
}

function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/** The work area that contains (or is nearest to) the centre of `bounds`. */
export function nearestWorkArea(bounds: Rect, workAreas: Rect[]): Rect | null {
  if (workAreas.length === 0) return null;
  const c = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  let best = workAreas[0];
  let bestD = distanceToRect(c, best);
  for (const wa of workAreas.slice(1)) {
    const d = distanceToRect(c, wa);
    if (d < bestD) {
      best = wa;
      bestD = d;
    }
  }
  return best;
}

/**
 * Keep the whole window inside the nearest display's work area, so the orb
 * can never be dragged (or left, after a monitor is unplugged) off-screen.
 * If the window is larger than the work area, its top-left wins.
 */
export function clampToWorkAreas(bounds: Rect, workAreas: Rect[]): Rect {
  const wa = nearestWorkArea(bounds, workAreas);
  if (!wa) return bounds;
  const maxX = wa.x + wa.width - bounds.width;
  const maxY = wa.y + wa.height - bounds.height;
  return {
    x: Math.round(Math.max(wa.x, Math.min(bounds.x, maxX))),
    y: Math.round(Math.max(wa.y, Math.min(bounds.y, maxY))),
    width: bounds.width,
    height: bounds.height,
  };
}

/** Window position while dragging: start position plus pointer delta. */
export function dragTo(windowStart: Point, pointerStart: Point, pointer: Point): Point {
  return {
    x: Math.round(windowStart.x + (pointer.x - pointerStart.x)),
    y: Math.round(windowStart.y + (pointer.y - pointerStart.y)),
  };
}

/** Parse persisted bounds; anything malformed returns null. */
export function parseStoredBounds(raw: unknown): Rect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const vals = [r.x, r.y, r.width, r.height];
  if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const width = r.width as number;
  const height = r.height as number;
  if (width < PET_SIZE_LIMITS.min || height < PET_SIZE_LIMITS.min) return null;
  if (width > PET_SIZE_LIMITS.max || height > PET_SIZE_LIMITS.max) return null;
  return {
    x: Math.round(r.x as number),
    y: Math.round(r.y as number),
    width: Math.round(width),
    height: Math.round(height),
  };
}
