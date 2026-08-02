// On-device preference model ported from framemind-agent. It learns only from
// explicit Keep/Reject decisions and never uploads the stored samples.

import type { CullingDecision, CullingMetrics } from '../types';

const STORAGE_KEY = 'framemind.taste.v1';
const MIN_SAMPLES = 12;
const LEARN_RATE = 0.05;
const THRESHOLD_RATE = 0.015;
const SIGMOID_STEEPNESS = 6;

type TasteMetricKey =
  | 'sharpnessScore'
  | 'exposureScore'
  | 'contrastScore'
  | 'noiseScore'
  | 'compositionScore';

const METRIC_DEFS: Array<[TasteMetricKey, string]> = [
  ['sharpnessScore', 'ostrost'],
  ['exposureScore', 'expozici'],
  ['contrastScore', 'kontrast'],
  ['noiseScore', 'čistotu obrazu (šum)'],
  ['compositionScore', 'kompozici'],
];

const DEFAULT_WEIGHTS: Record<TasteMetricKey, number> = {
  sharpnessScore: 0.32,
  exposureScore: 0.19,
  contrastScore: 0.14,
  noiseScore: 0.12,
  compositionScore: 0.23,
};
const DEFAULT_THRESHOLD = 0.55;

interface TasteModel {
  samples: number;
  w: Record<TasteMetricKey, number>;
  t: number;
  updatedAt: number;
}

function freshModel(): TasteModel {
  return { samples: 0, w: { ...DEFAULT_WEIGHTS }, t: DEFAULT_THRESHOLD, updatedAt: 0 };
}

function load(): TasteModel {
  if (typeof localStorage === 'undefined') return freshModel();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as TasteModel | null;
    if (
      raw &&
      Number.isFinite(raw.samples) &&
      raw.w &&
      METRIC_DEFS.every(([key]) => Number.isFinite(raw.w[key])) &&
      Number.isFinite(raw.t)
    ) {
      return raw;
    }
  } catch {
    // Corrupt or unavailable storage falls back to a neutral profile.
  }
  return freshModel();
}

let model = load();

function save() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch {
    // Culling still works when storage is blocked or full.
  }
}

function clamp01(value: number | undefined): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? Number(value) : 0));
}

function weightedScore(metrics: CullingMetrics, weights: Record<TasteMetricKey, number>): number {
  return METRIC_DEFS.reduce((score, [key]) => score + weights[key] * clamp01(metrics[key]), 0);
}

function sigmoid(score: number): number {
  return 1 / (1 + Math.exp(-SIGMOID_STEEPNESS * (score - model.t)));
}

export function recordTasteSample(metrics: CullingMetrics, decision: CullingDecision) {
  if (decision !== 'keep' && decision !== 'reject') return;
  const target = decision === 'keep' ? 1 : 0;
  const predicted = sigmoid(weightedScore(metrics, model.w));
  const error = target - predicted;

  for (const [key] of METRIC_DEFS) {
    const next = model.w[key] + LEARN_RATE * error * clamp01(metrics[key]);
    model.w[key] = Math.min(0.6, Math.max(0.03, next));
  }
  const total = METRIC_DEFS.reduce((sum, [key]) => sum + model.w[key], 0);
  for (const [key] of METRIC_DEFS) model.w[key] /= total;

  model.t = Math.min(0.8, Math.max(0.3, model.t - THRESHOLD_RATE * error));
  model.samples += 1;
  model.updatedAt = Date.now();
  save();
}

export function isTasteReady(): boolean {
  return model.samples >= MIN_SAMPLES;
}

export function personalScore(metrics: CullingMetrics): number | null {
  return isTasteReady() ? sigmoid(weightedScore(metrics, model.w)) : null;
}

export function blendFinalScore(heuristicScore: number, metrics: CullingMetrics): number {
  const personal = personalScore(metrics);
  return personal === null ? heuristicScore : Math.round(heuristicScore * 0.75 + personal * 100 * 0.25);
}

export function getTasteProfile() {
  const deltas = METRIC_DEFS.map(([key, label]) => ({
    key,
    label,
    delta: model.w[key] - DEFAULT_WEIGHTS[key],
  }))
    .filter((item) => Math.abs(item.delta) >= 0.015)
    .sort((first, second) => Math.abs(second.delta) - Math.abs(first.delta));

  return {
    samples: model.samples,
    minSamples: MIN_SAMPLES,
    ready: isTasteReady(),
    deltas,
    strictness: model.t - DEFAULT_THRESHOLD,
  };
}

export function tasteHintForAi(): string | null {
  if (!isTasteReady()) return null;
  const profile = getTasteProfile();
  const parts = profile.deltas.slice(0, 3).map((item) =>
    `${item.delta > 0 ? 'klade nadprůměrný důraz na' : 'je tolerantnější ke slabší'} ${item.label}`
  );
  if (profile.strictness > 0.03) parts.push('celkově vybírá přísněji než průměr');
  else if (profile.strictness < -0.03) parts.push('celkově ponechává více snímků než průměr');
  if (!parts.length) return null;
  return `Tento fotograf ${parts.join('; ')} (naučeno z ${profile.samples} jeho ručních rozhodnutí). Zohledni to u hraničních případů.`;
}

export function resetTaste() {
  model = freshModel();
  save();
}
