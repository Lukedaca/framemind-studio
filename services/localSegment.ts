// Chytré laso na hlavním vlákně: příprava vstupu pro SAM 2.1, převod kliků na
// body modelu a masek 256×256 zpátky do rozlišení masky editoru.

import { SEGMENT_INPUT, SEGMENT_MASK, maskArea, toSegmentPixels } from '../utils/segmentModel';

export interface SegmentProgress {
  loaded: number;
  total: number;
}

export interface SegmentCandidate {
  /** Logity 256×256 přes celou fotku (roztažené bez zachování poměru). */
  logits: Float32Array;
  iou: number;
  area: number;
}

interface PendingJob {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: SegmentProgress) => void;
}

let worker: Worker | null = null;
let seq = 0;
const jobs = new Map<number, PendingJob>();

const getWorker = () => {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/segment.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const msg = event.data;
    const job = jobs.get(msg.id);
    if (!job) return;
    if (msg.type === 'progress') {
      job.onProgress?.({ loaded: msg.loaded, total: msg.total });
      return;
    }
    jobs.delete(msg.id);
    if (msg.type === 'error') job.reject(new Error(msg.error));
    else job.resolve(msg);
  };
  worker.onerror = (event) => {
    const error = new Error(`SEGMENT_WORKER_CRASHED: ${event.message || 'unknown'}`);
    jobs.forEach((job) => job.reject(error));
    jobs.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
};

const send = <T>(message: Record<string, unknown>, onProgress?: PendingJob['onProgress'], transfer: Transferable[] = []) =>
  new Promise<T>((resolve, reject) => {
    const id = ++seq;
    jobs.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...message, id }, transfer);
  });

/** Stáhne a připraví model lasa (jen poprvé stahuje, pak čte z disku). */
export const loadSegmentModel = (onProgress?: PendingJob['onProgress']) => send<{ type: 'ready' }>({ type: 'load' }, onProgress);

/**
 * „Přečte" fotku: enkodér SAM jednou na fotku (u stejného `key` nic nedělá).
 * @param key musí se změnit, kdykoli se změní obsah plátna (retuš, jiná fotka).
 */
export const encodeForSegment = async (source: HTMLCanvasElement, key: string, onProgress?: PendingJob['onProgress']) => {
  const c = document.createElement('canvas');
  c.width = SEGMENT_INPUT;
  c.height = SEGMENT_INPUT;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, SEGMENT_INPUT, SEGMENT_INPUT);
  const pixels = toSegmentPixels(ctx.getImageData(0, 0, SEGMENT_INPUT, SEGMENT_INPUT).data);
  const msg = await send<{ ms: number }>({ type: 'encode', key, pixels }, onProgress, [pixels.buffer]);
  return msg.ms;
};

/**
 * Objekt pod kliknutým bodem. Vrací tři kandidáty seřazené od nejmenšího
 * (část, objekt, celek) a index toho, kterému model věří nejvíc.
 */
export const segmentAt = async (
  key: string,
  point: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
): Promise<{ candidates: SegmentCandidate[]; best: number }> => {
  const points = [(point.x * SEGMENT_INPUT) / imageWidth, (point.y * SEGMENT_INPUT) / imageHeight];
  const { masks, iou } = await send<{ masks: Float32Array; iou: number[] }>({ type: 'decode', key, points, labels: [1] });
  const size = SEGMENT_MASK * SEGMENT_MASK;
  const count = Math.min(iou.length, Math.floor(masks.length / size));
  const candidates: SegmentCandidate[] = [];
  for (let k = 0; k < count; k++) {
    const logits = masks.slice(k * size, (k + 1) * size);
    candidates.push({ logits, iou: iou[k], area: maskArea(logits) });
  }
  const bestCandidate = candidates.reduce((a, b) => (b.iou > a.iou ? b : a));
  candidates.sort((a, b) => a.area - b.area);
  return { candidates, best: candidates.indexOf(bestCandidate) };
};

/**
 * Logity 256×256 → binární maska v rozlišení `width`×`height`. Zvětšují se
 * logity (hladce), ne už prahovaná maska — okraj pak kopíruje tvar, ne schody.
 */
export const renderSegmentMask = (logits: Float32Array, width: number, height: number): HTMLCanvasElement => {
  const small = document.createElement('canvas');
  small.width = SEGMENT_MASK;
  small.height = SEGMENT_MASK;
  const data = new ImageData(SEGMENT_MASK, SEGMENT_MASK);
  for (let i = 0; i < logits.length; i++) {
    data.data[i * 4 + 3] = Math.round(255 / (1 + Math.exp(-logits[i])));
  }
  small.getContext('2d')!.putImageData(data, 0, 0);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const on = d[i + 3] > 127;
    // Barva jako u štětce, ať výběr vypadá stejně jako namalovaná maska.
    d[i] = 214;
    d[i + 1] = 92;
    d[i + 2] = 255;
    d[i + 3] = on ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return out;
};
