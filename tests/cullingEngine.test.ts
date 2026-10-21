import { describe, expect, it } from 'vitest';
import { CULLING_ENGINE_VERSION, CULLING_GENRES, buildCullingResult, computeFinalScore, computeScoreBreakdown,
  computeSimilarityGroups, deriveTechnicalDecision, getEffectiveDecision, getVerdictSource, rescoreCullingResult,
  type SimilarityInput } from '../utils/cullingEngine';
import { PREVIEW_MAX_SIDE, readMetrics } from '../utils/cullingMetrics';
import { compareAlignedSignatures, compareSignatures, isValidSignature } from '../utils/cullingSimilarity';
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
const detailedScene = () => pixels((x, y) => 90 + Math.sin(x / 9) * 24 + Math.cos(y / 8) * 30 +
  ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 32 + ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 36 : -36));
function blur(data: Uint8ClampedArray, radius: number): Uint8ClampedArray {
  const result = data.slice();
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    let total = 0, count = 0;
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = Math.max(0, Math.min(WIDTH - 1, x + dx)), sy = Math.max(0, Math.min(HEIGHT - 1, y + dy));
      total += data[(sy * WIDTH + sx) * 4]; count += 1;
    }
    result.set([total / count, total / count, total / count, 255], (y * WIDTH + x) * 4);
  }
  return result;
}
function input(id: string, metrics: CullingMetrics, overrides: Partial<SimilarityInput> = {}): SimilarityInput {
  return { id, filename: 'IMG_' + id + '.jpg', signature: metrics.signature, aspectRatio: WIDTH / HEIGHT,
    finalScore: 80, sharpness: metrics.technical!.laplacianVariance,
    detailConfidence: metrics.technical!.detailConfidence, ...overrides };
}

function rankedPair(a: CullingMetrics, b: CullingMetrics) {
  const results = [a, b].map(metrics => buildCullingResult({ metrics, aspectRatio: 4 / 3, source: 'image' }, 'other'));
  const groups = computeSimilarityGroups(results.map((result, index) => input(String(index + 1), result.metrics, { finalScore: result.finalScore })));
  return results.map((result, index) => rescoreCullingResult({ ...result, ...groups.get(String(index + 1)) }, 'other'));
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

describe('local keep, review and reject suggestions', () => {
  it('almost entirely clipped previews receive an explained reject suggestion', () => {
    for (const value of [0, 255]) {
      const m = readMetrics(pixels(() => value), WIDTH, HEIGHT);
      const verdict = deriveTechnicalDecision(m, computeFinalScore(m, 'other'));
      expect(verdict.decision).toBe('reject');
      expect(verdict.reasons).toContain('cull_reason_empty_clipped');
    }
  });
  it('low-texture scenes, silhouettes and single-channel clipping are not auto-rejected', () => {
    for (const data of [pixels(() => 128), pixels(x => x < WIDTH / 2 ? 0 : 150), pixels(() => [255, 100, 100, 255])]) {
      const m = readMetrics(data, WIDTH, HEIGHT);
      expect(deriveTechnicalDecision(m, computeFinalScore(m, 'other')).decision).toBe('review');
    }
  });
  it('weak sharpness evidence cannot boost a soft photo by dropping its weight', () => {
    const sharp = readMetrics(detailedScene(), WIDTH, HEIGHT);
    const soft = { ...sharp, sharpnessScore: 0.2, technical: { ...sharp.technical!, detailConfidence: 0 } };
    for (const genre of CULLING_GENRES) {
      expect(computeFinalScore(soft, genre)).toBeLessThan(computeFinalScore(sharp, genre));
      expect(computeScoreBreakdown(soft, genre).sharpness.weight).toBeCloseTo(computeScoreBreakdown(sharp, genre).sharpness.weight);
    }
  });
  it('an unchanged informative copy is rejected while its representative stays available', () => {
    const m = readMetrics(detailedScene(), WIDTH, HEIGHT);
    const [representative, copy] = rankedPair(m, m);
    expect(representative.isBestInGroup).toBe(true); expect(representative.decision).not.toBe('reject');
    expect(copy.decision).toBe('reject'); expect(copy.reasons).toContain('cull_reason_redundant_copy');
    expect(getEffectiveDecision({ ...copy, manualDecision: 'keep' })).toBe('keep');
    expect(getEffectiveDecision({ ...copy, manualDecision: 'review' })).toBe('review');
  });
  it('blur degrades the score and the weaker verified similar frame is rejected', () => {
    const data = detailedScene();
    const sharp = readMetrics(data, WIDTH, HEIGHT), soft = readMetrics(blur(data, 3), WIDTH, HEIGHT);
    expect(computeFinalScore(soft, 'other')).toBeLessThan(computeFinalScore(sharp, 'other'));
    const [reference, alternative] = rankedPair(sharp, soft);
    expect(reference.isBestInGroup).toBe(true); expect(reference.decision).not.toBe('reject');
    expect(alternative.duplicateGroupId).toBe(reference.duplicateGroupId);
    expect(alternative.decision).toBe('reject');
  });
  it('unrelated soft frames are reviewed rather than rejected against the whole gallery', () => {
    const soft = readMetrics(blur(detailedScene(), 3), WIDTH, HEIGHT);
    expect(buildCullingResult({ metrics: soft, aspectRatio: 4 / 3, source: 'image' }, 'other').decision).toBe('review');
  });
  it('there is no reject quota for a clean gallery of distinct frames', () => {
    const base = readMetrics(detailedScene(), WIDTH, HEIGHT);
    for (const genre of CULLING_GENRES) {
      const result = buildCullingResult({ metrics: base, aspectRatio: 4 / 3, source: 'image' }, genre);
      expect(result.decision).toBe('keep');
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
  it('camera translation supports a burst without claiming identical action', () => {
    const shifted = readMetrics(pixels((x, y) => 85 + Math.sin((x - 8) / 9) * 24 + Math.cos((y - 3) / 8) * 30 +
      ((Math.floor((x - 8) / 16) + Math.floor((y - 3) / 16)) % 2) * 32), WIDTH, HEIGHT);
    const a = scene();
    expect(compareSignatures(a.signature!, shifted.signature!).similarScene).toBe(false);
    const aligned = compareAlignedSignatures(a.signature!, shifted.signature!);
    expect(aligned.similarScene).toBe(true); expect(aligned.nearDuplicate).toBe(false);
    expect(compareAlignedSignatures(shifted.signature!, a.signature!).score).toBeCloseTo(aligned.score);
    const groups = computeSimilarityGroups([input('001', a), input('002', shifted)]);
    expect(groups.get('001')!.groupKind).toBe('burst');
    expect(groups.get('002')!.groupKind).toBe('burst');
    expect(computeSimilarityGroups([input('001', a), input('999', shifted)]).get('001')!.duplicateGroupId).toBeUndefined();
  });
  it('alignment retains the local-change veto for different moments', () => {
    const changed = readMetrics(pixels((x, y) => x > 40 && x < 88 && y > 25 && y < 70 ? 240 :
      85 + Math.sin(x / 9) * 24 + Math.cos(y / 8) * 30 + ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 32), WIDTH, HEIGHT);
    expect(compareAlignedSignatures(scene().signature!, changed.signature!).similarScene).toBe(false);
  });
  it('groups informative identical previews, ranked by technical score', () => {
    const m = scene();
    const groups = computeSimilarityGroups([input('001', m, { finalScore: 60 }), input('002', m, { finalScore: 90 })]);
    expect(groups.get('001')!.duplicateGroupId).toBeDefined();
    expect(groups.get('001')!.duplicateGroupId).toBe(groups.get('002')!.duplicateGroupId);
    expect(groups.get('002')!.isBestInGroup).toBe(true); expect(groups.get('001')!.groupKind).toBe('near-duplicate');
  });
  it('equal scores choose a stable filename instead of a random import id', () => {
    const m = scene();
    const groups = computeSimilarityGroups([input('a', m, { filename: 'IMG_0002.jpg' }), input('z', m, { filename: 'IMG_0001.jpg' })]);
    expect(groups.get('z')!.isBestInGroup).toBe(true);
    expect(groups.get('a')!.isBestInGroup).toBe(false);
  });
  it('requires preview and original-resolution detail to agree before relative rejection', () => {
    const m = scene();
    const native = { sourceWidth: 6000, sourceHeight: 4000, sampleCount: 9, sampleSize: 384, informativeSamples: 5,
      maxLaplacianVariance: 80, maxSharpnessScore: 0.8, maxEdgeAcutance: 0.02, maxNoiseEstimate: 1 };
    const first = input('001', m, { finalScore: 90, sharpness: 100, native });
    const second = input('002', m, { finalScore: 70, sharpness: 100, native: { ...native, maxLaplacianVariance: 8 } });
    expect(computeSimilarityGroups([first, second]).get('002')!.relativeSharpness).toBe(1);
    expect(computeSimilarityGroups([first, { ...second, sharpness: 10 }]).get('002')!.relativeSharpness).toBeCloseTo(0.1);
    // A sharp native patch vetoes an apparent deficit caused by downscaling.
    expect(computeSimilarityGroups([first, { ...second, sharpness: 10, native }]).get('002')!.relativeSharpness).toBe(1);
    // Insufficient native evidence falls back to matched preview measurements.
    expect(computeSimilarityGroups([first, { ...second, native: { ...native, informativeSamples: 1 } }]).get('002')!.relativeSharpness).toBe(1);
    expect(computeSimilarityGroups([first, { ...second, native: undefined }]).get('002')!.relativeSharpness).toBe(1);
    expect(computeSimilarityGroups([first, { ...second, native: { ...native, sourceWidth: 3000, sourceHeight: 2000 } }]).get('002')!.relativeSharpness).toBe(1);
  });
  it('detects weak original detail hidden by an equally sharp downscaled burst preview', () => {
    const referenceNative = { sourceWidth: 6000, sourceHeight: 4000, sampleCount: 9, sampleSize: 384, informativeSamples: 9,
      maxLaplacianVariance: 80, maxSharpnessScore: 0.8, maxEdgeAcutance: 0.02, maxNoiseEstimate: 1 };
    const blurredNative = { ...referenceNative, maxLaplacianVariance: 8, maxSharpnessScore: 0.5, maxEdgeAcutance: 0.03 };
    const compare = (native: typeof referenceNative, reference = referenceNative) => {
      const metrics = [{ ...scene(), native: reference }, { ...scene(10), native }];
      const results = metrics.map(metrics => buildCullingResult({ metrics, source: 'image', aspectRatio: 4 / 3 }, 'sport'));
      const groups = computeSimilarityGroups(results.map((r, i) => input(String(i + 1), r.metrics,
        { finalScore: r.finalScore, native: r.metrics.native })));
      return results.map((r, i) => rescoreCullingResult({ ...r, ...groups.get(String(i + 1)) }, 'sport'));
    };
    const [reference, blurred] = compare(blurredNative);
    expect(blurred.groupKind).toBe('burst');
    expect(blurred.relativeSharpness).toBeGreaterThan(0.9);
    expect(blurred.relativeNativeSharpness).toBeCloseTo(0.1);
    expect(blurred.decision).toBe('reject');
    expect(blurred.reasons).toContain('cull_reason_soft_alternative');
    expect(reference.decision).not.toBe('reject');
    expect(getEffectiveDecision({ ...blurred, manualDecision: 'keep' })).toBe('keep');
    // Relative texture alone, noisy evidence, weak references and unmatched
    // resolutions cannot establish that an otherwise sharp photograph is blurred.
    for (const [candidate, best] of [
      [{ ...blurredNative, maxSharpnessScore: 0.75 }, referenceNative],
      [{ ...blurredNative, maxNoiseEstimate: 20 }, referenceNative],
      [{ ...blurredNative, sourceWidth: 3000 }, referenceNative],
      [{ ...blurredNative, informativeSamples: 2 }, referenceNative],
      [blurredNative, { ...referenceNative, maxSharpnessScore: 0.65 }],
      [blurredNative, { ...referenceNative, maxNoiseEstimate: 20 }],
    ]) expect(compare(candidate, best)[1].decision).not.toBe('reject');
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
