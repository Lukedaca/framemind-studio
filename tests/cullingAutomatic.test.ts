import { describe, expect, it } from 'vitest';
import type { CullingFocusMeasurement, CullingMetrics } from '../types';
import { automaticSamplePlan, CULLING_SUBJECT_MODEL, SUBJECT_INPUT_SIZE, subjectInput } from '../utils/cullingAutomatic';
import { buildCullingResult, getEffectiveDecision } from '../utils/cullingEngine';
import { readMetrics, summarizeNativeSamples } from '../utils/cullingMetrics';

function measured(soft = false, flat = false) {
  const data = new Uint8ClampedArray(128 ** 2 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const value = flat ? 128 : soft ? 128 + 45 * Math.sin(x / 6) + 45 * Math.cos(y / 7) :
      (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 190 : 60;
    data.set([value, value, value, 255], (y * 128 + x) * 4);
  }
  return readMetrics(data, 128, 128);
}
const background = measured();
function withAutomatic(samples: CullingMetrics[]): CullingMetrics {
  return { ...background, automatic: { model: CULLING_SUBJECT_MODEL, status: 'measured', coverage: .1,
    summary: summarizeNativeSamples(samples, 3200, 2400), samples: samples.map((m, i): CullingFocusMeasurement => ({
      region: { x: .1 + i * .05, y: .2, width: .04, height: 128 / 2400 }, technical: m.technical!,
      sharpnessScore: m.sharpnessScore, sourceWidth: 3200, sourceHeight: 2400,
    })) } };
}
function result(metrics: CullingMetrics, intent: 'standard' | 'motion' | 'creative' | 'stack' = 'standard') {
  return buildCullingResult({ metrics, source: 'image', aspectRatio: 4 / 3 }, 'other', intent);
}

describe('automatic foreground sample planning', () => {
  const size = SUBJECT_INPUT_SIZE;
  it('finds bounded interior regions away from the image center, without a person/genre class', () => {
    const mask = new Float32Array(size ** 2);
    for (let y = 40; y < 240; y++) for (let x = 10; x < 100; x++) mask[y * size + x] = .95;
    const plan = automaticSamplePlan(mask, 3200, 2400);
    expect(plan.regions.length).toBeGreaterThanOrEqual(3);
    expect(plan.regions.length).toBeLessThanOrEqual(12);
    for (const r of plan.regions) {
      expect(r.x).toBeLessThan(.4);
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(1);
      expect(r.y).toBeGreaterThanOrEqual(0); expect(r.y + r.height).toBeLessThanOrEqual(1);
      expect(r.width * 3200).toBe(128); expect(r.height * 2400).toBe(128);
    }
  });
  it('does not manufacture a subject from flat, tiny or nearly global predictions', () => {
    for (const mask of [new Float32Array(size ** 2), new Float32Array(size ** 2).fill(.9),
      Float32Array.from({ length: size ** 2 }, (_, i) => i < 5 ? 1 : 0),
      Float32Array.from({ length: size ** 2 }, (_, i) => i < size ** 2 * .8 ? 1 : 0)]) {
      expect(automaticSamplePlan(mask, 3200, 2400).regions).toEqual([]);
    }
  });
  it('rejects malformed model tensors instead of producing arbitrary crop coordinates', () => {
    expect(() => automaticSamplePlan(new Float32Array(3), 3200, 2400)).toThrow();
    const mask = new Float32Array(size ** 2); mask[10] = NaN;
    expect(() => automaticSamplePlan(mask, 3200, 2400)).toThrow();
    expect(() => subjectInput(new Uint8ClampedArray(4))).toThrow();
  });
  it('uses RGB/NCHW channel normalization matching the public model protocol', () => {
    const pixels = new Uint8ClampedArray(size ** 2 * 4);
    for (let i = 0; i < size ** 2; i++) pixels.set([255, 128, 64, 255], i * 4);
    const input = subjectInput(pixels);
    expect(input[0]).toBeCloseTo((1 - .485) / .229);
    expect(input[size ** 2]).toBeCloseTo((128 / 255 - .456) / .224);
    expect(input[size ** 2 * 2]).toBeCloseTo((64 / 255 - .406) / .225);
  });
});

describe('automatic rejection without marking subjects', () => {
  it('rejects consistently soft automatically measured objects despite a sharp background', () => {
    const metrics = withAutomatic(Array.from({ length: 3 }, () => measured(true)));
    expect(result(background).decision).toBe('keep');
    const r = result(metrics);
    expect(r.decision).toBe('reject'); expect(r.reasons).toContain('cull_reason_auto_blur');
    expect(r.rejectionKind).toBe('technical');
    expect(getEffectiveDecision({ ...r, manualDecision: 'keep' })).toBe('keep');
  });
  it('any measured sharp object detail vetoes automatic blur rejection', () => {
    const r = result(withAutomatic([measured(true), measured(true), measured()]));
    expect(r.decision).toBe('keep'); expect(r.reasons).toContain('cull_reason_auto_detail');
  });
  it('low texture, insufficient coverage and noisy evidence cannot establish blur rejection', () => {
    const noisy = measured(true); noisy.technical!.noiseEstimate = 20;
    for (const samples of [[measured(true)], Array.from({ length: 3 }, () => measured(false, true)),
      [noisy, noisy, noisy]]) expect(result(withAutomatic(samples)).decision).not.toBe('reject');
    const metrics = withAutomatic(Array.from({ length: 3 }, () => measured(true)));
    metrics.automatic!.coverage = .8;
    expect(result(metrics).decision).not.toBe('reject');
  });
  it('manual selections override automatic object estimates', () => {
    const metrics = withAutomatic(Array.from({ length: 3 }, () => measured(true)));
    const sharp = measured();
    metrics.focusRegions = [{ region: { x: .1, y: .1, width: .04, height: 128 / 2400 },
      technical: sharp.technical!, sharpnessScore: sharp.sharpnessScore, sourceWidth: 3200, sourceHeight: 2400 }];
    expect(result(metrics).decision).toBe('keep');
  });
  it('intentional motion and protected creative/stacking modes retain priority', () => {
    const metrics = withAutomatic(Array.from({ length: 3 }, () => measured(true)));
    for (const intent of ['motion', 'creative', 'stack'] as const) expect(result(metrics, intent).decision).not.toBe('reject');
  });
  it('missing or corrupt model evidence is visible as review, not a silent approval', () => {
    expect(result({ ...background, automatic: { model: CULLING_SUBJECT_MODEL, status: 'unavailable', coverage: 0, samples: [] } }).risks)
      .toContain('cull_risk_auto_unavailable');
    const invalid = withAutomatic(Array.from({ length: 3 }, () => measured(true)));
    invalid.automatic!.summary!.maxSharpnessScore = NaN;
    expect(result(invalid).decision).toBe('review');
    expect(result(invalid).finalScore).toBe(0);
  });
});
