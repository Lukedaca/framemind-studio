// Pure local scoring and grouping; browser I/O belongs to cullingSession/worker.
import type { CullingDecision, CullingExif, CullingGenre, CullingMetrics, CullingNativeMetrics, CullingOptics, CullingResult,
  CullingScoreBreakdown, CullingScorePart, CullingSignature, CullingVerdictSource, CullingIntent, CullingFocusMeasurement,
  CullingOutputTarget, CullingStrictnessLevel, CullingStrictnessMode, CullingStrictnessRecommendation } from '../types';
import { clamp01 } from './cullingMetrics';
import { compareAlignedSignatures, compareSignatures, isValidSignature, type SimilarityComparison } from './cullingSimilarity';
import { comparableFocus, focusMeasurements, focusSharpness, severelySoftFocus, validFocusEvidence } from './cullingRegions';
import { validAutomaticEvidence } from './cullingAutomatic';
import { OUTPUT_SHARP, opticalMotionBlur, opticalSharpness, opticsVerdict, outputScale, reliableOptics, sharpestTile, type OpticsVerdict } from './cullingOptics';

export const CULLING_ENGINE_VERSION = 'local-2.0';
export const CULLING_STRICTNESS_LEVELS: CullingStrictnessLevel[] = ['conservative', 'balanced', 'strict'];
export const CULLING_STRICTNESS_MODES: CullingStrictnessMode[] = ['auto', 'conservative', 'balanced', 'strict'];

/**
 * Optical evidence for one delivery size. Only without a photographer-chosen focus
 * area: the salient object is the model's guess, the chosen area is the intent.
 */
function optics(metrics: CullingMetrics, target: CullingOutputTarget): OpticsVerdict | undefined {
  if (focusMeasurements(metrics).length || !reliableOptics(metrics.optics)) return undefined;
  const verdict = opticsVerdict(metrics.optics, target);
  return verdict.kind === 'unmeasured' ? undefined : verdict;
}
export const CULLING_INTENTS: CullingIntent[] = ['standard', 'detail', 'motion', 'creative', 'stack'];
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

function nativeSharpness(metrics: CullingMetrics): number {
  const selected = focusSharpness(metrics);
  if (selected !== undefined) return selected;
  if (metrics.automatic?.status === 'measured' && metrics.automatic.summary && metrics.automatic.summary.informativeSamples >= 2)
    return Math.min(metrics.sharpnessScore, metrics.automatic.summary.maxSharpnessScore);
  const native = metrics.native;
  return native && (native.fixedInformativeSamples ?? native.informativeSamples) >= 2 ?
    Math.min(metrics.sharpnessScore, native.fixedMaxSharpnessScore ?? native.maxSharpnessScore) : metrics.sharpnessScore;
}

const referenceDetail = (native: CullingNativeMetrics) => native.fixedMaxLaplacianVariance ?? native.maxLaplacianVariance;
const referenceSamples = (native: CullingNativeMetrics) => native.fixedInformativeSamples ?? native.informativeSamples;
const referenceSharpness = (native: CullingNativeMetrics) => native.fixedMaxSharpnessScore ?? native.maxSharpnessScore;

export function computeScoreBreakdown(metrics: CullingMetrics, genre: CullingGenre | null, intent: CullingIntent = 'standard',
  target: CullingOutputTarget = 'full'): CullingScoreBreakdown {
  const technical = metrics.technical;
  const weights = [...(profiles[genre ?? 'other'] ?? profiles.other)];
  if (intent === 'motion') { weights[0] = 0; weights[5] = 0; }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!validFocusEvidence(metrics) || !validAutomaticEvidence(metrics)) return Object.fromEntries(PARTS.map((part, i) =>
    [part, { score: 0, weight: weights[i] / total, contribution: 0 }])) as CullingScoreBreakdown;
  const selected = focusMeasurements(metrics);
  const auto = metrics.automatic?.status === 'measured' ? metrics.automatic : undefined;
  const confidence = [selected.length ? Math.min(...selected.map(f => f.technical.detailConfidence)) :
    auto?.samples.length ? Math.max(...auto.samples.map(f => f.technical.detailConfidence)) : technical?.detailConfidence ?? 0,
    1, 1, technical?.noiseConfidence ?? 0, 1, technical?.motionConfidence ?? 0];
  // Blur in pixels is independent of texture; it replaces texture energy when measured.
  const optical = optics(metrics, target);
  if (optical?.outputBlur !== undefined) confidence[0] = 1;
  // Sharpness away from the detected object: either a missed focus or the object is not the subject.
  // The score stays between the two readings; the review risk carries the question.
  const opticalScore = optical?.outputBlur === undefined ? undefined : optical.kind === 'focus-elsewhere'
    ? (opticalSharpness(optical.outputBlur) + opticalSharpness(metrics.optics!.frameBlur! * outputScale(target, metrics.optics!.sourceWidth, metrics.optics!.sourceHeight))) / 2
    : opticalSharpness(optical.outputBlur);
  const values = [opticalScore ?? nativeSharpness(metrics), metrics.exposureScore,
    1 - Math.min(1, (metrics.highlightClipping + metrics.shadowClipping) * 1.5),
    metrics.noiseScore, metrics.contrastScore, 1 - (technical?.motionBlurEstimate ?? 0)];
  return Object.fromEntries(PARTS.map((part, i) => {
    const weight = weights[i] / Math.max(1e-9, total);
    // Weak detail evidence must not remove its weight and inflate a blurred photo's score.
    const evidence = clamp01(confidence[i]);
    const score = (clamp01(values[i]) * evidence + 0.5 * (1 - evidence)) * 100;
    return [part, { score, weight, contribution: score * weight }];
  })) as CullingScoreBreakdown;
}

export function computeFinalScore(metrics: CullingMetrics, genre: CullingGenre | null, intent: CullingIntent = 'standard',
  target: CullingOutputTarget = 'full'): number {
  return Math.round(Object.values(computeScoreBreakdown(metrics, genre, intent, target)).reduce((sum, item) => sum + item.contribution, 0));
}

type DecisionContext = Pick<CullingResult, 'duplicateGroupId' | 'isBestInGroup' | 'groupKind' | 'similarityToBest' | 'relativeSharpness' | 'scoreGap' | 'referenceDetailConfidence' | 'relativeNativeSharpness' | 'referenceNativeSharpness' | 'duplicateVerified' | 'intent' | 'focusComparisonVerified' | 'relativeFocusSharpness' | 'referenceFocusSharpness' | 'target' | 'strictness' | 'opticalSeriesBlur' | 'referenceOpticalBlur' | 'opticalSeriesRatio'>;
// Texture-energy blur signals. Measured edge blur in pixels supersedes them.
const TEXTURE_SOFT_RISKS = ['cull_risk_auto_soft', 'cull_risk_native_soft', 'cull_risk_preview_soft', 'cull_risk_detail_outside_grid', 'cull_risk_soft_vs_series', 'cull_risk_low_detail'];
const TEXTURE_BLUR_REJECTS = ['cull_reason_native_blur', 'cull_reason_auto_blur', 'cull_reason_soft_alternative'];
export function deriveTechnicalDecision(metrics: CullingMetrics, finalScore: number,
  context: DecisionContext = {}):
  { decision: CullingDecision; reasons: string[]; risks: string[]; rejectionKind?: CullingResult['rejectionKind'] } {
  const technical = metrics.technical;
  if (!technical || !Object.values(technical).every(Number.isFinite) || !validFocusEvidence(metrics) || !validAutomaticEvidence(metrics) ||
      (metrics.native && !Object.values(metrics.native).every(v => Number.isFinite(v) && v >= 0))) {
    return { decision: 'review', reasons: ['cull_reason_reanalyze'], risks: ['cull_risk_missing_metrics'] };
  }
  const risks: string[] = [];
  const reasons: string[] = [];
  const selected = focusMeasurements(metrics);
  const auto = !selected.length && metrics.automatic?.status === 'measured' ? metrics.automatic : undefined;
  const focus = selected[0] ?? auto?.samples[0];
  const intent = context.intent ?? 'standard', assessBlur = !['motion', 'creative', 'stack'].includes(intent);
  const strictness: CullingStrictnessLevel = context.strictness ?? 'balanced';
  const maxBlurNoise = strictness === 'conservative' ? 5 : 8;
  const target = context.target ?? 'full';
  if (selected.length && assessBlur) {
    if (selected.some(f => f.technical.detailConfidence < 0.15 || f.sharpnessScore < 0.6)) risks.push('cull_risk_focus_soft');
    else reasons.push('cull_reason_focus_detail');
  }
  if (auto && assessBlur) {
    if ((auto.summary?.informativeSamples ?? 0) < 2 || nativeSharpness(metrics) < .6) risks.push('cull_risk_auto_soft');
    else reasons.push('cull_reason_auto_detail');
  }
  if (!selected.length && metrics.automatic?.status === 'unavailable') risks.push('cull_risk_auto_unavailable');
  const details = selected.length ? selected.map(f => f.technical) : auto ? auto.samples.map(f => f.technical) : [technical];
  if (details.some(detail => detail.noiseConfidence >= 0.6 && detail.noiseEstimate > 6 &&
      (detail.scaleConsistency ?? 1) < 0.25 && (detail.fineEdgeEnergy ?? 0) > 1)) risks.push('cull_risk_scale_conflict');
  if (!focus && assessBlur) {
    if (technical.detailConfidence < 0.15 || (metrics.native && referenceSamples(metrics.native) < 2)) risks.push('cull_risk_low_detail');
    else if (nativeSharpness(metrics) >= 0.6) reasons.push(metrics.native ? 'cull_reason_native_detail' : 'cull_reason_detail');
    else risks.push(metrics.native ? 'cull_risk_native_soft' : 'cull_risk_preview_soft');
  }
  if (!focus && assessBlur && metrics.native && referenceSharpness(metrics.native) < 0.6 && metrics.native.maxLaplacianVariance >= 8 &&
      metrics.native.maxLaplacianVariance > referenceDetail(metrics.native) * 1.25) risks.push('cull_risk_detail_outside_grid');
  if (metrics.highlightClipping > 0.1) risks.push('cull_risk_highlights');
  if (metrics.shadowClipping > 0.25) risks.push('cull_risk_shadows');
  if (Math.max(technical.redClip, technical.greenClip, technical.blueClip) > 0.2 && metrics.highlightClipping <= 0.1) risks.push('cull_risk_channel_clip');
  if ([technical, ...details].some(detail => detail.noiseConfidence >= 0.6 && detail.noiseEstimate > 18)) risks.push('cull_risk_noise');
  if (assessBlur && technical.motionConfidence >= 0.6 && technical.motionBlurEstimate > 0.7) risks.push('cull_risk_direction');
  if (!risks.includes('cull_risk_highlights') && !risks.includes('cull_risk_shadows')) reasons.push('cull_reason_range');
  if (context.duplicateGroupId) {
    if (context.isBestInGroup) reasons.push('cull_reason_best_in_group');
    else {
      risks.push(context.groupKind === 'near-duplicate' ? 'cull_risk_duplicate' : 'cull_risk_series_alternative');
      if (assessBlur && !focus && (context.referenceDetailConfidence ?? 0) >= 0.3 && (context.relativeSharpness ?? 1) < 0.5 && technical.detailConfidence >= 0.3) risks.push('cull_risk_soft_vs_series');
      if (assessBlur && context.focusComparisonVerified && (context.relativeFocusSharpness ?? 1) < 0.5) risks.push('cull_risk_focus_vs_series');
    }
  }
  // A small product, star or distant subject can occupy less than 1% of a frame.
  // Percentile range/entropy cannot establish emptiness; every preview pixel
  // must be clipped, and any measured original-scale structure vetoes rejection.
  const emptyHighlights = metrics.highlightClipping === 1 &&
    Math.min(technical.redClip, technical.greenClip, technical.blueClip) === 1;
  const emptyShadows = metrics.shadowClipping === 1 &&
    Math.min(technical.redShadowClip, technical.greenShadowClip, technical.blueShadowClip) === 1;
  const emptyClippedPreview = (emptyHighlights || emptyShadows) && technical.dynamicRange <= 8 && technical.entropy < 1 &&
      (!metrics.native || (metrics.native.informativeSamples === 0 && metrics.native.maxLaplacianVariance <= .01)) &&
      [...selected, ...(auto?.samples ?? [])].every(f => f.technical.dynamicRange <= 8 && f.technical.entropy < 1);
  const native = metrics.native;
  // Broad, measurable edges but almost no fine detail across the 1:1 sample grid.
  // Low texture, extreme noise and any observed sharp patch veto this suggestion.
  const severelySoftNative = !focus && native && (native.fixedSampleCount ?? native.sampleCount) >= 9 && referenceSamples(native) >= 5 &&
    native.maxSharpnessScore < 0.56 && native.maxLaplacianVariance < 8 &&
    native.maxEdgeAcutance < 0.012 && native.maxNoiseEstimate < maxBlurNoise;
  const alternative = !!context.duplicateGroupId && context.isBestInGroup === false;
  const redundantCopy = alternative && context.groupKind === 'near-duplicate' &&
    (context.similarityToBest ?? 0) >= 0.965 && context.duplicateVerified === true;
  if (alternative && context.groupKind === 'near-duplicate' && context.duplicateVerified !== true) risks.push('cull_risk_duplicate_unverified');
  // Relative rejection is restricted to verified similar frames with a measurable,
  // technically stronger reference. Never rank unrelated photos by global texture.
  const referenceScore = finalScore / Math.max(0.01, 1 - (context.scoreGap ?? 0));
  const muchSofterAlternative = !focus && alternative && (context.groupKind === 'burst' || context.groupKind === 'near-duplicate') &&
    (context.similarityToBest ?? 0) >= 0.84 && Number.isFinite(context.scoreGap) &&
    (context.scoreGap ?? 0) < 1 &&
    Number.isFinite(context.relativeSharpness) && (context.relativeSharpness ?? 1) >= 0 &&
    (context.relativeSharpness ?? 1) < 0.35 && (context.scoreGap ?? 0) > 0.1 &&
    (context.referenceDetailConfidence ?? 0) >= 0.35 && referenceScore >= 75;
  // Downscaling can hide defocus or even reverse the preview's ranking. A native
  // deficit is usable only with matching resolutions, a genuinely sharp reference,
  // and independently soft, informative, non-noisy samples in the candidate itself.
  // A sharp sampled patch still vetoes rejection even when the other frame is sharper.
  const muchSofterNativeAlternative = !focus && alternative && (context.groupKind === 'burst' || context.groupKind === 'near-duplicate') &&
    (context.similarityToBest ?? 0) >= 0.84 && (context.referenceDetailConfidence ?? 0) >= 0.6 &&
    Number.isFinite(context.relativeNativeSharpness) && (context.relativeNativeSharpness ?? 1) >= 0 &&
    (context.relativeNativeSharpness ?? 1) < 0.25 && (context.referenceNativeSharpness ?? 0) >= 0.7 &&
    Number.isFinite(context.relativeSharpness) && (context.relativeSharpness ?? 2) <= 1.2 &&
    native && referenceSamples(native) >= 5 && native.maxSharpnessScore < 0.6 && native.maxNoiseEstimate < maxBlurNoise;
  const softSelectedRegion = intent === 'detail' && selected.some(f => severelySoftFocus(f, maxBlurNoise));
  const softerSelectedAlternative = assessBlur && alternative && context.focusComparisonVerified === true &&
    (context.relativeFocusSharpness ?? 1) < 0.25 && (context.referenceFocusSharpness ?? 0) >= 0.7 && selected.some(f => severelySoftFocus(f, maxBlurNoise));
  const protectedSet = intent === 'stack' || intent === 'creative';
  const automaticBlur = assessBlur && auto && auto.coverage >= .0025 && auto.coverage <= .65 &&
    auto.summary && auto.summary.informativeSamples >= 3 && auto.summary.sampleCount >= 3 &&
    auto.summary.maxSharpnessScore < .6 && auto.summary.maxLaplacianVariance < 8 &&
    auto.summary.maxEdgeAcutance < .012 && auto.summary.maxNoiseEstimate < maxBlurNoise;
  const optical = assessBlur ? optics(metrics, target) : undefined;
  const scale = metrics.optics ? outputScale(target, metrics.optics.sourceWidth, metrics.optics.sourceHeight) : 1;
  // Directional motion blur: edges parallel to camera/subject motion stay sharp while
  // perpendicular edges smear. The 4-orientation optical bins expose this directly.
  const motion = assessBlur && !selected.length && reliableOptics(metrics.optics) ? opticalMotionBlur(metrics.optics, target) : undefined;
  const opticalMotionReject = !!motion && (
    strictness === 'strict' ? motion.maxBlur >= 1.6 && motion.ratio >= 1.8
      : strictness === 'balanced' ? motion.maxBlur >= 2.2 && motion.ratio >= 2.0
        : false);
  const opticalMotionReview = !!motion && !opticalMotionReject && (
    strictness === 'strict' ? motion.maxBlur >= 1.3 && motion.ratio >= 1.5
      : strictness === 'balanced' ? motion.maxBlur >= 1.5 && motion.ratio >= 1.7
        : motion.maxBlur >= 2.4 && motion.ratio >= 2.2);
  if (opticalMotionReject || opticalMotionReview) risks.push('cull_risk_optics_motion');
  const opticallySharp = (optical?.kind === 'subject-sharp' || optical?.kind === 'frame-sharp') && !opticalMotionReject && !opticalMotionReview;
  if (opticallySharp) {
    // Texture energy cannot tell plain surfaces from blur; sharp measured edges can.
    for (let i = risks.length - 1; i >= 0; i--) if (TEXTURE_SOFT_RISKS.includes(risks[i])) risks.splice(i, 1);
    // A few sharp edges in a salient mask can belong to background or another
    // object. Strong contradictory object samples require review, not approval.
    // Downscaling genuinely soft detail to a sharp delivery size is not a conflict.
    const nativeOptical = optics(metrics, 'full');
    if (automaticBlur && (nativeOptical?.kind === 'subject-sharp' || nativeOptical?.kind === 'frame-sharp'))
      risks.push('cull_risk_sharpness_conflict');
    else reasons.push('cull_reason_optics_sharp');
  } else if (optical && !opticalMotionReject && !opticalMotionReview) {
    risks.push(optical.kind === 'focus-elsewhere' ? 'cull_risk_optics_focus_elsewhere' : 'cull_risk_optics_soft');
  }
  // Fine print or dense mesh has no isolated step edges; only genuinely crisp fine texture
  // (high Laplacian variance + acutance) vetoes an optical blur verdict in balanced/strict modes.
  const textureDetail = nativeSharpness(metrics) >= 0.6 || (metrics.native?.maxSharpnessScore ?? 0) >= 0.6 ||
    risks.includes('cull_risk_detail_outside_grid') || (auto?.summary?.maxSharpnessScore ?? 0) >= 0.6;
  const strongFineTexture =
    (!metrics.native && metrics.sharpnessScore >= 0.72 && technical.laplacianVariance >= 45) ||
    (!!metrics.native && metrics.native.maxSharpnessScore >= 0.72 && metrics.native.maxLaplacianVariance >= 45 && metrics.native.maxEdgeAcutance >= 0.02) ||
    (!!auto?.summary && auto.summary.maxSharpnessScore >= 0.72 && auto.summary.maxLaplacianVariance >= 45 && auto.summary.maxEdgeAcutance >= 0.02);
  const opticalBlur = strictness === 'conservative'
    ? optical?.kind === 'frame-blurred' && sharpestTile(metrics.optics!) * scale > OUTPUT_SHARP && !textureDetail
    : strictness === 'strict'
      ? (optical?.kind === 'frame-blurred' || (optical?.kind === 'frame-soft' && (optical.outputBlur ?? 0) >= 1.3)) && !strongFineTexture
      : optical?.kind === 'frame-blurred' && !strongFineTexture;
  // Out-of-focus main object (including back-focus onto a sharp background).
  const subjectSharpTexture = !!auto?.summary && auto.summary.maxSharpnessScore >= 0.72 &&
    auto.summary.maxLaplacianVariance >= 45 && auto.summary.maxEdgeAcutance >= 0.02;
  const subjectCoverageOk = (metrics.automatic?.coverage ?? 0.2) <= 0.65;
  const subjectOut = reliableOptics(metrics.optics) && metrics.optics.subjectBlur !== undefined ? metrics.optics.subjectBlur * scale : undefined;
  const opticalSubjectBlur = assessBlur && !selected.length && !opticalBlur && subjectOut !== undefined &&
    (metrics.optics?.subjectTiles ?? 0) >= 4 && subjectCoverageOk && !subjectSharpTexture && (
      strictness === 'strict' ? subjectOut >= 1.55
        : strictness === 'balanced' ? subjectOut >= 2.2
          : false);
  // Optically softer alternative inside a verified burst/similar series with a sharp winner.
  const opticalSeriesBlurReject = assessBlur && !selected.length && alternative &&
    context.opticalSeriesBlur !== undefined && context.referenceOpticalBlur !== undefined &&
    context.opticalSeriesRatio !== undefined && (context.referenceOpticalBlur * scale) <= OUTPUT_SHARP && (
      strictness === 'strict' ? context.opticalSeriesBlur * scale >= 1.25 && context.opticalSeriesRatio >= 1.35
        : strictness === 'balanced' ? context.opticalSeriesBlur * scale >= 1.55 && context.opticalSeriesRatio >= 1.55
          : context.opticalSeriesBlur * scale >= 2.0 && context.opticalSeriesRatio >= 2.0);
  // Ruined exposure blowout/blackout confirmed by optical or native measurement (protects sparse high/low-key subjects).
  const hasFullScaleEvidence = reliableOptics(metrics.optics) || !!metrics.native;
  const hasSharpSubject = opticallySharp || (metrics.native?.maxSharpnessScore ?? 0) >= 0.55;
  const severeExposure = strictness !== 'conservative' && hasFullScaleEvidence && !hasSharpSubject && (
    (metrics.highlightClipping >= (strictness === 'strict' ? 0.75 : 0.88) && technical.p5 >= 210) ||
    (metrics.shadowClipping >= (strictness === 'strict' ? 0.85 : 0.92) && technical.p95 <= 28));
  const rejectReasons = protectedSet ? [] : [
    ...(opticalBlur ? ['cull_reason_optics_blur'] : []),
    ...(opticalSubjectBlur ? ['cull_reason_optics_subject_blur'] : []),
    ...(opticalMotionReject ? ['cull_reason_optics_motion_blur'] : []),
    ...(opticalSeriesBlurReject ? ['cull_reason_optics_series_blur'] : []),
    ...(emptyClippedPreview ? ['cull_reason_empty_clipped'] : []),
    ...(severeExposure ? ['cull_reason_severe_exposure'] : []),
    ...(assessBlur && severelySoftNative ? ['cull_reason_native_blur'] : []),
    ...(softSelectedRegion ? ['cull_reason_focus_blur'] : []),
    ...(automaticBlur ? ['cull_reason_auto_blur'] : []),
    ...(redundantCopy ? ['cull_reason_redundant_copy'] : []),
    ...(assessBlur && (muchSofterAlternative || muchSofterNativeAlternative) ? ['cull_reason_soft_alternative'] : []),
    ...(softerSelectedAlternative ? ['cull_reason_focus_alternative'] : []),
  ].filter(reason => !optical || !TEXTURE_BLUR_REJECTS.includes(reason) || !opticallySharp);
  if (intent !== 'standard') reasons.push('cull_reason_intent_' + intent);
  const decision = rejectReasons.length ? 'reject' : risks.length || finalScore < 75 ? 'review' : 'keep';
  reasons.unshift(...rejectReasons);
  if (decision === 'review') reasons.push('cull_reason_needs_review');
  const technicalRejection = rejectReasons.some(r => r !== 'cull_reason_redundant_copy');
  return { decision, reasons, risks, rejectionKind: decision === 'reject' ? technicalRejection ? 'technical' : 'redundant' : undefined };
}

export interface PhotoAnalysis {
  focusRegion?: CullingResult['focusRegion'];
  focusRegions?: CullingResult['focusRegions'];
  metrics: CullingMetrics;
  aspectRatio: number;
  source: NonNullable<CullingResult['source']>;
  exif?: CullingExif;
}

export function buildCullingResult(analysis: PhotoAnalysis, genre: CullingGenre | null, intent: CullingIntent = 'standard',
  target: CullingOutputTarget = 'full', strictness: CullingStrictnessLevel = 'balanced'): CullingResult {
  const finalScore = computeFinalScore(analysis.metrics, genre, intent, target);
  return { ...analysis, intent, target, strictness, finalScore,
    ...deriveTechnicalDecision(analysis.metrics, finalScore, { intent, target, strictness }), genre: genre ?? undefined,
    scoreBreakdown: computeScoreBreakdown(analysis.metrics, genre, intent, target), engineVersion: CULLING_ENGINE_VERSION, analysisStatus: 'done' };
}

/** Delivery size and strictness are judgements, not measurements: changing them never needs the pixels again. */
export function rescoreCullingResult(result: CullingResult, genre: CullingGenre | null, target: CullingOutputTarget = result.target ?? 'full',
  strictness: CullingStrictnessLevel = result.strictness ?? 'balanced'): CullingResult {
  if (result.engineVersion !== CULLING_ENGINE_VERSION || result.analysisStatus === 'error') return result;
  const finalScore = computeFinalScore(result.metrics, genre, result.intent, target);
  return { ...result, target, strictness, finalScore, genre: genre ?? undefined, scoreBreakdown: computeScoreBreakdown(result.metrics, genre, result.intent, target),
    ...deriveTechnicalDecision(result.metrics, finalScore, { ...result, target, strictness }) };
}

/**
 * Automatically selects conservative, balanced or strict culling thresholds from the
 * batch's measured optical quality, noise level and burst structure. Deterministic and
 * local — never imposes a fixed reject quota (an all-sharp gallery still rejects 0).
 */
export function recommendCullingStrictness(results: CullingResult[], target: CullingOutputTarget = 'full'): CullingStrictnessRecommendation {
  const valid = results.filter(r => r.engineVersion === CULLING_ENGINE_VERSION && r.analysisStatus === 'done');
  if (!valid.length) {
    return { level: 'balanced', reason: 'cull_strict_auto_balanced', stats: { measured: 0, opticalCoverage: 0, sharpShare: 0, seriesShare: 0, medianNoise: 0 } };
  }
  const opticalBlurs: number[] = [];
  const noises: number[] = [];
  let sharpCount = 0;
  let seriesCount = 0;
  for (const r of valid) {
    if (r.duplicateGroupId) seriesCount++;
    const opt = r.metrics.optics;
    if (reliableOptics(opt)) {
      const rawBlur = opt.subjectBlur ?? opt.frameBlur;
      if (rawBlur !== undefined) {
        const scale = outputScale(target, opt.sourceWidth, opt.sourceHeight);
        const outBlur = rawBlur * scale;
        const motion = opticalMotionBlur(opt, target);
        const motionBlurred = !!motion && motion.maxBlur >= 2.2 && motion.ratio >= 2.0;
        opticalBlurs.push(outBlur);
        if (outBlur <= OUTPUT_SHARP && !motionBlurred) sharpCount++;
      }
      noises.push(opt.noise);
    } else if (r.metrics.technical) {
      noises.push(r.metrics.technical.noiseEstimate);
    }
  }
  const opticalCoverage = opticalBlurs.length / valid.length;
  const sharpShare = opticalBlurs.length ? sharpCount / opticalBlurs.length : 0;
  const seriesShare = seriesCount / valid.length;
  noises.sort((a, b) => a - b);
  const medianNoise = noises.length ? noises[Math.floor(noises.length / 2)] : 0;
  opticalBlurs.sort((a, b) => a - b);
  const baselineBlur = opticalBlurs.length ? opticalBlurs[Math.floor((opticalBlurs.length - 1) * 0.25)] : undefined;
  const stats = { measured: valid.length, opticalCoverage, sharpShare, seriesShare, medianNoise, baselineBlur };

  if (medianNoise >= 7.5) {
    return { level: 'conservative', reason: 'cull_strict_auto_conservative_noise', stats };
  }
  if (valid.length < 6 && seriesCount === 0) {
    return { level: 'conservative', reason: 'cull_strict_auto_conservative_small', stats };
  }
  if (opticalCoverage < 0.4 || (baselineBlur !== undefined && baselineBlur > 1.05) || sharpShare < 0.30) {
    return { level: 'conservative', reason: 'cull_strict_auto_conservative_soft', stats };
  }
  if (valid.length >= 12 && opticalCoverage >= 0.6 && medianNoise < 4.5 &&
      baselineBlur !== undefined && baselineBlur <= 0.80 &&
      (sharpShare >= 0.55 || (sharpShare >= 0.45 && seriesShare >= 0.25))) {
    return { level: 'strict', reason: 'cull_strict_auto_strict', stats };
  }
  return { level: 'balanced', reason: 'cull_strict_auto_balanced', stats };
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
  native?: CullingNativeMetrics;
  optics?: CullingOptics;
  target?: CullingOutputTarget;
  focusRegions?: CullingFocusMeasurement[];
  intent?: CullingIntent;
  exif?: CullingExif;
}
export interface SimilarityAssignment {
  focusComparisonVerified?: boolean;
  relativeFocusSharpness?: number;
  referenceFocusSharpness?: number;
  opticalSeriesBlur?: number;
  referenceOpticalBlur?: number;
  opticalSeriesRatio?: number;
  duplicateGroupId?: string;
  isBestInGroup?: boolean;
  groupRank?: number;
  groupKind?: CullingResult['groupKind'];
  similarityToBest?: number;
  relativeSharpness?: number;
  scoreGap?: number;
  referenceDetailConfidence?: number;
  relativeNativeSharpness?: number;
  referenceNativeSharpness?: number;
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
  if ((a.intent ?? 'standard') !== (b.intent ?? 'standard') || a.intent === 'stack' || a.intent === 'creative') return null;
  if (!isValidSignature(a.signature) || !isValidSignature(b.signature) ||
      !Number.isFinite(a.aspectRatio) || !Number.isFinite(b.aspectRatio) || a.aspectRatio <= 0 || b.aspectRatio <= 0 ||
      Math.abs(a.aspectRatio / b.aspectRatio - 1) > 0.03) return null;
  // Cheap hash gate before the more expensive spatial comparison.
  let different = 0;
  for (let i = 0; i < 256; i += 1) if (a.signature.averageHash[i] !== b.signature.averageHash[i]) different += 1;
  const nearby = relatedTime(a, b);
  if (different > 36 && !nearby) return null;
  const comparison = compareSignatures(a.signature, b.signature);
  if (comparison.nearDuplicate || (comparison.similarScene && nearby)) return comparison;
  if (!nearby || different > 96) return null;
  const aligned = compareAlignedSignatures(a.signature, b.signature);
  return aligned.similarScene ? aligned : null;
}

export function computeSimilarityGroups(items: SimilarityInput[]): Map<string, SimilarityAssignment> {
  const assignments = new Map<string, SimilarityAssignment>(items.map(item => [item.id, {}]));
  const sorted = items.filter(item => isValidSignature(item.signature)).sort((a, b) =>
    (a.exif?.captureTimeMs ?? 0) - (b.exif?.captureTimeMs ?? 0) || lexical(a.filename, b.filename) || lexical(a.id, b.id));
  const groups: SimilarityInput[][] = [];
  const nearDuplicateGroups = new Set<number>();
  const buckets = new Map<string, Set<number>>();
  const keys = (item: SimilarityInput) => Array.from({ length: 8 }, (_, band) => `${band}:${item.signature!.averageHash.slice(band * 32, band * 32 + 32)}`);
  for (const item of sorted) {
    const candidates = new Set<number>();
    const start = sorted.length <= SIMILARITY_EXACT_LIMIT ? 0 : Math.max(0, groups.length - 64);
    for (let i = start; i < groups.length; i += 1) candidates.add(i);
    for (const key of keys(item)) for (const index of buckets.get(key) ?? []) candidates.add(index);
    let found = -1, joinsAsNearDuplicate = true;
    for (const index of candidates) {
      const group = groups[index];
      // Complete linkage prevents A~B~C chains from hiding different scenes.
      if (group.length >= MAX_SERIES_SIZE) continue;
      let allNearDuplicate = true;
      if (group.every(member => {
        const comparison = pair(item, member);
        if (!comparison?.nearDuplicate) allNearDuplicate = false;
        return comparison !== null;
      })) { found = index; joinsAsNearDuplicate = allNearDuplicate; break; }
    }
    if (found < 0) { found = groups.length; groups.push([]); nearDuplicateGroups.add(found); }
    else if (!joinsAsNearDuplicate) nearDuplicateGroups.delete(found);
    groups[found].push(item);
    for (const key of keys(item)) {
      const bucket = buckets.get(key) ?? new Set<number>();
      bucket.add(found);
      // Bounded candidates for large batches; overflow remains ungrouped.
      if (bucket.size > 64) bucket.delete(bucket.values().next().value!);
      buckets.set(key, bucket);
    }
  }
  for (const [index, group] of groups.entries()) {
    if (group.length < 2) continue;
    const regionalRanking = group.every((item, i) => (item.intent ?? 'standard') === (group[0].intent ?? 'standard') &&
      !['motion', 'creative', 'stack'].includes(item.intent ?? 'standard') &&
      group.slice(0, i + 1).every(other => comparableFocus(item.focusRegions, other.focusRegions)));
    const regionalScore = (item: SimilarityInput) => Math.min(...item.focusRegions!.map(f => f.sharpnessScore));
    const opticalMemberBlur = (item: SimilarityInput) => {
      if (!reliableOptics(item.optics)) return undefined;
      const raw = item.optics.subjectBlur ?? item.optics.frameBlur;
      return raw === undefined ? undefined : raw * outputScale(item.target ?? 'full', item.optics.sourceWidth, item.optics.sourceHeight);
    };
    const opticalCompare = (a: SimilarityInput, b: SimilarityInput) => {
      const ba = opticalMemberBlur(a), bb = opticalMemberBlur(b);
      if (ba === undefined || bb === undefined) return 0;
      const aSharp = ba <= OUTPUT_SHARP, bSharp = bb <= OUTPUT_SHARP;
      if (aSharp !== bSharp && Math.abs(ba - bb) >= 0.25) return aSharp ? -1 : 1;
      return 0;
    };
    group.sort((a, b) => (regionalRanking ? regionalScore(b) - regionalScore(a) : opticalCompare(a, b)) ||
      b.finalScore - a.finalScore || lexical(a.filename, b.filename) || lexical(a.id, b.id));
    const best = group[0];
    // Reuse the all-pairs evidence collected on admission instead of measuring
    // every pair again. Complete linkage and its scene-change veto are unchanged.
    const nearDuplicate = nearDuplicateGroups.has(index);
    const groupId = `series:${[...group].sort((a, b) => lexical(a.id, b.id))[0].id}`;
    const bestOptics = reliableOptics(best.optics) ? best.optics : undefined;
    const bestOpticsRaw = bestOptics ? (bestOptics.subjectBlur ?? bestOptics.frameBlur) : undefined;
    group.forEach((item, rank) => {
      // Compare like resolutions. Never divide a 1:1 measurement by a preview.
      const native = [item, best].every(frame => frame.native && Number.isFinite(referenceDetail(frame.native)) &&
        referenceDetail(frame.native) >= 0 && referenceSamples(frame.native) >= 3) &&
        item.native!.sourceWidth === best.native!.sourceWidth && item.native!.sourceHeight === best.native!.sourceHeight;
      const sharpness = native ? referenceDetail(item.native!) : item.sharpness;
      const reference = native ? referenceDetail(best.native!) : best.sharpness;
      const previewRatio = Math.max(0, item.sharpness) / Math.max(1, best.sharpness);
      // Keep the cross-scale ratio conservative. Original-scale rejection also
      // requires independently weak native detail, not just a stronger neighbour.
      const extraDetailRatio = native && rank !== 0 ? Math.max(0, item.native!.maxLaplacianVariance) / Math.max(1, reference) : 1;
      const relativeSharpness = native ? Math.max(previewRatio, Math.max(0, sharpness) / Math.max(1, reference), extraDetailRatio) : previewRatio;
      const itemOptics = reliableOptics(item.optics) ? item.optics : undefined;
      const opticalComparable = !regionalRanking && !!bestOptics && !!itemOptics && bestOpticsRaw !== undefined &&
        bestOptics.sourceWidth === itemOptics.sourceWidth && bestOptics.sourceHeight === itemOptics.sourceHeight;
      const itemOpticsRaw = opticalComparable ? (bestOptics!.subjectBlur !== undefined ? itemOptics!.subjectBlur ?? itemOptics!.frameBlur : itemOptics!.frameBlur) : undefined;
      assignments.set(item.id, {
        focusComparisonVerified: regionalRanking,
        relativeFocusSharpness: regionalRanking ? Math.min(...item.focusRegions!.map((f, i) =>
          f.technical.laplacianVariance / Math.max(1, best.focusRegions![i].technical.laplacianVariance))) : undefined,
        referenceFocusSharpness: regionalRanking && best.focusRegions!.every(f => f.technical.noiseEstimate < 8 &&
          f.technical.detailConfidence >= 0.6) ? regionalScore(best) : undefined,
        opticalSeriesBlur: itemOpticsRaw,
        referenceOpticalBlur: itemOpticsRaw !== undefined ? bestOpticsRaw : undefined,
        opticalSeriesRatio: itemOpticsRaw !== undefined && bestOpticsRaw !== undefined ? itemOpticsRaw / Math.max(0.25, bestOpticsRaw) : undefined,
        duplicateGroupId: groupId, isBestInGroup: rank === 0, groupRank: rank + 1,
        groupKind: nearDuplicate ? 'near-duplicate' : 'burst', similarityToBest: pair(item, best)?.score ?? 1,
        relativeSharpness,
        scoreGap: Math.max(0, best.finalScore - item.finalScore) / Math.max(1, best.finalScore),
        referenceDetailConfidence: item.focusRegions?.length || best.focusRegions?.length ? 0 :
          native ? Math.min(1, referenceSamples(best.native!) / 5) : best.detailConfidence ?? 0,
        relativeNativeSharpness: native ? Math.max(0, sharpness) / Math.max(1, reference) : undefined,
        referenceNativeSharpness: native && referenceSamples(best.native!) >= 5 && best.native!.maxNoiseEstimate < 8 ? referenceSharpness(best.native!) : undefined,
      });
    });
  }
  return assignments;
}
