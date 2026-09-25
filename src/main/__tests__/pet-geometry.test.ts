import { describe, it, expect } from 'vitest';
import {
  PET_MARGIN,
  PET_SIZE_LIMITS,
  clampToWorkAreas,
  defaultPetBounds,
  dragTo,
  nearestWorkArea,
  parseStoredBounds,
  resizeKeepingTopCenter,
  sanitizeSize,
} from '../pet-geometry';

const laptop = {
  x: 0, y: 0, width: 1920, height: 1050,
};
const external = {
  x: 1920, y: -200, width: 2560, height: 1400,
};

describe('sanitizeSize', () => {
  it('rounds and clamps renderer-supplied sizes', () => {
    expect(sanitizeSize(240.4, 381.6, { width: 1, height: 1 })).toEqual({ width: 240, height: 382 });
    expect(sanitizeSize(5, 99999, { width: 1, height: 1 })).toEqual({ width: PET_SIZE_LIMITS.min, height: PET_SIZE_LIMITS.max });
  });

  it('falls back for garbage', () => {
    expect(sanitizeSize('x', NaN, { width: 240, height: 240 })).toEqual({ width: 240, height: 240 });
  });
});

describe('defaultPetBounds', () => {
  it('sits in the bottom-right corner with a margin', () => {
    const b = defaultPetBounds(laptop, { width: 240, height: 240 });
    expect(b).toEqual({
      x: 1920 - 240 - PET_MARGIN, y: 1050 - 240 - PET_MARGIN, width: 240, height: 240,
    });
  });
});

describe('resizeKeepingTopCenter', () => {
  it('keeps the top edge and horizontal centre when the input box appears', () => {
    const orbOnly = {
      x: 1000, y: 500, width: 240, height: 240,
    };
    const withInput = resizeKeepingTopCenter(orbOnly, { width: 416, height: 400 });
    expect(withInput.y).toBe(500);
    expect(withInput.x + withInput.width / 2).toBe(orbOnly.x + orbOnly.width / 2);
    expect(resizeKeepingTopCenter(withInput, { width: 240, height: 240 })).toEqual(orbOnly);
  });
});

describe('nearestWorkArea / clampToWorkAreas', () => {
  it('picks the display containing the window centre', () => {
    expect(nearestWorkArea({
      x: 2500, y: 100, width: 240, height: 240,
    }, [laptop, external])).toBe(external);
    expect(nearestWorkArea({
      x: 100, y: 100, width: 240, height: 240,
    }, [laptop, external])).toBe(laptop);
  });

  it('pulls a window dragged partly off-screen back inside', () => {
    expect(clampToWorkAreas({
      x: -100, y: 1000, width: 240, height: 240,
    }, [laptop])).toEqual({
      x: 0, y: 1050 - 240, width: 240, height: 240,
    });
  });

  it('moves a window stranded on an unplugged monitor onto the remaining one', () => {
    const stranded = {
      x: 3000, y: 900, width: 240, height: 240,
    };
    const b = clampToWorkAreas(stranded, [laptop]);
    expect(b.x).toBe(1920 - 240);
    expect(b.y).toBe(1050 - 240);
  });

  it('leaves a window that already fits alone', () => {
    const ok = {
      x: 400, y: 300, width: 240, height: 240,
    };
    expect(clampToWorkAreas(ok, [laptop, external])).toEqual(ok);
  });

  it('is a no-op without displays', () => {
    const b = {
      x: 1, y: 2, width: 100, height: 100,
    };
    expect(clampToWorkAreas(b, [])).toBe(b);
  });
});

describe('dragTo', () => {
  it('moves the window by the pointer delta', () => {
    expect(dragTo({ x: 1000, y: 500 }, { x: 1100, y: 620 }, { x: 900, y: 700 }))
      .toEqual({ x: 800, y: 580 });
  });
});

describe('parseStoredBounds', () => {
  it('accepts valid bounds and rejects malformed ones', () => {
    expect(parseStoredBounds({
      x: 10.2, y: 20, width: 240, height: 240,
    })).toEqual({
      x: 10, y: 20, width: 240, height: 240,
    });
    expect(parseStoredBounds(null)).toBeNull();
    expect(parseStoredBounds({ x: 1, y: 2 })).toBeNull();
    expect(parseStoredBounds({
      x: 1, y: 2, width: 3, height: 3,
    })).toBeNull();
    expect(parseStoredBounds({
      x: 'a', y: 2, width: 240, height: 240,
    })).toBeNull();
  });
});
