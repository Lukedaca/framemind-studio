import { describe, expect, it } from 'vitest';
import { CULLING_GENRES, buildCullingResult } from '../utils/cullingEngine';
import { readMetrics, summarizeNativeSamples } from '../utils/cullingMetrics';

const size = 128;
function measure(pixel: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = pixel(x, y); data.set([v, v, v, 255], (y * size + x) * 4);
  }
  return readMetrics(data, size, size);
}

describe('genre-independent protection of sparse subjects', () => {
  for (const genre of [null, ...CULLING_GENRES]) {
    it(`${genre ?? 'default'} keeps small high-key and low-key subjects for review`, () => {
      // Less than 1% of the image: product on white / distant light against black.
      for (const background of [0, 255]) {
        const metrics = measure((x, y) => x >= 60 && x < 68 && y >= 60 && y < 68 ? 128 : background);
        expect(metrics.technical!.dynamicRange).toBe(0);
        expect(metrics.technical!.entropy).toBeLessThan(1);
        const result = buildCullingResult({ metrics, aspectRatio: 1, source: 'image' }, genre);
        expect(result.decision).toBe('review');
        expect(result.reasons).not.toContain('cull_reason_empty_clipped');
      }
    });
  }
  it('still rejects genuinely empty black and white images', () => {
    for (const value of [0, 255]) {
      const result = buildCullingResult({ metrics: measure(() => value), aspectRatio: 1, source: 'image' }, null);
      expect(result.decision).toBe('reject');
      expect(result.reasons).toContain('cull_reason_empty_clipped');
    }
  });
  it('does not discard even a single non-clipped pixel as an empty frame', () => {
    for (const background of [0, 255]) {
      const metrics = measure((x, y) => x === 10 && y === 10 ? 128 : background);
      expect(buildCullingResult({ metrics, aspectRatio: 1, source: 'image' }, null).decision).toBe('review');
    }
  });
  it('original-scale detail vetoes emptiness even if downscaling lost the subject', () => {
    const blank = measure(() => 255);
    const detail = measure((x, y) => (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 190 : 60);
    const metrics = { ...blank, native: summarizeNativeSamples([blank, detail], 6000, 4000) };
    const result = buildCullingResult({ metrics, aspectRatio: 1.5, source: 'image' }, null);
    expect(result.decision).toBe('review');
    expect(result.reasons).not.toContain('cull_reason_empty_clipped');
  });
});
