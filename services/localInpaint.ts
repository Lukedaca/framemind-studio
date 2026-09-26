// Retuš štětcem bez API: výřez kolem masky → lokální model ve web workeru →
// doplněné pixely zpátky do plného rozlišení. Mimo masku zůstává fotka
// nedotčená (jediná ztráta je finální JPEG komprese souboru).

import {
  CONTEXT_FACTOR,
  MASK_DILATION_PX,
  MODEL_SIZE,
  computeInpaintCrop,
  dilateMask,
  grainSigma,
  maskBoundingBox,
  missingGrain,
  pickAutoModel,
  planarToRgba,
  rgbaToPlanar,
} from '../utils/inpaintMath';
import type { InpaintModelId } from '../utils/inpaintModels';

/** Volba v panelu: auto vybere model podle velikosti retušované plochy. */
export type InpaintChoice = 'auto' | InpaintModelId;

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

// Příprava staženého modelu (vč. zahřátí a změření GPU/CPU) trvá běžně
// sekundy, LaMa na slabém stroji desítky sekund. Když
// se do limitu neozve, runtime visí: worker se zahodí a zkusí se to znovu na
// jednom vlákně, které nepotřebuje pomocné workery ani SharedArrayBuffer.
const INIT_TIMEOUT_MS = 150_000;
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

export const outputType = (file: File) => (file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg');

/** Doplněný kus fotky: vrstva s průhledností mimo masku, vkládá se na (x, y). */
export interface InpaintPatch {
  layer: HTMLCanvasElement;
  x: number;
  y: number;
  ms: number;
  backend: InpaintBackend;
  model: InpaintModelId;
}

// Doplněná plocha z modelu je hladší než fotka kolem (model počítá na 512 px
// a výsledek se zvětšuje). Přidá se jí zrno změřené v prstenci kolem díry —
// bez toho retuš prozradí „plastová" skvrna, i když tvary sedí.
const matchGrain = (layer: HTMLCanvasElement, original: HTMLCanvasElement, hole: Uint8Array) => {
  const w = layer.width;
  const h = layer.height;
  const pixels = w * h;
  const blurOf = (c: HTMLCanvasElement) => {
    const b = canvas(w, h);
    const ctx = b.getContext('2d', { willReadFrequently: true })!;
    ctx.filter = 'blur(1.2px)';
    ctx.drawImage(c, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const layerCtx = layer.getContext('2d', { willReadFrequently: true })!;
  const layerData = layerCtx.getImageData(0, 0, w, h);
  const orig = original.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  // Díra a prstenec kolem ní v souřadnicích modelu (512×512) → pixely výřezu.
  const ring = dilateMask(hole, MODEL_SIZE, MODEL_SIZE, 20);
  const toModel = (i: number) => {
    const mx = Math.min(MODEL_SIZE - 1, Math.floor(((i % w) * MODEL_SIZE) / w));
    const my = Math.min(MODEL_SIZE - 1, Math.floor((Math.floor(i / w) * MODEL_SIZE) / h));
    return my * MODEL_SIZE + mx;
  };
  const step = Math.max(1, Math.floor(pixels / 400_000));
  const around = grainSigma(orig, blurOf(original), (i) => {
    const m = toModel(i);
    return ring[m] === 1 && hole[m] === 0;
  }, pixels, step);
  const filled = grainSigma(layerData.data, blurOf(layer), (i) => layerData.data[i * 4 + 3] > 0 && hole[toModel(i)] === 1, pixels, step);
  if (!around || !filled) return;
  const add = missingGrain(around, filled);
  if (add[0] + add[1] + add[2] < 0.3) return;

  // Zrno fotoaparátu je hlavně jasové s trochou barevného. Součet tří
  // rovnoměrných čísel (0–1) minus 1,5 má odchylku 0,5 — levná náhrada
  // Gaussova šumu; ×2 = jednotková odchylka.
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
  const norm = 1 / Math.sqrt(0.8 ** 2 + 0.45 ** 2);
  const d = layerData.data;
  for (let i = 0; i < pixels; i++) {
    if (d[i * 4 + 3] === 0) continue;
    const luma = 0.8 * gauss();
    for (let c = 0; c < 3; c++) d[i * 4 + c] += (luma + 0.45 * gauss()) * norm * add[c];
  }
  layerCtx.putImageData(layerData, 0, 0);
};

/**
 * Spočítá jen doplněný výřez. Fotku nedekóduje ani nekóduje — zdrojem je
 * plátno, které editor už drží v paměti, a výsledek se do něj rovnou vloží.
 * Tím odpadají sekundy na dekódování a JPEG kódování 24MP fotky při každém tahu.
 *
 * @param source fotka v plném rozlišení (canvas nebo obrázek)
 * @param maskCanvas maska v libovolném rozlišení se stejným poměrem stran jako
 *   fotka; retušuje se všude, kde má alfa > 0.
 */
export interface BlendOptions {
  /** 0–1: měkký okraj bere váhu z alfy masky, tvrdý z díry s okrajem. */
  hardness: number;
  /** 0–1: kolik doplnění se použije. */
  strength: number;
}

// Alfa masky pod touto hodnotou do díry nepatří — jen dozvuk měkkého okraje;
// model by jinak dostal zbytečně velkou díru.
const HOLE_ALPHA_THRESHOLD = 12;

export const inpaintRegion = async (
  source: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  choice: InpaintChoice,
  onProgress?: PendingJob['onProgress'],
  blend: BlendOptions = { hardness: 1, strength: 1 },
): Promise<InpaintPatch> => {
  const mw = maskCanvas.width;
  const mh = maskCanvas.height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskCtx || !mw || !mh) throw new Error('EMPTY_MASK');
  const maskRgba = maskCtx.getImageData(0, 0, mw, mh).data;
  const alpha = new Uint8Array(mw * mh);
  for (let i = 0; i < alpha.length; i++) alpha[i] = maskRgba[i * 4 + 3];
  const maskBox = maskBoundingBox(alpha, mw, mh, HOLE_ALPHA_THRESHOLD);
  if (!maskBox) throw new Error('EMPTY_MASK');

  const W = source.width;
  const H = source.height;
  const sx = W / mw;
  const sy = H / mh;
  const fullBox = {
    x: Math.floor(maskBox.x * sx),
    y: Math.floor(maskBox.y * sy),
    width: Math.ceil(maskBox.width * sx),
    height: Math.ceil(maskBox.height * sy),
  };
  let holeArea = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > HOLE_ALPHA_THRESHOLD) holeArea++;
  const model: InpaintModelId = choice === 'auto' ? pickAutoModel(holeArea * sx * sy) : choice;
  const crop = computeInpaintCrop(fullBox, W, H, CONTEXT_FACTOR[model]);

  // Výřez fotky → 512×512.
  const imgSmall = canvas(MODEL_SIZE, MODEL_SIZE);
  const imgCtx = imgSmall.getContext('2d', { willReadFrequently: true })!;
  imgCtx.imageSmoothingQuality = 'high';
  imgCtx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const image = rgbaToPlanar(imgCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data, MODEL_SIZE * MODEL_SIZE);

  // Odpovídající výřez masky → 512×512, binárně (alfa > 0) a s okrajem.
  const maskSmall = canvas(MODEL_SIZE, MODEL_SIZE);
  const msCtx = maskSmall.getContext('2d', { willReadFrequently: true })!;
  msCtx.drawImage(maskCanvas, crop.x / sx, crop.y / sy, crop.width / sx, crop.height / sy, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const msData = msCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  const binary = new Uint8Array(MODEL_SIZE * MODEL_SIZE);
  for (let i = 0; i < binary.length; i++) binary[i] = msData[i * 4 + 3] > HOLE_ALPHA_THRESHOLD ? 1 : 0;
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
  // Váha retuše. Tvrdý štětec: díra s okrajem a měkkým přechodem ~1,5 px
  // modelu (bez švu, bez duchů po obrysu). Měkký štětec: přímo alfa masky,
  // takže se retuš k okraji plynule vytrácí. Síla váhu celou násobí.
  layerCtx.globalAlpha = Math.min(1, Math.max(0, blend.strength));
  if (blend.hardness >= 0.99) {
    layerCtx.filter = `blur(${Math.max(1, (crop.width / MODEL_SIZE) * 1.5)}px)`;
    layerCtx.drawImage(holeCanvas, 0, 0, crop.width, crop.height);
  } else {
    layerCtx.drawImage(maskCanvas, crop.x / sx, crop.y / sy, crop.width / sx, crop.height / sy, 0, 0, crop.width, crop.height);
  }
  layerCtx.globalAlpha = 1;
  layerCtx.globalCompositeOperation = 'source-over';
  layerCtx.filter = 'none';

  const originalCrop = canvas(crop.width, crop.height);
  originalCrop.getContext('2d')!.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  try {
    matchGrain(layer, originalCrop, hole);
  } catch (error) {
    // Zrno je doladění — když selže (např. paměť), výsledek platí i bez něj.
    console.warn('Grain matching skipped:', error);
  }

  return { layer, x: crop.x, y: crop.y, ms, backend, model };
};

/** Uloží plátno do souboru. Běží až po zobrazení výsledku, uživatel na něj nečeká. */
export const encodeCanvas = async (source: HTMLCanvasElement, name: string, type: string): Promise<File> => {
  const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, type, 0.96));
  if (!blob) throw new Error('INPAINT_ENCODE_FAILED');
  return new File([blob], name, { type, lastModified: Date.now() });
};
