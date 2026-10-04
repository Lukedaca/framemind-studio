// Pure local scoring and grouping; browser I/O belongs to cullingSession/worker.
import type { CullingDecision, CullingExif, CullingGenre, CullingMetrics, CullingResult,
  CullingScoreBreakdown, CullingScorePart, CullingSignature, CullingVerdictSource } from '../types';
import { clamp01 } from './cullingMetrics';
import { compareSignatures, isValidSignature, type SimilarityComparison } from './cullingSimilarity';

export const CULLING_ENGINE_VERSION = 'local-1.1';
export const SIMILARITY_EXACT_LIMIT = 320;
export const MAX_SERIES_SIZE = 48;
const PARTS: CullingScorePart[] = ['sharpness', 'exposure', 'clipping', 'noise', 'contrast', 'motion'];
const profiles = {
  sport: [0.4, 0.18, 0.16, 0.04, 0.18, 0.04], portrait: [0.4, 0.18, 0.16, 0.12, 0.1, 0.04],
  wedding: [0.34, 0.2, 0.16, 0.08, 0.18, 0.04], product: [0.4, 0.2, 0.16, 0.14, 0.06, 0.04],
  landscape: [0.36, 0.2, 0.2, 0.1, 0.1, 0.04], street: [0.3, 0.2, 0.16, 0.04, 0.26, 0.04],
  wildlife: [0.44, 0.16, 0.16, 0.08, 0.12, 0.04], event: [0.34, 0.2, 0.16, 0.06, 0.2, 0.04],
  other: [0.36, 0.2, 0.16, 0.1, 0.14, 0.04],
} satisfies Record<CullingGenre, number[]>;
export const CULLING_GENRES = Object.keys(profiles) as CullingGenre[];

export function computeScoreBreakdown(metrics: CullingMetrics, genre: CullingGenre | null): CullingScoreBreakdown {
  const technical = metrics.technical;
  const weights = profiles[genre ?? 'other'] ?? profiles.other;
  const confidence = [technical?.detailConfidence ?? 0, 1, 1, technical?.noiseConfidence ?? 0, 1, technical?.motionConfidence ?? 0];
  const values = [metrics.sharpnessScore, metrics.exposureScore,
    1 - Math.min(1, (metrics.highlightClipping + metrics.shadowClipping) * 1.5),
    metrics.noiseScore, metrics.contrastScore, 1 - (technical?.motionBlurEstimate ?? 0)];
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(PARTS.map((part, i) => {
    const weight = weights[i] / Math.max(1e-9, total);
    // Weak detail evidence must not remove its weight and inflate a blurred photo's score.
    const evidence = clamp01(confidence[i]);
    const score = (clamp01(values[i]) * evidence + 0.5 * (1 - evidence)) * 100;
    return [part, { score, weight, contribution: score * weight }];
  })) as CullingScoreBreakdown;
}

export function computeFinalScore(metrics: CullingMetrics, genre: CullingGenre | null): number {
  return Math.round(Object.values(computeScoreBreakdown(metrics, genre)).reduce((sum, item) => sum + item.contribution, 0));
}

export function deriveTechnicalDecision(metrics: CullingMetrics, finalScore: number,
  context: Pick<CullingResult, 'duplicateGroupId' | 'isBestInGroup' | 'groupKind' | 'similarityToBest' | 'relativeSharpness' | 'scoreGap' | 'referenceDetailConfidence'> = {}):
  { decision: CullingDecision; reasons: string[]; risks: string[] } {
  const technical = metrics.technical;
  if (!technical || !Object.values(technical).every(Number.isFinite)) {
    return { decision: 'review', reasons: ['cull_reason_reanalyze'], risks: ['cull_risk_missing_metrics'] };
  }
  const risks: string[] = [];
  const reasons: string[] = [];
  if (technical.detailConfidence < 0.15) risks.push('cull_risk_low_detail');
  else if (metrics.sharpnessScore >= 0.6) reasons.push('cull_reason_detail');
  else if (metrics.sharpnessScore < 0.6) risks.push('cull_risk_preview_soft');
  if (metrics.highlightClipping > 0.1) risks.push('cull_risk_highlights');
  if (metrics.shadowClipping > 0.25) risks.push('cull_risk_shadows');
  if (Math.max(technical.redClip, technical.greenClip, technical.blueClip) > 0.2 && metrics.highlightClipping <= 0.1) risks.push('cull_risk_channel_clip');
  if (technical.noiseConfidence >= 0.6 && technical.noiseEstimate > 18) risks.push('cull_risk_noise');
  if (technical.motionConfidence >= 0.6 && technical.motionBlurEstimate > 0.7) risks.push('cull_risk_direction');
  if (!risks.includes('cull_risk_highlights') && !risks.includes('cull_risk_shadows')) reasons.push('cull_reason_range');
  if (context.duplicateGroupId) {
    if (context.isBestInGroup) reasons.push('cull_reason_best_in_group');
    else {
      risks.push(context.groupKind === 'near-duplicate' ? 'cull_risk_duplicate' : 'cull_risk_series_alternative');
      if ((context.relativeSharpness ?? 1) < 0.5 && technical.detailConfidence >= 0.3) risks.push('cull_risk_soft_vs_series');
    }
  }
  // A nearly empty clipped preview has lost essentially all luminance data.
  // Isolated highlights, silhouettes and ordinary low-key/high-key photos do not qualify.
  const emptyHighlights = metrics.highlightClipping >= 0.98 &&
    Math.min(technical.redClip, technical.greenClip, technical.blueClip) >= 0.98;
  const emptyShadows = metrics.shadowClipping >= 0.98 &&
    Math.min(technical.redShadowClip, technical.greenShadowClip, technical.blueShadowClip) >= 0.98;
  const emptyClippedPreview = (emptyHighlights || emptyShadows) && technical.dynamicRange <= 8 && technical.entropy < 1;
  const alternative = !!context.duplicateGroupId && context.isBestInGroup === false;
  const redundantCopy = alternative && context.groupKind === 'near-duplicate' &&
    (context.similarityToBest ?? 0) >= 0.965;
  // Relative rejection is restricted to verified similar frames with a measurable,
  // technically stronger reference. Never rank unrelated photos by global texture.
  const referenceScore = finalScore / Math.max(0.01, 1 - (context.scoreGap ?? 0));
  const muchSofterAlternative = alternative && (context.groupKind === 'burst' || context.groupKind === 'near-duplicate') &&
    (context.similarityToBest ?? 0) >= 0.84 && Number.isFinite(context.scoreGap) &&
    (context.scoreGap ?? 0) < 1 &&
    Number.isFinite(context.relativeSharpness) && (context.relativeSharpness ?? 1) >= 0 &&
    (context.relativeSharpness ?? 1) < 0.35 && (context.scoreGap ?? 0) > 0.1 &&
    (context.referenceDetailConfidence ?? 0) >= 0.35 && referenceScore >= 75;
  const rejectReasons = [
    ...(emptyClippedPreview ? ['cull_reason_empty_clipped'] : []),
    ...(redundantCopy ? ['cull_reason_redundant_copy'] : []),
    ...(muchSofterAlternative ? ['cull_reason_soft_alternative'] : []),
  ];
  const decision = rejectReasons.length ? 'reject' : risks.length || finalScore < 75 ? 'review' : 'keep';
  reasons.unshift(...rejectReasons);
  if (decision === 'review') reasons.push('cull_reason_needs_review');
  return { decision, reasons, risks };
}

export interface PhotoAnalysis {
  metrics: CullingMetrics;
  aspectRatio: number;
  source: NonNullable<CullingResult['source']>;
  exif?: CullingExif;
}

export function buildCullingResult(analysis: PhotoAnalysis, genre: CullingGenre | null): CullingResult {
  const finalScore = computeFinalScore(analysis.metrics, genre);
  return { ...analysis, finalScore, ...deriveTechnicalDecision(analysis.metrics, finalScore), genre: genre ?? undefined,
    scoreBreakdown: computeScoreBreakdown(analysis.metrics, genre), engineVersion: CULLING_ENGINE_VERSION, analysisStatus: 'done' };
}

export function rescoreCullingResult(result: CullingResult, genre: CullingGenre | null): CullingResult {
  if (result.engineVersion !== CULLING_ENGINE_VERSION || result.analysisStatus === 'error') return result;
  const finalScore = computeFinalScore(result.metrics, genre);
  return { ...result, finalScore, genre: genre ?? undefined, scoreBreakdown: computeScoreBreakdown(result.metrics, genre),
    ...deriveTechnicalDecision(result.metrics, finalScore, result) };
}

export function getEffectiveDecision(result: CullingResult | undefined): CullingDecision | null {
  if (!result) return null;
  return result.manualDecision ?? (result.engineVersion === CULLING_ENGINE_VERSION ? result.decision : 'review');
}

export function getVerdictSource(result: CullingResult | undefined): CullingVerdictSource | null {
  if (!result) return null;
  return result.manualDecision ? 'manual' : result.engineVersion === CULLING_ENGINE_VERSION ? 'technical' : 'legacy';
}

export interface SimilarityInput {
  id: string;
  filename: string;
  signature?: CullingSignature;
  aspectRatio: number;
  finalScore: number;
  sharpness: number;
  detailConfidence?: number;
  exif?: CullingExif;
}
export interface SimilarityAssignment {
  duplicateGroupId?: string;
  isBestInGroup?: boolean;
  groupRank?: number;
  groupKind?: CullingResult['groupKind'];
  similarityToBest?: number;
  relativeSharpness?: number;
  scoreGap?: number;
  referenceDetailConfidence?: number;
}
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function sequence(filename: string): { prefix: string; number: number } | null {
  const match = /^(.*?)(\d+)\.[^.]+$/.exec(filename.toLowerCase());
  return match ? { prefix: match[1], number: Number(match[2]) } : null;
}

function relatedTime(a: SimilarityInput, b: SimilarityInput): boolean {
  const ta = a.exif?.captureTimeMs, tb = b.exif?.captureTimeMs;
  if (Number.isFinite(ta) && Number.isFinite(tb)) return Math.abs(ta! - tb!) <= 2000;
  const sa = sequence(a.filename), sb = sequence(b.filename);
  return !!sa && !!sb && sa.prefix === sb.prefix && Math.abs(sa.number - sb.number) <= 2;
}

function pair(a: SimilarityInput, b: SimilarityInput): SimilarityComparison | null {
  if (!isValidSignature(a.signature) || !isValidSignature(b.signature) ||
      !Number.isFinite(a.aspectRatio) || !Number.isFinite(b.aspectRatio) || a.aspectRatio <= 0 || b.aspectRatio <= 0 ||
      Math.abs(a.aspectRatio / b.aspectRatio - 1) > 0.03) return null;
  // Cheap hash gate before the more expensive spatial comparison.
  let different = 0;
  for (let i = 0; i < 256; i += 1) if (a.signature.averageHash[i] !== b.signature.averageHash[i]) different += 1;
  if (different > 36) return null;
  const comparison = compareSignatures(a.signature, b.signature);
  return comparison.nearDuplicate || (comparison.similarScene && relatedTime(a, b)) ? comparison : null;
}

export function computeSimilarityGroups(items: SimilarityInput[]): Map<string, SimilarityAssignment> {
  const assignments = new Map<string, SimilarityAssignment>(items.map(item => [item.id, {}]));
  const sorted = items.filter(item => isValidSignature(item.signature)).sort((a, b) =>
    (a.exif?.captureTimeMs ?? 0) - (b.exif?.captureTimeMs ?? 0) || lexical(a.filename, b.filename) || lexical(a.id, b.id));
  const groups: SimilarityInput[][] = [];
  const buckets = new Map<string, Set<number>>();
  const keys = (item: SimilarityInput) => Array.from({ length: 8 }, (_, band) => `${band}:${item.signature!.averageHash.slice(band * 32, band * 32 + 32)}`);
  for (const item of sorted) {
    const candidates = new Set<number>();
    const start = sorted.length <= SIMILARITY_EXACT_LIMIT ? 0 : Math.max(0, groups.length - 64);
    for (let i = start; i < groups.length; i += 1) candidates.add(i);
    for (const key of keys(item)) for (const index of buckets.get(key) ?? []) candidates.add(index);
    let found = -1;
    for (const index of candidates) {
      const group = groups[index];
      // Complete linkage prevents A~B~C chains from hiding different scenes.
      if (group.length < MAX_SERIES_SIZE && group.every(member => pair(item, member))) { found = index; break; }
    }
    if (found < 0) { found = groups.length; groups.push([]); }
    groups[found].push(item);
    for (const key of keys(item)) {
      const bucket = buckets.get(key) ?? new Set<number>();
      bucket.add(found);
      // Bounded candidates for large batches; overflow remains ungrouped.
      if (bucket.size > 64) bucket.delete(bucket.values().next().value!);
      buckets.set(key, bucket);
    }
  }
  for (const group of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.finalScore - a.finalScore || lexical(a.filename, b.filename) || lexical(a.id, b.id));
    const best = group[0];
    let nearDuplicate = true;
    for (let i = 0; i < group.length; i += 1) for (let j = 0; j < i; j += 1) {
      if (!pair(group[i], group[j])?.nearDuplicate) nearDuplicate = false;
    }
    const groupId = `series:${[...group].sort((a, b) => lexical(a.id, b.id))[0].id}`;
    group.forEach((item, rank) => assignments.set(item.id, {
      duplicateGroupId: groupId, isBestInGroup: rank === 0, groupRank: rank + 1,
      groupKind: nearDuplicate ? 'near-duplicate' : 'burst', similarityToBest: pair(item, best)?.score ?? 1,
      relativeSharpness: Math.max(0, item.sharpness) / Math.max(1, best.sharpness),
      scoreGap: Math.max(0, best.finalScore - item.finalScore) / Math.max(1, best.finalScore),
      referenceDetailConfidence: best.detailConfidence ?? 0,
    }));
  }
  return assignments;
}
