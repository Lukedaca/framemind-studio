import { describe, expect, it } from 'vitest';
import { harmonizeInpaintBoundary } from '../utils/inpaintBlend';
import { readMetrics } from '../utils/cullingMetrics';
import { computeScoreBreakdown, deriveTechnicalDecision } from '../utils/cullingEngine';

const fixture = (size = 64) => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) pixels.set([100, 100, 100, 255], (y * size + x) * 4);
  return pixels;
};

describe('photographic quality safeguards', () => {
  it('reduces a smooth color seam without changing any pixel outside the hole', () => {
    const original = fixture(), filled = original.slice(), hole = new Uint8Array(64 * 64);
    for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) { hole[y * 64 + x] = 1; filled.set([120, 120, 120, 255], (y * 64 + x) * 4); }
    const before = filled.slice();
    const shift = harmonizeInpaintBoundary(filled, original, hole, 64, 64);
    expect(shift.every(value => value < 0)).toBe(true);
    expect(filled[(32 * 64 + 32) * 4]).toBeLessThan(120);
    for (let p = 0; p < hole.length; p++) if (!hole[p]) expect(filled.subarray(p * 4, p * 4 + 4)).toEqual(before.subarray(p * 4, p * 4 + 4));
  });
  it('does not invent a tone correction from a single ambiguous boundary pixel', () => {
    const original = fixture(), filled = original.slice(), hole = new Uint8Array(64 * 64);
    hole[1000] = 1; filled[4000] = 120;
    const before = filled.slice();
    expect(harmonizeInpaintBoundary(filled, original, hole, 64, 64)).toEqual([0, 0, 0]);
    expect(filled).toEqual(before);
  });
  it('requires original-pixel proof before suggesting removal as a redundant copy', () => {
    const metrics = readMetrics(fixture(), 64, 64);
    const context = { duplicateGroupId: 'a', isBestInGroup: false, groupKind: 'near-duplicate' as const, similarityToBest: 1 };
    expect(deriveTechnicalDecision(metrics, 90, context).reasons).not.toContain('cull_reason_redundant_copy');
    expect(deriveTechnicalDecision(metrics, 90, { ...context, duplicateVerified: true }).reasons).toContain('cull_reason_redundant_copy');
  });
  it('uses the selected subject for sharpness and keeps an uncertain subject for review', () => {
    const metrics = readMetrics(fixture(), 64, 64);
    metrics.sharpnessScore = 0.95;
    metrics.technical!.detailConfidence = 1;
    const global = computeScoreBreakdown(metrics, 'sport').sharpness.score;
    metrics.focus = { region: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }, technical: { ...metrics.technical! }, sharpnessScore: 0.1 };
    expect(computeScoreBreakdown(metrics, 'sport').sharpness.score).toBeLessThan(global);
    expect(deriveTechnicalDecision(metrics, 90).risks).toContain('cull_risk_focus_soft');
    expect(deriveTechnicalDecision(metrics, 90).decision).toBe('review');
  });
  it('treats conflicting noisy detail across scales as uncertainty, never a sole reject', () => {
    const metrics = readMetrics(fixture(), 64, 64);
    Object.assign(metrics.technical!, { noiseEstimate: 8, noiseConfidence: 1, fineEdgeEnergy: 20, coarseEdgeEnergy: 1, scaleConsistency: 0.05 });
    const result = deriveTechnicalDecision(metrics, 90);
    expect(result.risks).toContain('cull_risk_scale_conflict');
    expect(result.decision).toBe('review');
  });
});
