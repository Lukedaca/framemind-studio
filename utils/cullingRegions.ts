import type { CullingFocusMeasurement, CullingFocusRegion, CullingMetrics } from '../types';
import { compareSignatures, isValidSignature } from './cullingSimilarity';

export const MAX_FOCUS_REGIONS = 4;

export function focusMeasurements(metrics: CullingMetrics) {
  return metrics.focusRegions ?? (metrics.focus ? [metrics.focus] : []);
}

export function validateFocusRegions(regions: CullingFocusRegion[]): void {
  if (regions.length > MAX_FOCUS_REGIONS || regions.some(r =>
    ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.x < 0 || r.y < 0 ||
    r.width <= 0 || r.height <= 0 || r.x + r.width > 1.000001 || r.y + r.height > 1.000001)) {
    throw new Error('Invalid focus regions');
  }
}

export function validFocusEvidence(metrics: CullingMetrics): boolean {
  const regions = focusMeasurements(metrics);
  if (regions.length > MAX_FOCUS_REGIONS) return false;
  try { validateFocusRegions(regions.map(f => f.region)); } catch { return false; }
  return regions.every(f => !!f.technical && Number.isFinite(f.sharpnessScore) && f.sharpnessScore >= 0 && f.sharpnessScore <= 1 &&
    ['width', 'height', 'detailConfidence', 'laplacianVariance', 'tenengrad', 'standardDeviation', 'noiseEstimate'].every(key =>
      Number.isFinite(f.technical[key as keyof typeof f.technical])) &&
    Object.values(f.technical).every(v => Number.isFinite(v) && v >= 0));
}

// Selected regions are all important. A sharp background/other subject cannot rescue a soft selection.
export function focusSharpness(metrics: CullingMetrics): number | undefined {
  const regions = focusMeasurements(metrics);
  return regions.length ? Math.min(...regions.map(f => f.sharpnessScore)) : undefined;
}

export function severelySoftFocus(f: Pick<CullingFocusMeasurement, 'technical' | 'sharpnessScore'>): boolean {
  const t = f.technical;
  return t.detailConfidence >= 0.3 && t.tenengrad >= 100 && t.standardDeviation >= 10 &&
    f.sharpnessScore < 0.56 && t.laplacianVariance < 8 && t.laplacianVariance / t.tenengrad < 0.012 &&
    t.noiseEstimate < 3;
}

// This verifies matching measured content/scale, not semantic subject identity or motion tracking.
export function comparableFocus(a: CullingFocusMeasurement[] | undefined, b: CullingFocusMeasurement[] | undefined): boolean {
  if (!a?.length || a.length !== b?.length || a.length > MAX_FOCUS_REGIONS) return false;
  return a.every((f, i) => {
    const ref = b[i];
    return validFocusEvidence({ focusRegions: [f, ref] } as CullingMetrics) &&
      Number.isFinite(f.sourceWidth) && Number.isFinite(f.sourceHeight) && f.sourceWidth > 0 && f.sourceHeight > 0 && f.sourceWidth === ref.sourceWidth && f.sourceHeight === ref.sourceHeight &&
      f.technical.width === ref.technical.width && f.technical.height === ref.technical.height &&
      f.technical.detailConfidence >= 0.3 && ref.technical.detailConfidence >= 0.3 &&
      ['x', 'y', 'width', 'height'].every(key => Math.abs(f.region[key as keyof CullingFocusRegion] - ref.region[key as keyof CullingFocusRegion]) < 1e-6) &&
      isValidSignature(f.signature) && isValidSignature(ref.signature) && compareSignatures(f.signature, ref.signature).similarScene;
  });
}
