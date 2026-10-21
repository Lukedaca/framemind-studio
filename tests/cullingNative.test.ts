import { describe, expect, it } from 'vitest';
import { readMetrics, nativeSampleRects, summarizeNativeSamples } from '../utils/cullingMetrics';
import { buildCullingResult, getEffectiveDecision, computeFinalScore } from '../utils/cullingEngine';
import type { CullingMetrics } from '../types';

function fixture(pixel: (x: number, y: number) => number): CullingMetrics {
  const data = new Uint8ClampedArray(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = pixel(x, y); data.set([v, v, v, 255], (y * 128 + x) * 4);
  }
  return readMetrics(data, 128, 128);
}
const sharp = () => fixture((x, y) => (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 190 : 60);
const soft = () => fixture((x, y) => 128 + 45 * Math.sin(x / 6) + 45 * Math.cos(y / 7));
const result = (metrics: CullingMetrics) => buildCullingResult({ metrics, aspectRatio: 1.5, source: 'image' }, 'sport');

describe('original-resolution detail evidence', () => {
  it('samples nine bounded positions and deduplicates tiny source rectangles', () => {
    const rects = nativeSampleRects(6000, 4000);
    expect(rects).toHaveLength(9);
    for (const r of rects) {
      expect(r.width).toBe(384); expect(r.height).toBe(384);
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(6000);
      expect(r.y).toBeGreaterThanOrEqual(0); expect(r.y + r.height).toBeLessThanOrEqual(4000);
    }
    expect(nativeSampleRects(100, 80)).toEqual([{ x: 0, y: 0, width: 100, height: 80 }]);
  });
  it('broad soft edges cannot inherit a high score from a downscaled preview', () => {
    const preview = sharp(), native = summarizeNativeSamples(Array.from({ length: 9 }, soft), 6000, 4000);
    const measured = { ...preview, native };
    expect(computeFinalScore(measured, 'sport')).toBeLessThan(computeFinalScore(preview, 'sport'));
    const r = result(measured);
    expect(r.decision).toBe('reject'); expect(r.reasons).toContain('cull_reason_native_blur');
    expect(getEffectiveDecision({ ...r, manualDecision: 'keep' })).toBe('keep');
  });
  it('one sharp sampled region protects shallow depth of field', () => {
    const samples = [...Array.from({ length: 8 }, soft), sharp()];
    const r = result({ ...sharp(), native: summarizeNativeSamples(samples, 6000, 4000) });
    expect(r.decision).toBe('keep'); expect(r.reasons).toContain('cull_reason_native_detail');
  });
  it('measured soft original detail cannot be rescued by small residual edge energy', () => {
    // Rounded measurements of IMG_9939 from the read-only sports calibration.
    const native = { sourceWidth: 5616, sourceHeight: 3744, sampleSize: 384, sampleCount: 9,
      informativeSamples: 8, maxSharpnessScore: 0.483, maxLaplacianVariance: 4.53,
      maxEdgeAcutance: 0.0095, maxNoiseEstimate: 0.665 };
    expect(result({ ...sharp(), native }).decision).toBe('reject');
  });
  it('sharp low-contrast edges are not rejected as defocus', () => {
    const lowContrast = fixture((x, y) => (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 139 : 117);
    const native = summarizeNativeSamples(Array.from({ length: 9 }, () => lowContrast), 6000, 4000);
    expect(result({ ...sharp(), native }).decision).not.toBe('reject');
  });
  it('low texture and too few samples never justify a native blur rejection', () => {
    for (const samples of [Array.from({ length: 9 }, () => fixture(x => 80 + x / 2)), [soft()]]) {
      expect(result({ ...sharp(), native: summarizeNativeSamples(samples, 6000, 4000) }).decision).not.toBe('reject');
    }
  });
  it('noise cannot be interpreted as reliable native blur evidence', () => {
    const native = { ...summarizeNativeSamples(Array.from({ length: 9 }, soft), 6000, 4000), maxNoiseEstimate: 20 };
    expect(result({ ...sharp(), native }).decision).not.toBe('reject');
  });
  it('invalid native evidence requires review', () => {
    const native = { ...summarizeNativeSamples([sharp()], 6000, 4000), maxSharpnessScore: NaN };
    expect(result({ ...sharp(), native }).decision).toBe('review');
  });
  it('skipping the signature preserves pixel diagnostics', () => {
    const data = new Uint8ClampedArray(64 * 64 * 4).fill(128);
    for (let p = 3; p < data.length; p += 4) data[p] = 255;
    const complete = readMetrics(data, 64, 64), sample = readMetrics(data, 64, 64, false);
    expect(sample.technical).toEqual(complete.technical);
    expect(sample.sharpnessScore).toBe(complete.sharpnessScore);
    expect(sample.signature).toBeUndefined();
  });
});
