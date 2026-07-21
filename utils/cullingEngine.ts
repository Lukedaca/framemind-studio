// FrameMind culling engine — orchestrace lokálních heuristik, žánrových profilů
// a sbalení sérií. Portováno z FrameMind Agenta (frontend/src/app.js), aby obě
// aplikace dávaly stejné verdikty. AI verdikt (Gemini) žije v geminiService.
//
// Kalibrace: heuristiky se počítají na dekódu s delší stranou 420 px, AI thumb
// má 768 px. Prahy v cullingMetrics.ts jsou na 420 px navázané.

import type {
  CullingDecision,
  CullingAiVerdict,
  CullingGenre,
  CullingMetrics,
  CullingMode,
  CullingResult,
  CullingVerdictSource,
} from '../types';
import { readMetrics, hashToWords, hammingWords, clamp01 } from './cullingMetrics';
import { detectFaces, type FaceBoundingBox } from '../services/faceDetection';
import { blendFinalScore } from '../services/tasteEngine';

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
  context: {
    duplicateGroupId?: string;
    isBestInGroup?: boolean;
    faceCount?: number;
    eyeBlink?: number;
  }
): HeuristicDecision {
  const profile = GENRE_PROFILES[genre || 'other'] || GENRE_PROFILES.other;
  const reasons: string[] = [];
  const risks: string[] = [];
  const hasFace = (context.faceCount ?? 0) > 0;
  const eyeBlink = context.eyeBlink ?? 0;
  const eyesClosed = hasFace && profile.eyesMatter && eyeBlink >= 0.5;

  if (metrics.sharpnessScore >= 0.68) reasons.push('cull_reason_sharp');
  if (hasFace && profile.eyesMatter && eyeBlink < 0.3) reasons.push('cull_reason_open_eyes');
  if (metrics.exposureScore >= 0.68) reasons.push('cull_reason_exposure');
  if (metrics.compositionScore >= 0.64) reasons.push('cull_reason_composition');
  if (context.isBestInGroup) reasons.push('cull_reason_best_in_group');

  if (eyesClosed) risks.push('cull_risk_closed_eyes');
  if (metrics.sharpnessScore < 0.36) risks.push('cull_risk_blur');
  if (metrics.exposureScore < 0.22) {
    risks.push(metrics.shadowClipping > metrics.highlightClipping ? 'cull_risk_underexposed' : 'cull_risk_exposure');
  }
  if (metrics.highlightClipping > 0.06) risks.push('cull_risk_highlights');
  if (metrics.shadowClipping > 0.08) risks.push('cull_risk_shadows');
  if (metrics.noiseScore < profile.noiseRiskBelow) risks.push('cull_risk_noise');
  if (context.duplicateGroupId && !context.isBestInGroup) risks.push('cull_risk_duplicate');

  const hasMajorRisk =
    metrics.sharpnessScore < 0.28 ||
    metrics.exposureScore < 0.16 ||
    metrics.highlightClipping > 0.16 ||
    metrics.shadowClipping > 0.2 ||
    metrics.noiseScore < profile.noiseMajorBelow ||
    (hasFace && profile.eyesMatter && eyeBlink >= 0.62);

  let decision: CullingDecision = 'review';
  if (
    !hasMajorRisk &&
    (!context.duplicateGroupId || context.isBestInGroup) &&
    (finalScore >= 74 || (context.isBestInGroup && finalScore >= 60))
  ) {
    decision = 'keep';
  }
  if (finalScore < 42 || hasMajorRisk) {
    decision = 'reject';
  }
  if (context.duplicateGroupId && !context.isBestInGroup) {
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

// Nad tímto počtem fotek se místo přesného O(n²) použije LSH banding.
export const SIMILARITY_EXACT_LIMIT = 1000;
const SIMILARITY_HAMMING_THRESHOLD = 20;
const SIMILARITY_ASPECT_TOLERANCE = 0.12;
// Počet 8bitových bandů (256bit hash / 8). Protože bandů (32) je víc než práh
// rozdílných bitů (20), každý pár pod prahem sdílí aspoň jeden identický band
// (pigeonhole) — banding tedy nedává false negatives a výsledek je shodný
// s přesným porovnáním.
const SIMILARITY_BAND_BITS = 8;
// Pojistka pro degenerované buckety (např. samé jednobarevné hashe): porovnává
// se jen klouzavé okno deterministicky seřazeného bucketu, ne celý bucket.
const MAX_BUCKET_COMPARE_WINDOW = 1500;

// Union-find nad perceptual hashi: levný aspect-ratio test odfiltruje většinu
// párů, hamming přes bitová slova (XOR+popcount) rozhodne zbytek. Do
// SIMILARITY_EXACT_LIMIT fotek běží přesné porovnání všech párů; nad limitem
// kandidátní páry generuje LSH banding nad prefixy/bandy hashe.
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

  const comparePair = (first: SimilarityInput, second: SimilarityInput) => {
    if (Math.abs((first.aspectRatio || 0) - (second.aspectRatio || 0)) >= SIMILARITY_ASPECT_TOLERANCE) return;
    if (hammingWords(words.get(first.id)!, words.get(second.id)!) <= SIMILARITY_HAMMING_THRESHOLD) {
      union(first.id, second.id);
    }
  };

  if (withHash.length <= SIMILARITY_EXACT_LIMIT) {
    // Přesná cesta: všechny páry.
    for (let i = 0; i < withHash.length; i += 1) {
      for (let j = i + 1; j < withHash.length; j += 1) {
        comparePair(withHash[i], withHash[j]);
      }
    }
  } else {
    // LSH banding: item padne do bucketu za každý 8bitový band svého hashe.
    // Kandidáti = dvojice sdílející aspoň jeden bucket; přesná Hamming distance
    // se počítá jen pro ně. Deterministické: pořadí bucketů i položek v nich
    // sleduje pořadí vstupu.
    const bandChars = SIMILARITY_BAND_BITS;
    const buckets = new Map<string, number[]>();
    withHash.forEach((item, index) => {
      const hash = item.hash;
      const bandCount = Math.floor(hash.length / bandChars);
      for (let band = 0; band < bandCount; band += 1) {
        // Délka hashe v klíči: různě dlouhé hashe nikdy nesdílí bucket.
        const key = `${hash.length}:${band}:${hash.slice(band * bandChars, (band + 1) * bandChars)}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
      }
    });

    const total = withHash.length;
    const seenPairs = new Set<number>();
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      const window = Math.min(bucket.length, MAX_BUCKET_COMPARE_WINDOW);
      for (let a = 0; a < bucket.length; a += 1) {
        const limit = Math.min(bucket.length, a + window);
        for (let b = a + 1; b < limit; b += 1) {
          const i = bucket[a];
          const j = bucket[b];
          const pairKey = i < j ? i * total + j : j * total + i;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          comparePair(withHash[i], withHash[j]);
        }
      }
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

async function measureFaceSharpness(
  source: CanvasImageSource,
  bbox: FaceBoundingBox,
  sourceWidth: number,
  sourceHeight: number
): Promise<number | null> {
  const padding = 0.18;
  const sourceX = Math.max(0, bbox.x - bbox.w * padding);
  const sourceY = Math.max(0, bbox.y - bbox.h * padding);
  const sourceW = Math.min(bbox.w * (1 + padding * 2), sourceWidth - sourceX);
  const sourceH = Math.min(bbox.h * (1 + padding * 2), sourceHeight - sourceY);
  if (sourceW < 8 || sourceH < 8) return null;

  const maxSide = 320;
  const scale = Math.min(1, maxSide / Math.max(sourceW, sourceH));
  const width = Math.max(32, Math.round(sourceW * scale));
  const height = Math.max(32, Math.round(sourceH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sourceX, sourceY, sourceW, sourceH, 0, 0, width, height);
  const metrics = await computeMetrics(context.getImageData(0, 0, width, height));
  return metrics.sharpnessScore;
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
  faceCount: number;
  eyeBlink: number;
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
    let faceCount = 0;
    let eyeBlink = 0;

    try {
      const detected = await detectFaces(loaded.source, loaded.width, loaded.height);
      faceCount = detected.faceCount;
      if (detected.primary) {
        eyeBlink = detected.primary.eyeBlink;
        const faceSharpness = await measureFaceSharpness(
          loaded.source,
          detected.primary.bbox,
          loaded.width,
          loaded.height
        );
        if (faceSharpness !== null) metrics.sharpnessScore = faceSharpness;
      }
    } catch (error) {
      console.warn(`Face detection failed for ${file.name}:`, error);
    }

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
      faceCount,
      eyeBlink,
    };
  } finally {
    loaded.close();
  }
}

export function buildCullingResult(
  analysis: PhotoAnalysis,
  genre: CullingGenre | null
): CullingResult {
  const finalScore = blendFinalScore(computeFinalScore(analysis.metrics, genre), analysis.metrics);
  const heuristic = deriveHeuristicDecision(analysis.metrics, finalScore, genre, {
    faceCount: analysis.faceCount,
    eyeBlink: analysis.eyeBlink,
  });
  return {
    metrics: analysis.metrics,
    finalScore,
    decision: heuristic.decision,
    reasons: heuristic.reasons,
    risks: heuristic.risks,
    aspectRatio: analysis.aspectRatio,
    genre: genre || undefined,
    faceCount: analysis.faceCount,
    eyeBlink: analysis.eyeBlink,
    aiStatus: 'idle',
  };
}

// Přepočet po změně žánru nebo doběhnutí skupin: skóre + heuristický verdikt.
// AI verdikty a ruční rozhodnutí zůstávají autoritativní.
export function rescoreCullingResult(result: CullingResult, genre: CullingGenre | null): CullingResult {
  const finalScore = blendFinalScore(computeFinalScore(result.metrics, genre), result.metrics);
  const heuristic = deriveHeuristicDecision(result.metrics, finalScore, genre, {
    duplicateGroupId: result.duplicateGroupId,
    isBestInGroup: result.isBestInGroup,
    faceCount: result.faceCount,
    eyeBlink: result.eyeBlink,
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

// Zdroj verdiktu: ruční > AI > heuristika. UI badge + logika mazání rejectů.
export function getVerdictSource(result: CullingResult | undefined): CullingVerdictSource | null {
  if (!result) return null;
  if (result.manualDecision) return 'manual';
  if (result.aiStatus === 'done' && result.ai) return 'ai';
  return 'heuristic';
}

/**
 * AI is authoritative for ordinary cases. A direct disagreement over an extreme,
 * deterministic technical failure is routed to Review instead of silently turning
 * into Keep. That preserves Safe mode's human-review guarantee without letting a
 * single optimistic model response erase strong local evidence.
 */
export function reconcileAiDecision(
  result: CullingResult,
  verdict: CullingAiVerdict
): { decision: CullingDecision; disagreement: boolean } {
  if (result.decision !== 'reject' || verdict.decision !== 'keep') {
    return { decision: verdict.decision, disagreement: false };
  }

  const profile = GENRE_PROFILES[verdict.genre || result.genre || 'other'] || GENRE_PROFILES.other;
  const metrics = result.metrics;
  const certainTechnicalFailure =
    metrics.sharpnessScore < 0.16 ||
    metrics.exposureScore < 0.08 ||
    metrics.highlightClipping > 0.28 ||
    metrics.shadowClipping > 0.35 ||
    metrics.noiseScore < profile.noiseMajorBelow * 0.5 ||
    ((result.faceCount ?? 0) > 0 && profile.eyesMatter && (result.eyeBlink ?? 0) >= 0.78);

  return certainTechnicalFailure
    ? { decision: 'review', disagreement: true }
    : { decision: verdict.decision, disagreement: false };
}

// --- Safe/Economy výběr kandidátů pro AI fázi ---

export interface AiCandidateInput {
  id: string;
  decision: CullingDecision;
  finalScore: number;
}

export interface AiCandidateSelection {
  candidateIds: string[]; // fotky, které jdou do AI (včetně auditního vzorku)
  skippedRejectIds: string[]; // heuristické rejecty přeskočené bez AI (jen economy)
  auditIds: string[]; // podmnožina skipped rejectů poslaná do AI jako audit
}

export const AUDIT_MIN = 5;
export const AUDIT_MAX = 20;
export const AUDIT_RATIO = 0.1;

/**
 * Safe mode (výchozí): AI posoudí všechno — heuristický reject je jen předběžný
 * návrh a nikdy nesmí sám o sobě fotku vyřadit.
 * Economy mode: jisté heuristické rejecty AI přeskočí; deterministický auditní
 * vzorek (5–20 fotek, ~10 %, rozprostřený přes rozsah skóre) jde do AI, aby šlo
 * odhalit falešné rejecty.
 */
export function selectAiCandidates(items: AiCandidateInput[], mode: CullingMode): AiCandidateSelection {
  if (mode === 'safe') {
    return { candidateIds: items.map((item) => item.id), skippedRejectIds: [], auditIds: [] };
  }

  const rejects = items.filter((item) => item.decision === 'reject');
  const nonRejects = items.filter((item) => item.decision !== 'reject');

  // Deterministický vzorek: seřadit podle skóre (tiebreak id), vybrat rovnoměrně
  // rozložené indexy — pokryje slabé i hraniční rejecty, výsledek je testovatelný.
  const sorted = [...rejects].sort((a, b) => a.finalScore - b.finalScore || a.id.localeCompare(b.id));
  const auditSize = Math.min(
    sorted.length,
    Math.min(AUDIT_MAX, Math.max(AUDIT_MIN, Math.round(sorted.length * AUDIT_RATIO)))
  );

  const auditIds: string[] = [];
  if (auditSize > 0) {
    const picked = new Set<number>();
    for (let i = 0; i < auditSize; i += 1) {
      const index = auditSize === 1 ? 0 : Math.round((i * (sorted.length - 1)) / (auditSize - 1));
      picked.add(index);
    }
    for (const index of picked) auditIds.push(sorted[index].id);
  }

  const auditSet = new Set(auditIds);
  return {
    candidateIds: [...nonRejects.map((item) => item.id), ...auditIds],
    skippedRejectIds: rejects.filter((item) => !auditSet.has(item.id)).map((item) => item.id),
    auditIds,
  };
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
