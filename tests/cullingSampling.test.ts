import { describe, expect, it } from 'vitest';
import { nativeSampleRects, PREVIEW_MAX_SIDE } from '../utils/cullingMetrics';

const width = 384, height = 256;
function preview(patch?: { x: number; y: number; transparent?: boolean }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const detail = patch && Math.abs(x - patch.x) < 8 && Math.abs(y - patch.y) < 8;
    const value = detail ? ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 220 : 40) : 128;
    data.set([value, value, value, detail && patch?.transparent ? 0 : 255], (y * width + x) * 4);
  }
  return { data, width, height };
}
const contains = (r: { x: number; y: number; width: number; height: number }, x: number, y: number) =>
  x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

describe('bounded detail-guided original sampling', () => {
  it('finds a sharp patch between the fixed samples and at the image margin', () => {
    for (const point of [{ x: 132, y: 94 }, { x: 16, y: 28 }]) {
      const sx = point.x / width * 6000, sy = point.y / height * 4000;
      expect(nativeSampleRects(6000, 4000).some(r => contains(r, sx, sy))).toBe(false);
      const rects = nativeSampleRects(6000, 4000, preview(point));
      expect(rects.some(r => contains(r, sx, sy))).toBe(true);
      expect(rects.length).toBeGreaterThan(9);
      expect(rects.length).toBeLessThanOrEqual(13);
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(6000);
        expect(r.y + r.height).toBeLessThanOrEqual(4000);
        expect(r.width).toBe(384); expect(r.height).toBe(384);
      }
      expect(nativeSampleRects(6000, 4000, preview(point))).toEqual(rects);
    }
  });
  it('flat and fully transparent detail add no invented measurement locations', () => {
    const fixed = nativeSampleRects(6000, 4000);
    expect(nativeSampleRects(6000, 4000, preview())).toEqual(fixed);
    expect(nativeSampleRects(6000, 4000, preview({ x: 16, y: 28, transparent: true }))).toEqual(fixed);
  });
  it('never duplicates small-source rectangles', () => {
    expect(nativeSampleRects(100, 80, preview({ x: 16, y: 28 })))
      .toEqual([{ x: 0, y: 0, width: 100, height: 80 }]);
  });
  it('rejects malformed or unbounded hints', () => {
    expect(() => nativeSampleRects(6000, 4000, { data: new Uint8ClampedArray(4), width: 10, height: 10 })).toThrow();
    expect(() => nativeSampleRects(6000, 4000, { data: new Uint8ClampedArray(4), width: PREVIEW_MAX_SIDE + 1, height: 1 })).toThrow();
  });
});
