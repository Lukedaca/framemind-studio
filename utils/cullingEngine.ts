// FrameMind culling engine — orchestrace lokálních heuristik, žánrových profilů
// a sbalení sérií. Portováno z FrameMind Agenta (frontend/src/app.js), aby obě
// aplikace dávaly stejné verdikty. AI verdikt (Gemini) žije v geminiService.
//
// Kalibrace: heuristiky se počítají na dekódu s delší stranou 420 px, AI thumb
// má 768 px. Prahy v cullingMetrics.ts jsou na 420 px navázané.

import type {
  CullingDecision,
  CullingGenre,
  CullingMetrics,
  CullingResult,
} from '../types';
import { readMetrics, hashToWords, hammingWords, clamp01 } from './cullingMetrics';

export const HEURISTIC_MAX_SIDE = 420;
export const AI_THUMB_MAX_SIDE = 768;

interface GenreProfile {
  label: string;
  weights: {
    sharpness: number;
    exposure: number;
    contrast: number;
    noise: number;
    composition: number;
    clipping: number;
  };
  eyesMatter: boolean;
  noiseRiskBelow: number;
  noiseMajorBelow: number;
  clipScale: number;
}

// Žánr rozhoduje, co je vada: zavřené oči zabijí portrét, u sportu nevadí;
// šum z haly na ISO 6400 není šum z produktovky. Váhy každého profilu = 1.0.
export const GENRE_PROFILES: Record<CullingGenre, GenreProfile> = {
  sport: {
    label: 'Sport / akce',
    weights: { sharpness: 0.38, exposure: 0.13, contrast: 0.09, noise: 0.03, composition: 0.31, clipping: 0.06 },
    eyesMatter: false, noiseRiskBelow: 0.18, noiseMajorBelow: 0.08, clipScale: 0.8,
  },
  portrait: {
    label: 'Portrét',
    weights: { sharpness: 0.34, exposure: 0.19, contrast: 0.1, noise: 0.13, composition: 0.18, clipping: 0.06 },
    eyesMatter: true, noiseRiskBelow: 0.34, noiseMajorBelow: 0.22, clipScale: 1,
  },
  wedding: {
    label: 'Svatba',
    weights: { sharpness: 0.3, exposure: 0.17, contrast: 0.1, noise: 0.08, composition: 0.29, clipping: 0.06 },
    eyesMatter: true, noiseRiskBelow: 0.26, noiseMajorBelow: 0.14, clipScale: 1,
  },
  product: {
    label: 'Produkt',
    weights: { sharpness: 0.38, exposure: 0.24, contrast: 0.11, noise: 0.15, composition: 0.06, clipping: 0.06 },
    eyesMatter: false, noiseRiskBelow: 0.45, noiseMajorBelow: 0.3, clipScale: 1.3,
  },
  landscape: {
    label: 'Krajina',
    weights: { sharpness: 0.33, exposure: 0.23, contrast: 0.12, noise: 0.1, composition: 0.16, clipping: 0.06 },
    eyesMatter: false, noiseRiskBelow: 0.34, noiseMajorBelow: 0.22, clipScale: 1.4,
  },
  street: {
    label: 'Street / dokument',
    weights: { sharpness: 0.22, exposure: 0.15, contrast: 0.12, noise: 0.04, composition: 0.41, clipping: 0.06 },
    eyesMatter: false, noiseRiskBelow: 0.15, noiseMajorBelow: 0.06, clipScale: 0.8,
  },
  wildlife: {
    label: 'Zvířata / příroda',
    weights: { sharpness: 0.4, exposure: 0.15, contrast: 0.09, noise: 0.06, composition: 0.24, clipping: 0.06 },
    eyesMatter: false, noiseRiskBelow: 0.22, noiseMajorBelow: 0.1, clipScale: 1,
  },
  event: {
    label: 'Reportáž / event',
    weights: { sharpness: 0.26, exposure: 0.16, contrast: 0.1, noise: 0.05, composition: 0.37, clipping: 0.06 },
    eyesMatter: false, noiseRiskBelow: 0.18, noiseMajorBelow: 0.08, clipScale: 0.9,
  },
  other: {
    label: 'Obecné',
    weights: { sharpness: 0.3, exposure: 0.18, contrast: 0.13, noise: 0.11, composition: 0.22, clipping: 0.06 },
    eyesMatter: true, noiseRiskBelow: 0.34, noiseMajorBelow: 0.22, clipScale: 1,
  },
};

export const CULLING_GENRES = Object.keys(GENRE_PROFILES) as CullingGenre[];

export function computeFinalScore(metrics: CullingMetrics, genre: CullingGenre | null): number {
  const profile = GENRE_PROFILES[genre || 'other'] || GENRE_PROFILES.other;
  const w = profile.weights;
  const clippingPenalty = Math.min(
    18,
    (metrics.highlightClipping + metrics.shadowClipping) * 160 * (profile.clipScale || 1)
  );
  const weighted =
    metrics.sharpnessScore * w.sharpness +
    metrics.exposureScore * w.exposure +
    metrics.contrastScore * w.contrast +
    metrics.noiseScore * w.noise +
    metrics.compositionScore * w.composition +
    (1 - Math.min(1, metrics.highlightClipping + metrics.shadowClipping)) * w.clipping;

  return Math.round(clamp01(weighted) * 100 - clippingPenalty);
}

export interface HeuristicDecision {
  decision: CullingDecision;
  reasons: string[]; // překladové klíče cull_reason_* / cull_risk_*
  risks: string[];
}

export function deriveHeuristicDecision(
  metrics: CullingMetrics,
  finalScore: number,
  genre: CullingGenre | null,
  group: { duplicateGroupId?: string; isBestInGroup?: boolean }
): HeuristicDecision {
  const profile = GENRE_PROFILES[genre || 'other'] || GENRE_PROFILES.other;
  const reasons: string[] = [];
  const risks: string[] = [];

  if (metrics.sharpnessScore >= 0.68) reasons.push('cull_reason_sharp');
  if (metrics.exposureScore >= 0.68) reasons.push('cull_reason_exposure');
  if (metrics.compositionScore >= 0.64) reasons.push('cull_reason_composition');
  if (group.isBestInGroup) reasons.push('cull_reason_best_in_group');

  if (metrics.sharpnessScore < 0.36) risks.push('cull_risk_blur');
  if (metrics.exposureScore < 0.22) {
    risks.push(metrics.shadowClipping > metrics.highlightClipping ? 'cull_risk_underexposed' : 'cull_risk_exposure');
  }
  if (metrics.highlightClipping > 0.06) risks.push('cull_risk_highlights');
  if (metrics.shadowClipping > 0.08) risks.push('cull_risk_shadows');
  if (metrics.noiseScore < profile.noiseRiskBelow) risks.push('cull_risk_noise');
  if (group.duplicateGroupId && !group.isBestInGroup) risks.push('cull_risk_duplicate');

  const hasMajorRisk =
    metrics.sharpnessScore < 0.28 ||
    metrics.exposureScore < 0.16 ||
    metrics.highlightClipping > 0.16 ||
    metrics.shadowClipping > 0.2 ||
    metrics.noiseScore < profile.noiseMajorBelow;

  let decision: CullingDecision = 'review';
  if (
    !hasMajorRisk &&
    (!group.duplicateGroupId || group.isBestInGroup) &&
    (finalScore >= 74 || (group.isBestInGroup && finalScore >= 60))
  ) {
    decision = 'keep';
  }
  if (finalScore < 42 || hasMajorRisk) {
    decision = 'reject';
  }
  if (group.duplicateGroupId && !group.isBestInGroup) {
    decision = finalScore >= 58 && !hasMajorRisk ? 'review' : 'reject';
  }

  return {
    decision,
    reasons: reasons.length ? reasons : [decision === 'reject' ? 'cull_reason_technical' : 'cull_reason_needs_review'],
    risks,
  };
}

export interface SimilarityInput {
  id: string;
  hash: string;
  aspectRatio: number;
  finalScore: number;
}

export interface SimilarityAssignment {
  duplicateGroupId?: string;
  isBestInGroup: boolean;
  groupRank: number;
}

// Union-find nad perceptual hashi: levný aspect-ratio test odfiltruje většinu
// párů, hamming přes bitová slova (XOR+popcount) rozhodne zbytek.
export function computeSimilarityGroups(items: SimilarityInput[]): Map<string, SimilarityAssignment> {
  const result = new Map<string, SimilarityAssignment>();
  for (const item of items) {
    result.set(item.id, { duplicateGroupId: undefined, isBestInGroup: false, groupRank: 0 });
  }

  const withHash = items.filter((item) => item.hash);
  const parent = new Map<string, string>(withHash.map((item) => [item.id, item.id]));

  const find = (id: string): string => {
    const current = parent.get(id)!;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  const words = new Map(withHash.map((item) => [item.id, hashToWords(item.hash)]));

  for (let i = 0; i < withHash.length; i += 1) {
    const first = withHash[i];
    const firstWords = words.get(first.id)!;
    for (let j = i + 1; j < withHash.length; j += 1) {
      const second = withHash[j];
      if (Math.abs((first.aspectRatio || 0) - (second.aspectRatio || 0)) >= 0.12) continue;
      if (hammingWords(firstWords, words.get(second.id)!) <= 20) union(first.id, second.id);
    }
  }

  const groups = new Map<string, SimilarityInput[]>();
  for (const item of withHash) {
    const root = find(item.id);
    const group = groups.get(root) || [];
    group.push(item);
    groups.set(root, group);
  }

  let groupIndex = 1;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const groupId = `G${groupIndex}`;
    groupIndex += 1;
    group.sort((a, b) => b.finalScore - a.finalScore);

    for (const [index, item] of group.entries()) {
      result.set(item.id, {
        duplicateGroupId: groupId,
        isBestInGroup: index === 0,
        groupRank: index + 1,
      });
    }
  }

  return result;
}

// --- Dekód fotky → metriky (worker s main-thread fallbackem) ---

let analysisWorker: Worker | null = null;
let workerBroken = false;
let analysisSeq = 0;
const pendingJobs = new Map<number, { resolve: (m: CullingMetrics) => void; reject: (e: Error) => void }>();

function getAnalysisWorker(): Worker | null {
  if (workerBroken) return null;
  if (analysisWorker) return analysisWorker;
  try {
    analysisWorker = new Worker(new URL('../workers/culling.worker.ts', import.meta.url), { type: 'module' });
    analysisWorker.onmessage = (event: MessageEvent<{ id: number; metrics?: CullingMetrics; error?: string }>) => {
      const { id, metrics, error } = event.data || ({} as never);
      const job = pendingJobs.get(id);
      if (!job) return;
      pendingJobs.delete(id);
      if (metrics) job.resolve(metrics);
      else job.reject(new Error(error || 'Culling worker failed'));
    };
    analysisWorker.onerror = () => {
      workerBroken = true;
      for (const job of pendingJobs.values()) job.reject(new Error('Culling worker crashed'));
      pendingJobs.clear();
      analysisWorker?.terminate();
      analysisWorker = null;
    };
    return analysisWorker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function computeMetrics(imageData: ImageData): Promise<CullingMetrics> {
  const worker = getAnalysisWorker();
  if (!worker) {
    return readMetrics(imageData.data, imageData.width, imageData.height);
  }

  // Buffer se kopíruje (žádný transfer) — při pádu workeru tak sync fallback
  // ještě drží platná data, detached buffer by vrátil samé nuly.
  return new Promise<CullingMetrics>((resolve, reject) => {
    analysisSeq += 1;
    const id = analysisSeq;
    pendingJobs.set(id, { resolve, reject });
    worker.postMessage({ id, data: imageData.data.buffer, width: imageData.width, height: imageData.height });
  }).catch(() => readMetrics(imageData.data, imageData.width, imageData.height));
}

async function loadImageSource(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // padáme na <img> cestu níže (např. nepodporovaný formát pro ImageBitmap)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Nelze dekódovat ${file.name}`));
      img.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export interface PhotoAnalysis {
  metrics: CullingMetrics;
  aspectRatio: number;
  aiThumbnailDataUrl: string;
}

export async function analyzePhotoPixels(file: File): Promise<PhotoAnalysis> {
  const loaded = await loadImageSource(file);
  try {
    const heuristicScale = Math.min(1, HEURISTIC_MAX_SIDE / Math.max(loaded.width, loaded.height));
    const hWidth = Math.max(32, Math.round(loaded.width * heuristicScale));
    const hHeight = Math.max(32, Math.round(loaded.height * heuristicScale));
    const heuristicCanvas = document.createElement('canvas');
    heuristicCanvas.width = hWidth;
    heuristicCanvas.height = hHeight;
    const hCtx = heuristicCanvas.getContext('2d', { willReadFrequently: true });
    if (!hCtx) throw new Error('Canvas context unavailable');
    hCtx.imageSmoothingEnabled = true;
    hCtx.imageSmoothingQuality = 'high';
    hCtx.drawImage(loaded.source, 0, 0, hWidth, hHeight);
    const imageData = hCtx.getImageData(0, 0, hWidth, hHeight);

    const metrics = await computeMetrics(imageData);

    const aiScale = Math.min(1, AI_THUMB_MAX_SIDE / Math.max(loaded.width, loaded.height));
    const aiWidth = Math.max(64, Math.round(loaded.width * aiScale));
    const aiHeight = Math.max(64, Math.round(loaded.height * aiScale));
    const aiCanvas = document.createElement('canvas');
    aiCanvas.width = aiWidth;
    aiCanvas.height = aiHeight;
    const aiCtx = aiCanvas.getContext('2d');
    if (!aiCtx) throw new Error('Canvas context unavailable');
    aiCtx.imageSmoothingEnabled = true;
    aiCtx.imageSmoothingQuality = 'high';
    aiCtx.drawImage(loaded.source, 0, 0, aiWidth, aiHeight);
    const aiThumbnailDataUrl = aiCanvas.toDataURL('image/jpeg', 0.85);

    return {
      metrics,
      aspectRatio: loaded.width > 0 && loaded.height > 0 ? loaded.width / loaded.height : 0,
      aiThumbnailDataUrl,
    };
  } finally {
    loaded.close();
  }
}

export function buildCullingResult(
  analysis: PhotoAnalysis,
  genre: CullingGenre | null
): CullingResult {
  const finalScore = computeFinalScore(analysis.metrics, genre);
  const heuristic = deriveHeuristicDecision(analysis.metrics, finalScore, genre, {});
  return {
    metrics: analysis.metrics,
    finalScore,
    decision: heuristic.decision,
    reasons: heuristic.reasons,
    risks: heuristic.risks,
    aspectRatio: analysis.aspectRatio,
    genre: genre || undefined,
    aiStatus: 'idle',
  };
}

// Přepočet po změně žánru nebo doběhnutí skupin: skóre + heuristický verdikt.
// AI verdikty a ruční rozhodnutí zůstávají autoritativní.
export function rescoreCullingResult(result: CullingResult, genre: CullingGenre | null): CullingResult {
  const finalScore = computeFinalScore(result.metrics, genre);
  const heuristic = deriveHeuristicDecision(result.metrics, finalScore, genre, {
    duplicateGroupId: result.duplicateGroupId,
    isBestInGroup: result.isBestInGroup,
  });
  const aiAuthoritative = result.aiStatus === 'done' && result.ai;
  return {
    ...result,
    finalScore,
    genre: genre || result.genre,
    decision: aiAuthoritative ? result.decision : heuristic.decision,
    reasons: aiAuthoritative ? result.reasons : heuristic.reasons,
    risks: aiAuthoritative ? result.risks : heuristic.risks,
  };
}

export function getEffectiveDecision(result: CullingResult | undefined): CullingDecision | null {
  if (!result) return null;
  return result.manualDecision || result.decision || 'review';
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
