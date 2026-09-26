// Retuš štětcem bez API: výřez kolem masky → lokální model ve web workeru →
// doplněné pixely zpátky do plného rozlišení. Mimo masku zůstává fotka
// nedotčená (jediná ztráta je finální JPEG komprese souboru).

import {
  MASK_DILATION_PX,
  MODEL_SIZE,
  computeInpaintCrop,
  dilateMask,
  maskBoundingBox,
  planarToRgba,
  rgbaToPlanar,
} from '../utils/inpaintMath';
import type { InpaintModelId } from '../utils/inpaintModels';

export type InpaintBackend = 'webgpu' | 'wasm';

export interface InpaintProgress {
  // init = model je stažený a runtime ho připravuje (kompilace pro GPU/CPU)
  phase: 'download' | 'init' | 'compute';
  loaded?: number;
  total?: number;
  cached?: boolean;
}

interface PendingJob {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: InpaintProgress) => void;
  initTimer?: ReturnType<typeof setTimeout>;
}

// Příprava staženého modelu trvá běžně sekundy (LaMa na CPU do ~20 s). Když
// se do limitu neozve, runtime visí: worker se zahodí a zkusí se to znovu na
// jednom vlákně, které nepotřebuje pomocné workery ani SharedArrayBuffer.
const INIT_TIMEOUT_MS = 90_000;
const INIT_TIMEOUT = 'INPAINT_INIT_TIMEOUT';

let worker: Worker | null = null;
let singleThread = false;
let seq = 0;
const jobs = new Map<number, PendingJob>();

const resetWorker = (error: Error) => {
  jobs.forEach((job) => {
    clearTimeout(job.initTimer);
    job.reject(error);
  });
  jobs.clear();
  worker?.terminate();
  worker = null;
};

const getWorker = () => {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/inpaint.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const msg = event.data;
    const job = jobs.get(msg.id);
    if (!job) return;
    if (msg.type === 'progress') {
      if (msg.phase === 'init') {
        job.onProgress?.({ phase: 'init' });
        clearTimeout(job.initTimer);
        job.initTimer = setTimeout(() => {
          singleThread = true;
          resetWorker(new Error(INIT_TIMEOUT));
        }, INIT_TIMEOUT_MS);
      } else {
        job.onProgress?.({ phase: 'download', loaded: msg.loaded, total: msg.total, cached: msg.cached });
      }
      return;
    }
    clearTimeout(job.initTimer);
    jobs.delete(msg.id);
    if (msg.type === 'error') job.reject(new Error(msg.error));
    else job.resolve(msg);
  };
  worker.onerror = (event) => {
    // Pád workeru (typicky nedostatek paměti u LaMa): odmítnout všechno
    // rozběhnuté a příště začít s čistým workerem.
    resetWorker(new Error(`INPAINT_WORKER_CRASHED: ${event.message || 'unknown'}`));
  };
  if (singleThread) {
    // Worker zprávy zpracuje v pořadí, config tedy proběhne dřív než load.
    const id = ++seq;
    jobs.set(id, { resolve: () => {}, reject: () => {} });
    worker.postMessage({ type: 'config', numThreads: 1, id });
  }
  return worker;
};

const sendOnce = <T>(message: Record<string, unknown>, onProgress?: PendingJob['onProgress'], transfer: Transferable[] = []) =>
  new Promise<T>((resolve, reject) => {
    const id = ++seq;
    jobs.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...message, id }, transfer);
  });

// Zaseknutá příprava modelu se jednou zopakuje na jednom vlákně (model už je
// v Cache Storage, takže se znovu nestahuje).
const send = async <T>(message: Record<string, unknown>, onProgress?: PendingJob['onProgress'], transfer: Transferable[] = []) => {
  const retryCopy = transfer.length ? structuredClone(message) : message;
  try {
    return await sendOnce<T>(message, onProgress, transfer);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== INIT_TIMEOUT) throw error;
    return sendOnce<T>(retryCopy, onProgress);
  }
};

// Stáhne a připraví model dopředu (např. při otevření retuše), aby první tah
// štětcem nečekal na stažení.
export const preloadInpaintModel = (model: InpaintModelId, onProgress?: PendingJob['onProgress']) =>
  send<{ backend: InpaintBackend }>({ type: 'load', model }, onProgress).then((msg) => msg.backend);

const canvas = (width: number, height: number) => {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
};

const outputType = (file: File) => (file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg');

/**
 * @param maskCanvas maska v libovolném rozlišení se stejným poměrem stran jako
 *   fotka; retušuje se všude, kde má alfa > 0.
 */
export const inpaintFile = async (
  file: File,
  maskCanvas: HTMLCanvasElement,
  model: InpaintModelId,
  onProgress?: PendingJob['onProgress'],
): Promise<{ file: File; ms: number; backend: InpaintBackend }> => {
  const mw = maskCanvas.width;
  const mh = maskCanvas.height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskCtx || !mw || !mh) throw new Error('EMPTY_MASK');
  const maskRgba = maskCtx.getImageData(0, 0, mw, mh).data;
  const alpha = new Uint8Array(mw * mh);
  for (let i = 0; i < alpha.length; i++) alpha[i] = maskRgba[i * 4 + 3];
  const maskBox = maskBoundingBox(alpha, mw, mh);
  if (!maskBox) throw new Error('EMPTY_MASK');

  const bitmap = await createImageBitmap(file);
  try {
    const W = bitmap.width;
    const H = bitmap.height;
    const sx = W / mw;
    const sy = H / mh;
    const fullBox = {
      x: Math.floor(maskBox.x * sx),
      y: Math.floor(maskBox.y * sy),
      width: Math.ceil(maskBox.width * sx),
      height: Math.ceil(maskBox.height * sy),
    };
    const crop = computeInpaintCrop(fullBox, W, H);

    // Výřez fotky → 512×512.
    const imgSmall = canvas(MODEL_SIZE, MODEL_SIZE);
    const imgCtx = imgSmall.getContext('2d', { willReadFrequently: true })!;
    imgCtx.imageSmoothingQuality = 'high';
    imgCtx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, MODEL_SIZE, MODEL_SIZE);
    const image = rgbaToPlanar(imgCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data, MODEL_SIZE * MODEL_SIZE);

    // Odpovídající výřez masky → 512×512, binárně (alfa > 0) a s okrajem.
    const maskSmall = canvas(MODEL_SIZE, MODEL_SIZE);
    const msCtx = maskSmall.getContext('2d', { willReadFrequently: true })!;
    msCtx.drawImage(maskCanvas, crop.x / sx, crop.y / sy, crop.width / sx, crop.height / sy, 0, 0, MODEL_SIZE, MODEL_SIZE);
    const msData = msCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
    const binary = new Uint8Array(MODEL_SIZE * MODEL_SIZE);
    for (let i = 0; i < binary.length; i++) binary[i] = msData[i * 4 + 3] > 0 ? 1 : 0;
    const hole = dilateMask(binary, MODEL_SIZE, MODEL_SIZE, MASK_DILATION_PX);

    onProgress?.({ phase: 'compute' });
    const { result, ms, backend } = await send<{ result: Uint8Array; ms: number; backend: InpaintBackend }>(
      { type: 'run', model, image, mask: hole },
      onProgress,
      [image.buffer], // `hole` se ještě použije na ořez výsledku, nepřenášet
    );

    // Výsledek modelu → vrstva ve velikosti výřezu, oříznutá změkčenou maskou.
    const resultSmall = canvas(MODEL_SIZE, MODEL_SIZE);
    resultSmall.getContext('2d')!.putImageData(
      new ImageData(planarToRgba(result, MODEL_SIZE * MODEL_SIZE), MODEL_SIZE, MODEL_SIZE),
      0,
      0,
    );
    const holeRgba = new Uint8ClampedArray(MODEL_SIZE * MODEL_SIZE * 4);
    for (let i = 0; i < hole.length; i++) holeRgba[i * 4 + 3] = hole[i] ? 255 : 0;
    const holeCanvas = canvas(MODEL_SIZE, MODEL_SIZE);
    holeCanvas.getContext('2d')!.putImageData(new ImageData(holeRgba, MODEL_SIZE, MODEL_SIZE), 0, 0);

    const layer = canvas(crop.width, crop.height);
    const layerCtx = layer.getContext('2d')!;
    layerCtx.imageSmoothingQuality = 'high';
    layerCtx.drawImage(resultSmall, 0, 0, crop.width, crop.height);
    layerCtx.globalCompositeOperation = 'destination-in';
    // Měkký přechod ~1,5 px modelu, ať není vidět šev mezi doplněním a originálem.
    layerCtx.filter = `blur(${Math.max(1, (crop.width / MODEL_SIZE) * 1.5)}px)`;
    layerCtx.drawImage(holeCanvas, 0, 0, crop.width, crop.height);

    const out = canvas(W, H);
    const outCtx = out.getContext('2d')!;
    outCtx.drawImage(bitmap, 0, 0);
    outCtx.drawImage(layer, crop.x, crop.y);

    const type = outputType(file);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, type, 0.96));
    if (!blob) throw new Error('INPAINT_ENCODE_FAILED');
    return { file: new File([blob], file.name, { type, lastModified: Date.now() }), ms, backend };
  } finally {
    bitmap.close();
  }
};
