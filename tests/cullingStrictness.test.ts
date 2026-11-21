import { describe, expect, it } from 'vitest';
import type { CullingMetrics, CullingOutputTarget, CullingStrictnessLevel } from '../types';
import {
  buildCullingResult,
  computeSimilarityGroups,
  recommendCullingStrictness,
  rescoreCullingResult,
  type SimilarityInput,
} from '../utils/cullingEngine';
import { readMetrics, summarizeNativeSamples } from '../utils/cullingMetrics';
import { summarizeOptics, type MeasuredTile } from '../utils/cullingOptics';

const WIDTH = 128;
const HEIGHT = 96;

function pixels(pixel: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const v = pixel(x, y);
      data.set([v, v, v, 255], (y * WIDTH + x) * 4);
    }
  }
  return data;
}

const baseScene = (offset = 0) =>
  readMetrics(
    pixels(
      (x, y) =>
        85 +
        offset +
        Math.sin(x / 9) * 24 +
        Math.cos(y / 8) * 30 +
        ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 32
    ),
    WIDTH,
    HEIGHT
  );

function makeOptics(
  subjectBlur: number,
  backgroundBlur: number,
  options: {
    noise?: number;
    subjectBins?: [number, number, number, number];
    straySharpTile?: boolean;
    subjectTileCount?: number;
  } = {}
) {
  const { noise = 1.2, subjectBins, straySharpTile = false, subjectTileCount = 6 } = options;
  const tiles: MeasuredTile[] = [
    ...Array.from({ length: 30 }, (_, i) => {
      const blur = straySharpTile && i === 0 ? 0.5 : backgroundBlur;
      return {
        x: 64 + (i % 10) * 512,
        y: 64 + Math.floor(i / 10) * 1200,
        blur,
        subject: 0,
        edges: 200,
        level: 1 as const,
        noise,
        bins: [blur, blur, blur, blur],
      };
    }),
    ...Array.from({ length: subjectTileCount }, (_, i) => ({
      x: 2400 + i * 128,
      y: 1800,
      blur: subjectBlur,
      subject: 1,
      edges: 200,
      level: 1 as const,
      noise,
      bins: subjectBins ?? [subjectBlur, subjectBlur, subjectBlur, subjectBlur],
    })),
  ];
  return summarizeOptics(tiles, 5616, 3744, 128, 96);
}

function evaluate(
  metrics: CullingMetrics,
  strictness: CullingStrictnessLevel = 'balanced',
  target: CullingOutputTarget = 'full',
  intent: 'standard' | 'motion' | 'creative' | 'stack' = 'standard'
) {
  return buildCullingResult({ metrics, aspectRatio: 1.5, source: 'image' }, 'sport', intent, target, strictness);
}

describe('local culling strictness and real-world blur rejection', () => {
  it('catches directional motion blur even when one orientation looks sharp, while honoring intentional motion', () => {
    const metrics: CullingMetrics = {
      ...baseScene(),
      optics: makeOptics(0.8, 1.4, { subjectBins: [0.7, 1.5, 2.8, 1.6] }),
    };

    const conservative = evaluate(metrics, 'conservative');
    expect(conservative.decision).toBe('review');
    expect(conservative.risks).toContain('cull_risk_optics_motion');
    expect(conservative.reasons).not.toContain('cull_reason_optics_sharp');

    const balanced = evaluate(metrics, 'balanced');
    expect(balanced.decision).toBe('reject');
    expect(balanced.reasons).toContain('cull_reason_optics_motion_blur');
    expect(balanced.reasons).not.toContain('cull_reason_optics_sharp');

    const intentionalMotion = evaluate(metrics, 'strict', 'full', 'motion');
    expect(intentionalMotion.decision).not.toBe('reject');
    expect(intentionalMotion.reasons).not.toContain('cull_reason_optics_motion_blur');
  });

  it('does not let a single stray sharp tile or moderate blurry texture block frame-blurred rejection in balanced/strict', () => {
    const blurryHighContrast = {
      ...baseScene(),
      sharpnessScore: 0.64,
      technical: { ...baseScene().technical!, laplacianVariance: 18 },
      optics: makeOptics(2.3, 2.5, { straySharpTile: true }),
    };

    expect(evaluate(blurryHighContrast, 'conservative').decision).toBe('review');
    const balanced = evaluate(blurryHighContrast, 'balanced');
    expect(balanced.decision).toBe('reject');
    expect(balanced.reasons).toContain('cull_reason_optics_blur');
  });

  it('separates conservative, balanced and strict thresholds on subject back-focus', () => {
    const mildBackFocus: CullingMetrics = { ...baseScene(), optics: makeOptics(1.65, 0.45) };
    expect(evaluate(mildBackFocus, 'conservative').decision).toBe('review');
    expect(evaluate(mildBackFocus, 'balanced').decision).toBe('review');
    expect(evaluate(mildBackFocus, 'strict').decision).toBe('reject');
    expect(evaluate(mildBackFocus, 'strict').reasons).toContain('cull_reason_optics_subject_blur');

    const heavyBackFocus: CullingMetrics = { ...baseScene(), optics: makeOptics(2.5, 0.45) };
    expect(evaluate(heavyBackFocus, 'conservative').decision).toBe('review');
    expect(evaluate(heavyBackFocus, 'balanced').decision).toBe('reject');
    expect(evaluate(heavyBackFocus, 'strict').decision).toBe('reject');
  });

  it('allows moderate higher-ISO noise (e.g. 5.5) to still reject soft native blur, while protecting extreme noise (20)', () => {
    const softPatch = readMetrics(
      pixels((x, y) => 128 + 45 * Math.sin(x / 6) + 45 * Math.cos(y / 7)),
      WIDTH,
      HEIGHT
    );
    const baseNative = summarizeNativeSamples(Array.from({ length: 9 }, () => softPatch), 6000, 4000);
    const iso3200: CullingMetrics = { ...baseScene(), native: { ...baseNative, maxNoiseEstimate: 5.5 } };
    const extremeNoise: CullingMetrics = { ...baseScene(), native: { ...baseNative, maxNoiseEstimate: 20 } };

    expect(evaluate(iso3200, 'balanced').decision).toBe('reject');
    expect(evaluate(iso3200, 'balanced').reasons).toContain('cull_reason_native_blur');
    expect(evaluate(extremeNoise, 'strict').decision).not.toBe('reject');
  });

  it('ranks burst series by optical subject sharpness and rejects optically softer alternatives', () => {
    const sharpMetrics: CullingMetrics = { ...baseScene(), optics: makeOptics(0.65, 1.8) };
    const softMetrics: CullingMetrics = { ...baseScene(6), optics: makeOptics(1.75, 1.8) };

    const sharpResult = evaluate(sharpMetrics, 'balanced');
    const softResult = evaluate(softMetrics, 'balanced');
    const inputs: SimilarityInput[] = [
      {
        id: 'soft',
        filename: 'IMG_0001.jpg',
        signature: softMetrics.signature,
        aspectRatio: 1.5,
        finalScore: 88, // artificially higher global score to verify optical preference
        sharpness: softMetrics.technical!.laplacianVariance,
        detailConfidence: softMetrics.technical!.detailConfidence,
        optics: softMetrics.optics,
        target: 'full',
      },
      {
        id: 'sharp',
        filename: 'IMG_0002.jpg',
        signature: sharpMetrics.signature,
        aspectRatio: 1.5,
        finalScore: 84,
        sharpness: sharpMetrics.technical!.laplacianVariance,
        detailConfidence: sharpMetrics.technical!.detailConfidence,
        optics: sharpMetrics.optics,
        target: 'full',
      },
    ];
    const groups = computeSimilarityGroups(inputs);
    expect(groups.get('sharp')!.isBestInGroup).toBe(true);
    expect(groups.get('soft')!.isBestInGroup).toBe(false);

    const rescoredBalanced = rescoreCullingResult({ ...softResult, ...groups.get('soft') }, 'sport', 'full', 'balanced');
    expect(rescoredBalanced.decision).toBe('reject');
    expect(rescoredBalanced.reasons).toContain('cull_reason_optics_series_blur');

    const rescoredConservative = rescoreCullingResult({ ...softResult, ...groups.get('soft') }, 'sport', 'full', 'conservative');
    expect(rescoredConservative.decision).toBe('review');
  });

  it('rejects severely blown-out frames with unsharp optics while keeping sharp galleries at zero false rejects', () => {
    const sharpSet = Array.from({ length: 18 }, () => evaluate({ ...baseScene(), optics: makeOptics(0.55, 1.5) }, 'strict'));
    expect(sharpSet.every(r => r.decision === 'keep')).toBe(true);

    const base = baseScene();
    const ruinedBlowout: CullingMetrics = {
      ...base,
      highlightClipping: 0.9,
      technical: { ...base.technical!, p5: 225, redClip: 0.9, greenClip: 0.9, blueClip: 0.9 },
      optics: makeOptics(2.6, 2.8),
    };
    const balanced = evaluate(ruinedBlowout, 'balanced');
    expect(balanced.decision).toBe('reject');
    expect(balanced.reasons).toContain('cull_reason_severe_exposure');
  });
});

describe('automatic batch-adaptive strictness recommendation', () => {
  it('chooses strict for a sharp, low-noise multi-frame shoot without creating false rejects', () => {
    const batch = Array.from({ length: 18 }, (_, i) =>
      evaluate({ ...baseScene(), optics: makeOptics(i < 14 ? 0.5 : 1.7, 1.5, { noise: 1.4 }) }, 'balanced')
    );
    const recommendation = recommendCullingStrictness(batch, 'full');
    expect(recommendation.level).toBe('strict');
    expect(recommendation.reason).toBe('cull_strict_auto_strict');

    const rescored = batch.map(r => rescoreCullingResult(r, 'sport', 'full', recommendation.level));
    // All 14 sharp photos remain keep; the 4 soft ones are cleanly rejected.
    expect(rescored.slice(0, 14).every(r => r.decision === 'keep')).toBe(true);
    expect(rescored.slice(14).every(r => r.decision === 'reject')).toBe(true);
  });

  it('drops to conservative for noisy high-ISO sets, tiny unique sets, or soft-lens shoots', () => {
    const noisySet = Array.from({ length: 20 }, () =>
      evaluate({ ...baseScene(), optics: makeOptics(0.7, 1.2, { noise: 8.5 }) }, 'balanced')
    );
    expect(recommendCullingStrictness(noisySet, 'full').level).toBe('conservative');
    expect(recommendCullingStrictness(noisySet, 'full').reason).toBe('cull_strict_auto_conservative_noise');

    const tinySet = Array.from({ length: 4 }, () =>
      evaluate({ ...baseScene(), optics: makeOptics(0.5, 1.2, { noise: 1.0 }) }, 'balanced')
    );
    expect(recommendCullingStrictness(tinySet, 'full').level).toBe('conservative');
    expect(recommendCullingStrictness(tinySet, 'full').reason).toBe('cull_strict_auto_conservative_small');

    const softLensSet = Array.from({ length: 16 }, () =>
      evaluate({ ...baseScene(), optics: makeOptics(1.25, 1.4, { noise: 1.5 }) }, 'balanced')
    );
    expect(recommendCullingStrictness(softLensSet, 'full').level).toBe('conservative');
    expect(recommendCullingStrictness(softLensSet, 'full').reason).toBe('cull_strict_auto_conservative_soft');
  });

  it('chooses balanced for mixed-condition sets', () => {
    const mixedSet = Array.from({ length: 16 }, (_, i) =>
      evaluate({ ...baseScene(), optics: makeOptics(i < 7 ? 0.85 : 1.35, 1.5, { noise: 3.0 }) }, 'balanced')
    );
    expect(recommendCullingStrictness(mixedSet, 'full').level).toBe('balanced');
    expect(recommendCullingStrictness(mixedSet, 'full').reason).toBe('cull_strict_auto_balanced');
  });
});
