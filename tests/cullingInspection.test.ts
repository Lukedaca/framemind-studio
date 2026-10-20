import { describe, expect, it } from 'vitest';
import { inspectionRect, inspectionPoint, inspectionDisplaySize } from '../utils/cullingInspection';

describe('original-resolution region inspection', () => {
  it('can inspect a small subject outside the automatic sample grid', () => {
    const region = inspectionRect(6000, 4000, { x: 0.08, y: 0.12 });
    expect(region).toEqual({ x: 288, y: 288, width: 384, height: 384 });
    expect(region.x + region.width / 2).toBe(480);
    expect(region.y + region.height / 2).toBe(480);
  });
  it('clamps at every edge without padding, resizing or inventing pixels', () => {
    expect(inspectionRect(1000, 700, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 384, height: 384 });
    expect(inspectionRect(1000, 700, { x: 1, y: 1 })).toEqual({ x: 616, y: 316, width: 384, height: 384 });
    expect(inspectionRect(120, 90, { x: 0.5, y: 0.5 })).toEqual({ x: 0, y: 0, width: 120, height: 90 });
    expect(() => inspectionRect(0, 1000, { x: 0, y: 0 })).toThrow();
    expect(() => inspectionRect(1000, 1000, { x: NaN, y: 0 })).toThrow();
  });
  it('maps a fitted landscape or portrait and ignores letterbox clicks', () => {
    expect(inspectionPoint(200, 150, 400, 300, 6000, 3000)).toEqual({ x: 0.5, y: 0.5 });
    expect(inspectionPoint(200, 25, 400, 300, 6000, 3000)).toBeNull();
    expect(inspectionPoint(100, 150, 400, 300, 3000, 6000)).toBeNull();
    expect(inspectionPoint(200, 150, 400, 300, 3000, 6000)).toEqual({ x: 0.5, y: 0.5 });
    expect(inspectionPoint(0, 0, 0, 300, 3000, 6000)).toBeNull();
  });
  it('preserves physical pixel scale at normal, fractional and high DPI', () => {
    const region = inspectionRect(6000, 4000, { x: 0.5, y: 0.5 });
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (const zoom of [1, 2] as const) {
        const display = inspectionDisplaySize(region, dpr, zoom);
        expect(display.width * dpr).toBeCloseTo(384 * zoom);
        expect(display.height * dpr).toBeCloseTo(384 * zoom);
      }
    }
  });
});
