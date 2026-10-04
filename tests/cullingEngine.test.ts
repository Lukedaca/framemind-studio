import { describe, expect, it } from 'vitest';
import { CULLING_ENGINE_VERSION, CULLING_GENRES, buildCullingResult, computeFinalScore, computeScoreBreakdown,
  computeSimilarityGroups, deriveTechnicalDecision, getEffectiveDecision, getVerdictSource, rescoreCullingResult,
  type SimilarityInput } from '../utils/cullingEngine';
import { PREVIEW_MAX_SIDE, readMetrics } from '../utils/cullingMetrics';
import { compareSignatures, isValidSignature } from '../utils/cullingSimilarity';
import type { CullingMetrics } from '../types';

const WIDTH = 128, HEIGHT = 96;
function pixels(pixel: (x: number, y: number) => number | number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const value = pixel(x, y);
    data.set(typeof value === 'number' ? [value, value, value, 255] : value, (y * WIDTH + x) * 4);
  }
  return data;
}
const scene = (offset = 0) => readMetrics(pixels((x, y) => 85 + offset + Math.sin(x / 9) * 24 +
  Math.cos(y / 8) * 30 + ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 32), WIDTH, HEIGHT);
function input(id: string, metrics: CullingMetrics, overrides: Partial<SimilarityInput> = {}): SimilarityInput {
  return { id, filename: 'IMG_' + id + '.jpg', signature: metrics.signature, aspectRatio: WIDTH / HEIGHT,
    finalScore: 80, sharpness: metrics.technical!.laplacianVariance, ...overrides };
}

describe('bounded preview measurements', () => {
  it('rejects malformed buffers and unbounded dimensions', () => {
    for (const [width, height] of [[0, 0], [1.5, 2], [PREVIEW_MAX_SIDE + 1, 1]]) {
      expect(() => readMetrics(new Uint8ClampedArray(4), width, height)).toThrow();
    }
    expect(() => readMetrics(new Uint8ClampedArray(3), 1, 1)).toThrow();
  });
  it('transparent pixels neither create fake clipping nor false detail', () => {
    const m = readMetrics(pixels(() => [255, 0, 0, 0]), WIDTH, HEIGHT);
    expect(m.meanLuma).toBeCloseTo(128);
    expect(m.highlightClipping).toBe(0); expect(m.shadowClipping).toBe(0);
    expect(m.technical!.laplacianVariance).toBe(0); expect(m.technical!.detailConfidence).toBe(0);
    expect(Object.values(m.technical!).every(Number.isFinite)).toBe(true);
  });
  it('measures percentiles, histogram mass and single-channel clipping', () => {
    const m = readMetrics(pixels(x => x < WIDTH / 2 ? 0 : 255), WIDTH, HEIGHT);
    expect(m.technical!.p5).toBe(0); expect(m.technical!.p95).toBe(255);
    expect(m.technical!.entropy).toBeCloseTo(1); expect(m.highlightClipping).toBe(0.5);
    expect(m.signature!.histogram.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    const red = readMetrics(pixels(() => [255, 100, 100, 255]), WIDTH, HEIGHT);
    expect(red.technical!.redClip).toBe(1); expect(red.highlightClipping).toBe(0);
  });
  it('blur suppresses detail for the same scene', () => {
    const sharp = pixels((x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) ? 180 : 60);
    const blurred = sharp.slice();
    for (let y = 2; y < HEIGHT - 2; y += 1) for (let x = 2; x < WIDTH - 2; x += 1) {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) sum += sharp[((y + dy) * WIDTH + x + dx) * 4];
      const p = (y * WIDTH + x) * 4; blurred[p] = blurred[p + 1] = blurred[p + 2] = sum / 25;
    }
    expect(readMetrics(blurred, WIDTH, HEIGHT).technical!.laplacianVariance)
      .toBeLessThan(readMetrics(sharp, WIDTH, HEIGHT).technical!.laplacianVariance);
  });
  it('tiny previews still produce finite diagnostics', () => {
    expect(Object.values(readMetrics(new Uint8ClampedArray([120, 120, 120, 255]), 1, 1).technical!).every(Number.isFinite)).toBe(true);
  });
});

describe('conservative technical suggestions', () => {
  it('flat, clipped or low-detail images require review, never automatic deletion', () => {
    for (const value of [0, 128, 255]) {
      const m = readMetrics(pixels(() => value), WIDTH, HEIGHT);
      expect(deriveTechnicalDecision(m, computeFinalScore(m, 'other')).decision).toBe('review');
    }
  });
  it('missing or corrupt evidence never produces an automatic keep', () => {
    const m = scene();
    expect(deriveTechnicalDecision({ ...m, technical: undefined }, 100).decision).toBe('review');
    expect(deriveTechnicalDecision({ ...m, technical: { ...m.technical!, entropy: NaN } }, 100).decision).toBe('review');
  });
  it('every manual profile has a finite 0-100 score and an additive breakdown', () => {
    for (const genre of CULLING_GENRES) {
      const breakdown = computeScoreBreakdown(scene(), genre);
      expect(Object.values(breakdown).reduce((s, item) => s + item.weight, 0)).toBeCloseTo(1);
      const score = computeFinalScore(scene(), genre);
      expect(score).toBeGreaterThanOrEqual(0); expect(score).toBeLessThanOrEqual(100);
      expect(Math.round(Object.values(breakdown).reduce((s, item) => s + item.contribution, 0))).toBe(score);
    }
  });
  it('manual decisions survive profile changes, AI scores do not participate', () => {
    const result = buildCullingResult({ metrics: scene(), aspectRatio: 4 / 3, source: 'image' }, 'other');
    const manual = { ...result, manualDecision: 'reject' as const };
    expect(getEffectiveDecision(rescoreCullingResult(manual, 'sport'))).toBe('reject');
    expect(getVerdictSource(manual)).toBe('manual'); expect(getVerdictSource(result)).toBe('technical');
    expect(result.engineVersion).toBe(CULLING_ENGINE_VERSION); expect(result).not.toHaveProperty('ai');
  });
  it('older automatic decisions require fresh analysis; manual legacy choices remain authoritative', () => {
    const result = buildCullingResult({ metrics: scene(), aspectRatio: 4 / 3, source: 'image' }, 'other');
    const legacy = { ...result, engineVersion: undefined, decision: 'reject' as const };
    expect(getEffectiveDecision(legacy)).toBe('review'); expect(getVerdictSource(legacy)).toBe('legacy');
    expect(getEffectiveDecision({ ...legacy, manualDecision: 'keep' })).toBe('keep');
  });
});

describe('local series without hash-only or transitive grouping', () => {
  it('groups informative identical previews, ranked by technical score', () => {
    const m = scene();
    const groups = computeSimilarityGroups([input('001', m, { finalScore: 60 }), input('002', m, { finalScore: 90 })]);
    expect(groups.get('001')!.duplicateGroupId).toBeDefined();
    expect(groups.get('001')!.duplicateGroupId).toBe(groups.get('002')!.duplicateGroupId);
    expect(groups.get('002')!.isBestInGroup).toBe(true); expect(groups.get('001')!.groupKind).toBe('near-duplicate');
  });
  it('same uniform hash does not group empty images', () => {
    const black = readMetrics(pixels(() => 0), WIDTH, HEIGHT), white = readMetrics(pixels(() => 255), WIDTH, HEIGHT);
    expect(black.hash).toBe(white.hash);
    expect(computeSimilarityGroups([input('001', black), input('002', white)]).get('001')!.duplicateGroupId).toBeUndefined();
  });
  it('a changed local area prevents calling a photo a near duplicate', () => {
    const a = scene();
    const b = readMetrics(pixels((x, y) => x < 32 && y < 32 ? 230 : 85 + Math.sin(x / 9) * 24 + Math.cos(y / 8) * 30 +
      ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 32), WIDTH, HEIGHT);
    expect(compareSignatures(a.signature!, b.signature!).nearDuplicate).toBe(false);
  });
  it('uses capture time for similar scenes and does not override conflicting EXIF with filenames', () => {
    const a = scene(), b = scene(10);
    expect(compareSignatures(a.signature!, b.signature!).similarScene).toBe(true);
    expect(compareSignatures(a.signature!, b.signature!).nearDuplicate).toBe(false);
    const first = input('001', a, { exif: { captureTimeMs: 10000 } });
    const second = input('002', b, { exif: { captureTimeMs: 11000 } });
    expect(computeSimilarityGroups([first, second]).get('001')!.groupKind).toBe('burst');
    expect(computeSimilarityGroups([first, { ...second, exif: { captureTimeMs: 90000 } }]).get('001')!.duplicateGroupId).toBeUndefined();
  });
  it('filename sequence only supports grouping when spatial evidence agrees', () => {
    expect(computeSimilarityGroups([input('001', scene()), input('002', scene(10))]).get('001')!.groupKind).toBe('burst');
    expect(computeSimilarityGroups([input('001', scene()), input('999', scene(10))]).get('001')!.duplicateGroupId).toBeUndefined();
  });
  it('prevents A~B~C chains when A differs from C', () => {
    const a = input('001', scene()), b = input('002', scene(8)), c = input('003', scene(16));
    expect(compareSignatures(a.signature!, b.signature!).similarScene).toBe(true);
    expect(compareSignatures(b.signature!, c.signature!).similarScene).toBe(true);
    expect(compareSignatures(a.signature!, c.signature!).similarScene).toBe(false);
    const grouped = computeSimilarityGroups([a, b, c]);
    expect(grouped.get('001')!.duplicateGroupId).toBe(grouped.get('002')!.duplicateGroupId);
    expect(grouped.get('003')!.duplicateGroupId).toBeUndefined();
  });
  it('rejects malformed signatures and different aspect ratios safely', () => {
    expect(isValidSignature({ averageHash: '0'.repeat(256), differenceHash: '0'.repeat(256) } as never)).toBe(false);
    const m = scene();
    expect(computeSimilarityGroups([input('001', m), input('002', m, { aspectRatio: 1 })]).get('001')!.duplicateGroupId).toBeUndefined();
  });
  // Two complete 400-photo runs need extra headroom on shared CI runners.
  it('large batches preserve all entries, cap series size and stay deterministic', () => {
    const m = scene();
    const items = Array.from({ length: 400 }, (_, i) => input(String(i).padStart(4, '0'), m));
    const result = computeSimilarityGroups(items);
    expect(result.size).toBe(400); expect([...result.values()].every(r => (r.groupRank ?? 0) <= 48)).toBe(true);
    expect(result).toEqual(computeSimilarityGroups([...items].reverse()));
  }, 15_000);
});
