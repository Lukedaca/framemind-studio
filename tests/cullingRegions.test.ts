import { describe, expect, it } from 'vitest';
import type { CullingFocusMeasurement, CullingIntent, CullingMetrics } from '../types';
import { readMetrics } from '../utils/cullingMetrics';
import { comparableFocus, validateFocusRegions } from '../utils/cullingRegions';
import { buildCullingResult, CULLING_GENRES, computeSimilarityGroups, getEffectiveDecision, rescoreCullingResult, type SimilarityInput } from '../utils/cullingEngine';

function image(soft = false) {
  const data = new Uint8ClampedArray(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const value = soft ? 128 + 45 * Math.sin(x / 6) + 45 * Math.cos(y / 7) :
      (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 190 : 60;
    data.set([value, value, value, 255], (y * 128 + x) * 4);
  }
  return readMetrics(data, 128, 128);
}
const background = image();
function region(soft = false, x = 0.2): CullingFocusMeasurement {
  const m = image(soft);
  return { region: { x, y: 0.2, width: 0.125, height: 1 / 6 }, technical: m.technical!, sharpnessScore: m.sharpnessScore,
    sourceWidth: 1024, sourceHeight: 768, signature: m.signature };
}
function result(focusRegions: CullingFocusMeasurement[], intent: CullingIntent = 'standard', metrics: CullingMetrics = background) {
  return buildCullingResult({ metrics: { ...metrics, focusRegions }, source: 'image', aspectRatio: 4 / 3,
    focusRegions: focusRegions.map(f => f.region) }, 'other', intent);
}
// The full-scene/crop signatures are deliberately identical in ranking tests:
// downsampling can hide the native-scale difference. Native evidence is varied independently.
function rankedInput(id: string, detail: number, finalScore: number): SimilarityInput {
  const f = region();
  return { id, filename: `IMG_${id}.jpg`, signature: background.signature, aspectRatio: 4 / 3, finalScore,
    sharpness: 80, detailConfidence: 1, focusRegions: [{ ...f, sharpnessScore: detail,
      technical: { ...f.technical, detailConfidence: 1, noiseEstimate: 0.5, laplacianVariance: detail < 0.5 ? 4 : 80, tenengrad: 900 } }] };
}

describe('selected details independent of photographic genre', () => {
  it('a sharp background cannot conceal a soft selected subject', () => {
    const whole = buildCullingResult({ metrics: background, aspectRatio: 4 / 3, source: 'image' }, 'other');
    const selected = result([region(true)]);
    expect(selected.finalScore).toBeLessThan(whole.finalScore);
    expect(selected.decision).toBe('review');
    expect(selected.risks).toContain('cull_risk_focus_soft');
    expect(selected.reasons).not.toContain('cull_reason_native_detail');
  });
  it('every chosen detail matters; one sharp face/detail cannot rescue another blurred one', () => {
    expect(result([region(), region(true, 0.6)]).finalScore).toBe(result([region(true)]).finalScore);
    expect(result([region(), region(true, 0.6)], 'detail').decision).toBe('reject');
    expect(result([region(), region(true, 0.6)], 'detail').rejectionKind).toBe('technical');
  });
  it('a sharp selected detail is not penalized for blurred background sampling', () => {
    const soft = image(true);
    const metrics = { ...soft, native: { sourceWidth: 1024, sourceHeight: 768, sampleSize: 384, sampleCount: 9,
      informativeSamples: 5, maxSharpnessScore: 0.3, maxLaplacianVariance: 3, maxEdgeAcutance: 0.005, maxNoiseEstimate: 0.5 } };
    const selected = result([region()], 'standard', metrics);
    expect(selected.decision).toBe('keep');
    expect(selected.risks).not.toContain('cull_risk_native_soft');
  });
  it('strict detail requires measurable blur, not low texture or noise', () => {
    for (const technical of [{ ...region(true).technical, detailConfidence: 0.01 },
      { ...region(true).technical, noiseEstimate: 20 }]) {
      expect(result([{ ...region(true), technical }], 'detail').decision).not.toBe('reject');
    }
  });
  it('checks scale conflicts and noise in every selected detail', () => {
    const unstable = { ...region(), technical: { ...region().technical, noiseConfidence: 1, noiseEstimate: 20,
      scaleConsistency: 0.1, fineEdgeEnergy: 100 } };
    const r = result([region(), unstable]);
    expect(r.decision).toBe('review');
    expect(r.risks).toContain('cull_risk_scale_conflict');
    expect(r.risks).toContain('cull_risk_noise');
  });
  it('uses the same evidence rules across every technical profile', () => {
    for (const genre of CULLING_GENRES) {
      const f = region(true);
      const r = buildCullingResult({ metrics: { ...background, focusRegions: [f] }, source: 'image', aspectRatio: 4 / 3 }, genre, 'detail');
      expect(r.reasons).toContain('cull_reason_focus_blur');
      expect(getEffectiveDecision({ ...r, manualDecision: 'keep' })).toBe('keep');
    }
  });
  it('intentional motion excludes blur penalties while retaining clipping diagnosis', () => {
    const r = result([region(true)], 'motion');
    expect(r.decision).not.toBe('reject');
    expect(r.scoreBreakdown!.sharpness.weight).toBe(0);
    expect(r.scoreBreakdown!.motion.weight).toBe(0);
    expect(r.risks).not.toContain('cull_risk_focus_soft');
    const white = { ...background, highlightClipping: 1, technical: { ...background.technical!, redClip: 1, greenClip: 1, blueClip: 1, entropy: 0, dynamicRange: 0 } };
    expect(result([], 'motion', white).reasons).toContain('cull_reason_empty_clipped');
  });
  it('creative and stacking intents preserve even heavily clipped source frames', () => {
    const white = { ...background, highlightClipping: 1, technical: { ...background.technical!, redClip: 1, greenClip: 1, blueClip: 1, entropy: 0, dynamicRange: 0 } };
    for (const intent of ['creative', 'stack'] as const) {
      const r = result([], intent, white);
      expect(r.decision).toBe('review'); expect(r.rejectionKind).toBeUndefined();
      expect(r.risks).toContain('cull_risk_highlights');
      expect(rescoreCullingResult({ ...r, manualDecision: 'keep' }, 'landscape').intent).toBe(intent);
    }
  });
  it('invalid stored focus evidence requires review, including nonfinite quality', () => {
    for (const f of [{ ...region(), sharpnessScore: NaN }, { ...region(), region: { ...region().region, x: -1 } }]) {
      const r = result([f], 'detail');
      expect(r.reasons).toContain('cull_reason_reanalyze');
      expect(r.finalScore).toBe(0);
      expect(Object.values(r.scoreBreakdown!).every(part => Number.isFinite(part.contribution))).toBe(true);
    }
    expect(() => validateFocusRegions(Array.from({ length: 5 }, () => region().region))).toThrow();
    expect(() => validateFocusRegions([{ x: 0.9, y: 0.1, width: 0.2, height: 0.1 }])).toThrow();
  });
});

describe('region evidence within a verified series', () => {
  it('ranks corresponding selected details ahead of global background scores', () => {
    const soft = rankedInput('001', 0.4, 95), sharp = rankedInput('002', 0.8, 75);
    const group = computeSimilarityGroups([soft, sharp]);
    expect(group.get('002')!.isBestInGroup).toBe(true);
    expect(group.get('001')!.focusComparisonVerified).toBe(true);
    expect(group.get('001')!.relativeFocusSharpness).toBeCloseTo(0.05);
    const candidate = result(soft.focusRegions!);
    const updated = rescoreCullingResult({ ...candidate, ...group.get('001') }, 'other');
    expect(updated.reasons).toContain('cull_reason_focus_alternative');
    expect(updated.rejectionKind).toBe('technical');
    expect(computeSimilarityGroups([sharp, soft])).toEqual(group);
  });
  it('refuses relative focus evidence at different scale, position, count or content', () => {
    const a = rankedInput('001', 0.4, 95), b = rankedInput('002', 0.8, 75);
    const f = b.focusRegions![0];
    const changed = image();
    const differentSignature = { ...changed.signature!, color: Array(768).fill(0.01) };
    for (const regions of [[{ ...f, sourceWidth: 2048 }], [{ ...f, region: { ...f.region, x: 0.3 } }],
      [f, f], [{ ...f, signature: differentSignature }], [{ ...f, technical: { ...f.technical, width: 64 } }]]) {
      expect(comparableFocus(a.focusRegions, regions)).toBe(false);
      const group = computeSimilarityGroups([a, { ...b, focusRegions: regions }]);
      expect(group.get('001')!.focusComparisonVerified).not.toBe(true);
      expect(group.get('001')!.isBestInGroup).toBe(true);
    }
  });
  it('does not mix intentional motion with standard detail rankings or collapse stacking sets', () => {
    const a = rankedInput('001', 0.4, 95), b = rankedInput('002', 0.8, 75);
    for (const intent of ['motion', 'stack', 'creative'] as const) {
      const group = computeSimilarityGroups([a, { ...b, intent }]);
      expect(group.get('001')!.duplicateGroupId).toBeUndefined();
    }
    const group = computeSimilarityGroups([{ ...a, intent: 'stack' }, { ...b, intent: 'stack' }]);
    expect(group.get('001')!.duplicateGroupId).toBeUndefined();
    expect(computeSimilarityGroups([{ ...a, intent: 'creative' }, { ...b, intent: 'creative' }]).get('001')!.duplicateGroupId).toBeUndefined();
  });
  it('cannot reject unselected content relative to a reference measured on selected details', () => {
    const a = rankedInput('001', 0.8, 95), b = { ...rankedInput('002', 0.4, 70), focusRegions: undefined };
    expect(computeSimilarityGroups([a, b]).get('002')!.referenceDetailConfidence).toBe(0);
  });
  it('a noisy reference cannot establish a focus rejection in standard mode', () => {
    const a = rankedInput('001', 0.4, 70), b = rankedInput('002', 0.8, 95);
    b.focusRegions![0].technical.noiseEstimate = 20;
    const group = computeSimilarityGroups([a, b]);
    expect(group.get('001')!.referenceFocusSharpness).toBeUndefined();
    expect(rescoreCullingResult({ ...result(a.focusRegions!), ...group.get('001') }, 'other').decision).not.toBe('reject');
  });
});
