// Retuš štětcem bez API: výřez kolem masky → lokální model ve web workeru →
// doplněné pixely zpátky do plného rozlišení. Mimo masku zůstává fotka
// nedotčená. Pracovní verze je bezeztrátové PNG; JPEG vzniká až při exportu.

import {
  MASK_DILATION_PX,
  MODEL_SIZE,
  computeInpaintCrop,
  dilateMask,
  fitInpaintViewport,
  grainSigma,
  inpaintContextFactor,
  maskBoundingBox,
  missingGrain,
  pickAutoModel,
  planarToRgba,
  rgbaToPlanar,
  type InpaintContext,
  type Rect,
} from '../utils/inpaintMath';
import { planInpaintRegions } from '../utils/inpaintRegions';
import { harmonizeInpaintBoundary } from '../utils/inpaintBlend';
import { drawInpaintInput } from '../utils/inpaintCanvas';
import { INPAINT_MODELS, type InpaintModelId } from '../utils/inpaintModels';
import { fetchCachedModel } from '../workers/modelFetch';
import { isTauri } from '@tauri-apps/api/core';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

let desktopRuntime: Promise<{ binary: Uint8Array; module: string }> | null = null;
const loadDesktopRuntime = () => {
  if (!desktopRuntime) desktopRuntime = Promise.all([fetch(ortWasmUrl), fetch(ortModuleUrl)]).then(async ([binary, module]) => {
    if (!binary.ok || !module.ok) throw new Error('INPAINT_RUNTIME_LOAD_FAILED');
    const [bytes, source] = await Promise.all([binary.arrayBuffer(), module.text()]);
    return { binary: new Uint8Array(bytes), module: URL.createObjectURL(new Blob([source], { type: 'application/javascript' })) };
  }).catch(error => { desktopRuntime = null; throw error; });
  return desktopRuntime;
};

/** Volba v panelu: auto vybere model podle velikosti retušované plochy. */
export type InpaintChoice = 'auto' | InpaintModelId;

export type InpaintBackend = 'webgpu' | 'wasm';

export interface InpaintProgress {
  // init = model je stažený a runtime ho připravuje (kompilace pro GPU/CPU)
  phase: 'download' | 'init' | 'compute';
  loaded?: number;
  total?: number;
  cached?: boolean;
  backend?: InpaintBackend;
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
const COMPUTE_TIMEOUT_MS = 300_000;
const INIT_TIMEOUT = 'INPAINT_INIT_TIMEOUT';
const GPU_TIMEOUT = 'INPAINT_GPU_TIMEOUT';

let worker: Worker | null = null;
let singleThread = false;
let disableGpu = false;
let seq = 0;
const jobs = new Map<number, PendingJob>();
const modelLoads = new Map<string, { promise: Promise<InpaintBackend>; listeners: Set<NonNullable<PendingJob['onProgress']>>; progress?: InpaintProgress }>();
const readyModels = new Map<string, InpaintBackend>();

export const readyInpaintBackend = (model: InpaintModelId, size: 512 | 1024 = 512) => readyModels.get(`${model}:${size}`);

const resetWorker = (error: Error) => {
  modelLoads.clear();
  readyModels.clear();
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
          disableGpu = true;
          resetWorker(new Error(INIT_TIMEOUT));
        }, INIT_TIMEOUT_MS);
      } else if (msg.phase === 'compute') {
        clearTimeout(job.initTimer);
        job.initTimer = setTimeout(() => resetWorker(new Error('INPAINT_COMPUTE_TIMEOUT')), COMPUTE_TIMEOUT_MS);
        job.onProgress?.({ phase: 'compute', backend: msg.backend });
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
  if (singleThread || disableGpu) {
    // Worker zprávy zpracuje v pořadí, config tedy proběhne dřív než load.
    const id = ++seq;
    jobs.set(id, { resolve: () => {}, reject: () => {} });
    worker.postMessage({ type: 'config', numThreads: singleThread ? 1 : undefined, disableGpu, id });
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
const send = async <T>(message: Record<string, unknown>, onProgress?: PendingJob['onProgress'], transfer: Transferable[] = [], reload?: () => Promise<{ message: Record<string, unknown>; transfer: Transferable[] }>) => {
  const retryCopy = transfer.length && !reload ? structuredClone(message) : message;
  try {
    return await sendOnce<T>(message, onProgress, transfer);
  } catch (error) {
    if (!(error instanceof Error) || (error.message !== INIT_TIMEOUT && error.message !== GPU_TIMEOUT)) throw error;
    if (error.message === GPU_TIMEOUT && !disableGpu) {
      disableGpu = true;
      resetWorker(error);
    }
    if (reload) {
      const next = await reload();
      return sendOnce<T>(next.message, onProgress, next.transfer);
    }
    return sendOnce<T>(retryCopy, onProgress);
  }
};

// Stáhne a připraví model dopředu (např. při otevření retuše), aby první tah
// štětcem nečekal na stažení.
export const preloadInpaintModel = (model: InpaintModelId, onProgress?: PendingJob['onProgress'], size: 512 | 1024 = 512) => {
  const key = `${model}:${size}`;
  const ready = readyModels.get(key);
  if (ready) return Promise.resolve(ready);
  let load = modelLoads.get(key);
  if (!load) {
    const listeners = new Set<NonNullable<PendingJob['onProgress']>>();
    const entry = { promise: undefined! as Promise<InpaintBackend>, listeners, progress: undefined as InpaintProgress | undefined };
    const progress = (progress: InpaintProgress) => {
      entry.progress = progress;
      for (const listener of listeners) listener(progress);
    };
    // WebView2's worker cache/network path can stall on the desktop origin.
    // Read pinned weights in the window and transfer ownership to the worker;
    // inference, graph parsing and GPU/CPU initialization stay off the UI thread.
    const loadBytes = async () => {
      const definition = INPAINT_MODELS[model];
      const bytes = await fetchCachedModel('fm-inpaint-models-v1', definition.url, definition.bytes,
        (loaded, total, cached) => progress({ phase: 'download', loaded, total, cached }));
      const desktop = typeof window !== 'undefined' && isTauri() ? await loadDesktopRuntime() : undefined;
      const runtime = desktop?.binary.slice();
      return { message: { type: 'load', model, size, bytes, runtime, runtimeModule: desktop?.module }, transfer: [bytes.buffer, ...(runtime ? [runtime.buffer] : [])] as Transferable[] };
    };
    entry.promise = loadBytes().then(payload => send<{ backend: InpaintBackend }>(payload.message, progress, payload.transfer, loadBytes)).then(msg => {
      if (model === 'quality') for (const other of readyModels.keys()) if (other.startsWith('quality:') && other !== key) readyModels.delete(other);
      readyModels.set(key, msg.backend);
      return msg.backend;
    }).finally(() => {
      if (modelLoads.get(key) === entry) modelLoads.delete(key);
    });
    modelLoads.set(key, entry);
    load = entry;
  }
  const entry = load;
  if (onProgress) {
    entry.listeners.add(onProgress);
    if (entry.progress) onProgress(entry.progress);
  }
  return entry.promise.finally(() => { if (onProgress) entry.listeners.delete(onProgress); });
};

const canvas = (width: number, height: number) => {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
};

export const outputType = (_file: File) => 'image/png' as const;

/** Doplněný kus fotky: vrstva s průhledností mimo masku, vkládá se na (x, y). */
export interface InpaintPatch {
  layer: HTMLCanvasElement;
  x: number;
  y: number;
  ms: number;
  backend: InpaintBackend;
  model: InpaintModelId;
  regions: InpaintRegionInfo[];
}

export interface InpaintRegionInfo {
  crop: Rect;
  model: InpaintModelId;
  backend: InpaintBackend;
  inputSize: number;
  ms: number;
}

// Doplněná plocha z modelu je hladší než fotka kolem (model počítá na 512 px
// a výsledek se zvětšuje). Přidá se jí zrno změřené v prstenci kolem díry —
// bez toho retuš prozradí „plastová" skvrna, i když tvary sedí.
const matchGrain = (layer: HTMLCanvasElement, original: HTMLCanvasElement, hole: Uint8Array, viewport: Rect, size: number) => {
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
  const ring = dilateMask(hole, size, size, Math.ceil(20 * size / MODEL_SIZE));
  const toModel = (i: number) => {
    const mx = viewport.x + Math.min(viewport.width - 1, Math.floor(((i % w) * viewport.width) / w));
    const my = viewport.y + Math.min(viewport.height - 1, Math.floor((Math.floor(i / w) * viewport.height) / h));
    return my * size + mx;
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
  /** More detail uses a tighter crop; wide context gives the model more of the scene. */
  context?: InpaintContext;
  harmonize?: boolean;
  /** LaMa can use up to 1024px; small source crops keep their native 512px pass. */
  resolution?: 512 | 1024;
  /** Stop before starting another region when the editor has moved to another image. */
  isCancelled?: () => boolean;
}

// Alfa masky pod touto hodnotou do díry nepatří — jen dozvuk měkkého okraje;
// model by jinak dostal zbytečně velkou díru.
const HOLE_ALPHA_THRESHOLD = 12;

/** Read and label a stroke once, even when several contexts are compared. */
export const prepareInpaintMask = (
  source: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  choice: InpaintChoice,
) => {
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
  if (!W || !H) throw new Error('INPAINT_EMPTY_SOURCE');
  const sx = W / mw;
  const sy = H / mh;
  // Include a conservative bound for dilation + feathering at the largest possible
  // source crop. Neighbouring holes sharing that halo stay in one model pass.
  const padding = Math.ceil((MASK_DILATION_PX + 6) * Math.max(W, H) / (MODEL_SIZE * Math.min(sx, sy))) + 2;
  const { labels, regions } = planInpaintRegions(alpha, mw, mh, HOLE_ALPHA_THRESHOLD, { padding });
  if (!regions.length) throw new Error('EMPTY_MASK');
  return { mw, mh, W, H, sx, sy, alpha, labels, regions, choice };
};

const planInpaintCrops = (prepared: ReturnType<typeof prepareInpaintMask>, context?: InpaintContext) => {
  const { regions, sx, sy, W, H, choice } = prepared;
  return regions.map(region => {
    const box = region.box;
    const x = Math.floor(box.x * sx);
    const y = Math.floor(box.y * sy);
    const fullBox = { x, y, width: Math.min(W, Math.ceil((box.x + box.width) * sx)) - x, height: Math.min(H, Math.ceil((box.y + box.height) * sy)) - y };
    const model: InpaintModelId = choice === 'auto' ? pickAutoModel(region.area * sx * sy) : choice;
    const crop = computeInpaintCrop(fullBox, W, H, inpaintContextFactor(model, context));
    return { region, model, crop };
  });
};

export const inpaintVariantKey = (prepared: ReturnType<typeof prepareInpaintMask>, context: InpaintContext, resolution: 512 | 1024) =>
  JSON.stringify(planInpaintCrops(prepared, context).map(({ crop, model }) =>
    [crop, model, model === 'quality' && resolution === 1024 && Math.max(crop.width, crop.height) > MODEL_SIZE ? 1024 : MODEL_SIZE]));

export const inpaintRegion = async (
  source: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  choice: InpaintChoice,
  onProgress?: PendingJob['onProgress'],
  blend: BlendOptions = { hardness: 1, strength: 1 },
  prepared?: ReturnType<typeof prepareInpaintMask>,
): Promise<InpaintPatch> => {
  if (blend.isCancelled?.()) throw new Error('INPAINT_CANCELLED');
  const mask = prepared ?? prepareInpaintMask(source, maskCanvas, choice);
  const { mw, mh, alpha, labels } = mask;
  const plans = planInpaintCrops(mask, blend.context);
  const left = Math.min(...plans.map(p => p.crop.x));
  const top = Math.min(...plans.map(p => p.crop.y));
  const right = Math.max(...plans.map(p => p.crop.x + p.crop.width));
  const bottom = Math.max(...plans.map(p => p.crop.y + p.crop.height));
  const combined = plans.length > 1 ? canvas(right - left, bottom - top) : null;
  const combinedCtx = combined?.getContext('2d');
  const regionMask = canvas(mw, mh);
  const regionCtx = regionMask.getContext('2d')!;
  const measurements: InpaintRegionInfo[] = [];
  try {
    for (const { region, model, crop } of plans) {
      if (blend.isCancelled?.()) throw new Error('INPAINT_CANCELLED');
      const box = region.box;
      regionCtx.clearRect(0, 0, mw, mh);
      const isolated = regionCtx.createImageData(box.width, box.height);
      for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
        const index = (box.y + y) * mw + box.x + x;
        if (labels[index] === region.id) isolated.data[(y * box.width + x) * 4 + 3] = alpha[index];
      }
      regionCtx.putImageData(isolated, box.x, box.y);
      const patch = await inpaintCrop(source, regionMask, crop, model, onProgress, blend);
      if (blend.isCancelled?.()) {
        patch.layer.width = patch.layer.height = 1;
        throw new Error('INPAINT_CANCELLED');
      }
      measurements.push(...patch.regions);
      if (!combined) return patch;
      combinedCtx!.drawImage(patch.layer, crop.x - left, crop.y - top);
      patch.layer.width = patch.layer.height = 1;
    }
    const last = measurements[measurements.length - 1];
    return {
      layer: combined!, x: left, y: top,
      ms: measurements.reduce((sum, region) => sum + region.ms, 0),
      model: measurements.some(region => region.model === 'quality') ? 'quality' : 'fast',
      backend: last.backend,
      regions: measurements,
    };
  } catch (error) {
    if (combined) combined.width = combined.height = 1;
    throw error;
  } finally {
    regionMask.width = regionMask.height = 1;
  }
};

/** One coherent hole per crop; disconnected regions never share the 512px budget. */
const inpaintCrop = async (
  source: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  crop: Rect,
  model: InpaintModelId,
  onProgress: PendingJob['onProgress'],
  blend: BlendOptions,
): Promise<InpaintPatch> => {
  const sx = source.width / maskCanvas.width;
  const sy = source.height / maskCanvas.height;
  const size = model === 'quality' && blend.resolution === 1024 && Math.max(crop.width, crop.height) > MODEL_SIZE ? 1024 : MODEL_SIZE;
  await preloadInpaintModel(model, onProgress, size);
  const pixels = size * size;
  const viewport = fitInpaintViewport(crop.width, crop.height, size);

  // Preserve crop proportions; image and mask use the same reflected padding.
  const imgSmall = drawInpaintInput(source, crop, viewport, size);
  const imgCtx = imgSmall.getContext('2d', { willReadFrequently: true })!;
  const originalPixels = imgCtx.getImageData(0, 0, size, size).data;
  const image = rgbaToPlanar(originalPixels, pixels);

  // Odpovídající výřez masky → 512×512, binárně (alfa > 0) a s okrajem.
  const maskSmall = drawInpaintInput(maskCanvas, { x: crop.x / sx, y: crop.y / sy, width: crop.width / sx, height: crop.height / sy }, viewport, size);
  const msCtx = maskSmall.getContext('2d', { willReadFrequently: true })!;
  const msData = msCtx.getImageData(0, 0, size, size).data;
  const binary = new Uint8Array(pixels);
  for (let i = 0; i < binary.length; i++) binary[i] = msData[i * 4 + 3] > HOLE_ALPHA_THRESHOLD ? 1 : 0;
  const hole = dilateMask(binary, size, size, MASK_DILATION_PX * size / MODEL_SIZE);

  const { result, ms, backend } = await send<{ result: Uint8Array; ms: number; backend: InpaintBackend }>(
    { type: 'run', model, size, image, mask: hole },
    onProgress,
    [image.buffer], // `hole` se ještě použije na ořez výsledku, nepřenášet
  );

  // Výsledek modelu → vrstva ve velikosti výřezu, oříznutá změkčenou maskou.
  const resultSmall = canvas(size, size);
  const filledPixels = planarToRgba(result, pixels);
  if (blend.harmonize !== false) harmonizeInpaintBoundary(filledPixels, originalPixels, hole, size, size);
  resultSmall.getContext('2d')!.putImageData(
    new ImageData(filledPixels, size, size),
    0,
    0,
  );
  const holeRgba = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < hole.length; i++) holeRgba[i * 4 + 3] = hole[i] ? 255 : 0;
  const holeCanvas = canvas(size, size);
  holeCanvas.getContext('2d')!.putImageData(new ImageData(holeRgba, size, size), 0, 0);

  const layer = canvas(crop.width, crop.height);
  const layerCtx = layer.getContext('2d')!;
  layerCtx.imageSmoothingQuality = 'high';
  layerCtx.drawImage(resultSmall, viewport.x, viewport.y, viewport.width, viewport.height, 0, 0, crop.width, crop.height);
  layerCtx.globalCompositeOperation = 'destination-in';
  // Váha retuše. Tvrdý štětec: díra s okrajem a měkkým přechodem ~1,5 px
  // modelu (bez švu, bez duchů po obrysu). Měkký štětec: přímo alfa masky,
  // takže se retuš k okraji plynule vytrácí. Síla váhu celou násobí.
  layerCtx.globalAlpha = Math.min(1, Math.max(0, blend.strength));
  if (blend.hardness >= 0.99) {
    layerCtx.filter = `blur(${Math.max(1, Math.max(crop.width / viewport.width, crop.height / viewport.height) * 1.5 * size / MODEL_SIZE)}px)`;
    layerCtx.drawImage(holeCanvas, viewport.x, viewport.y, viewport.width, viewport.height, 0, 0, crop.width, crop.height);
  } else {
    layerCtx.drawImage(maskCanvas, crop.x / sx, crop.y / sy, crop.width / sx, crop.height / sy, 0, 0, crop.width, crop.height);
  }
  layerCtx.globalAlpha = 1;
  layerCtx.globalCompositeOperation = 'source-over';
  layerCtx.filter = 'none';

  const originalCrop = canvas(crop.width, crop.height);
  originalCrop.getContext('2d')!.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  try {
    matchGrain(layer, originalCrop, hole, viewport, size);
  } catch (error) {
    // Zrno je doladění — když selže (např. paměť), výsledek platí i bez něj.
    console.warn('Grain matching skipped:', error);
  }

  return { layer, x: crop.x, y: crop.y, ms, backend, model, regions: [{ crop, ms, backend, model, inputSize: size }] };
};

/** Uloží plátno do souboru. Běží až po zobrazení výsledku, uživatel na něj nečeká. */
export const encodeCanvas = async (source: HTMLCanvasElement, name: string, _type?: string): Promise<File> => {
  const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('INPAINT_ENCODE_FAILED');
  const stem = name.replace(/\.[^.]+$/, '');
  return new File([blob], `${stem}.png`, { type: 'image/png', lastModified: Date.now() });
};
