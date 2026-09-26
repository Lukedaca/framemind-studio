// Lokální inpainting mimo main thread. Model se stáhne jednou, uloží do Cache
// Storage a další spuštění appky ho čte z disku — bez API, bez klíče, offline.
//
// Vstup i výstup je čtverec MODEL_SIZE×MODEL_SIZE; výřez, zmenšení a vložení
// zpátky do plného rozlišení řeší services/localInpaint.ts.

import * as ort from 'onnxruntime-web';
import { INPAINT_MODELS, type InpaintModelId } from '../utils/inpaintModels';
import { MODEL_SIZE } from '../utils/inpaintMath';
import { fetchCachedModel } from './modelFetch';

type Request =
  | { type: 'config'; id: number; numThreads: number }
  | { type: 'load'; id: number; model: InpaintModelId }
  | { type: 'run'; id: number; model: InpaintModelId; image: Uint8Array; mask: Uint8Array };

const CACHE_NAME = 'fm-inpaint-models-v1';
const sessions = new Map<InpaintModelId, Promise<ort.InferenceSession>>();
const backends = new Map<InpaintModelId, string>();

// Pomocná vlákna WASM spouští onnxruntime z TOHOTO souboru (bundler do něj
// vložil i runtime) se jménem "em-pthread". V takovém vlákně nesmíme sahat na
// self.onmessage ani na nastavení: přepsali bychom obsluhu vlákna, to by se
// nikdy nenahlásilo a vytvoření modelu by čekalo donekonečna (zamrzlé
// "Stahuji model 100 %" na produkci, kde je stránka cross-origin izolovaná).
const IS_ORT_THREAD = typeof self.name === 'string' && self.name.startsWith('em-pthread');

// Vlákna WASM jdou jen v cross-origin izolované stránce (SharedArrayBuffer).
if (!IS_ORT_THREAD) {
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(8, Math.max(1, (self.navigator?.hardwareConcurrency ?? 4) - 1))
    : 1;
}

const WEBGPU_INIT_TIMEOUT_MS = 30_000;

const withTimeout = <T>(promise: Promise<T>, ms: number, code: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const post = (message: unknown, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

const fetchModel = (model: InpaintModelId, id: number): Promise<Uint8Array> => {
  const { url, bytes } = INPAINT_MODELS[model];
  return fetchCachedModel(CACHE_NAME, url, bytes, (loaded, total, cached) =>
    post({ type: 'progress', id, loaded, total, cached }),
  );
};

const N = MODEL_SIZE * MODEL_SIZE;

// Zkušební průchod na prázdném vstupu. První inference kompiluje shadery
// (WebGPU) a alokuje buffery — bez zahřátí by na to čekal první tah štětcem.
const warmUp = async (session: ort.InferenceSession, model: InpaintModelId) => {
  const started = performance.now();
  const mask = new Uint8Array(N);
  mask.fill(1, (N >> 1) - 4096, (N >> 1) + 4096);
  await runModel(session, model, new Uint8Array(3 * N), mask);
  return performance.now() - started;
};

// Druhý průchod po zahřátí = skutečná rychlost jednoho tahu na daném backendu.
const measure = async (session: ort.InferenceSession, model: InpaintModelId) => {
  await warmUp(session, model);
  return warmUp(session, model);
};

const createSession = async (model: InpaintModelId, bytes: Uint8Array) => {
  const hasWebGpu = typeof (self.navigator as Navigator & { gpu?: unknown })?.gpu !== 'undefined';
  let gpu: ort.InferenceSession | null = null;
  if (hasWebGpu) {
    try {
      // Některé ovladače GPU inicializaci nikdy nedokončí, pak radši CPU.
      gpu = await withTimeout(
        ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }),
        WEBGPU_INIT_TIMEOUT_MS,
        'WEBGPU_INIT_TIMEOUT',
      );
    } catch {
      gpu = null;
    }
  }

  // LaMa (208 MB) je na CPU několikanásobně pomalejší — když GPU projde, bere se GPU.
  if (gpu && model === 'quality') {
    try {
      await withTimeout(warmUp(gpu, model), WEBGPU_INIT_TIMEOUT_MS, 'WEBGPU_WARMUP_TIMEOUT');
      backends.set(model, 'webgpu');
      return gpu;
    } catch {
      await gpu.release().catch(() => {});
      gpu = null;
    }
  }

  const cpu = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });

  // Rychlý model (MI-GAN) má v grafu i předzpracování nad uint8, které WebGPU
  // často nepodporuje a přehazuje mezi GPU a CPU — na výkonném CPU bývá WASM
  // rychlejší. Proto se oba změří na tomhle počítači a nechá se rychlejší.
  if (gpu) {
    try {
      const gpuMs = await withTimeout(measure(gpu, model), WEBGPU_INIT_TIMEOUT_MS, 'WEBGPU_WARMUP_TIMEOUT');
      const cpuMs = await measure(cpu, model);
      if (gpuMs < cpuMs) {
        await cpu.release().catch(() => {});
        backends.set(model, 'webgpu');
        return gpu;
      }
    } catch {
      /* GPU neprošlo, zůstává CPU */
    }
    await gpu.release().catch(() => {});
  } else if (model === 'fast') {
    await warmUp(cpu, model);
  }
  backends.set(model, 'wasm');
  return cpu;
};

const getSession = (model: InpaintModelId, id: number) => {
  let pending = sessions.get(model);
  if (!pending) {
    pending = fetchModel(model, id).then((bytes) => {
      post({ type: 'progress', id, phase: 'init' });
      return createSession(model, bytes);
    });
    // Při chybě zapomenout, ať jde zkusit znovu.
    pending.catch(() => sessions.delete(model));
    sessions.set(model, pending);
  }
  return pending;
};

const runModel = async (
  session: ort.InferenceSession,
  model: InpaintModelId,
  image: Uint8Array,
  mask: Uint8Array,
): Promise<Uint8Array> => {
  const dims = [1, 3, MODEL_SIZE, MODEL_SIZE];
  const maskDims = [1, 1, MODEL_SIZE, MODEL_SIZE];

  if (model === 'fast') {
    // MI-GAN pipeline: uint8, maska 255 = zachovat, 0 = doplnit (ověřeno
    // na ukázce — opačná konvence vrací nesmysl přes celý obraz).
    const keep = new Uint8Array(N);
    for (let i = 0; i < N; i++) keep[i] = mask[i] ? 0 : 255;
    const out = await session.run({
      image: new ort.Tensor('uint8', image, dims),
      mask: new ort.Tensor('uint8', keep, maskDims),
    });
    return new Uint8Array((out.result ?? out[session.outputNames[0]]).data as Uint8Array);
  }

  // LaMa: float 0–1, maska 1 = doplnit; výstup je float 0–255.
  const img = new Float32Array(3 * N);
  for (let i = 0; i < 3 * N; i++) img[i] = image[i] / 255;
  const hole = new Float32Array(N);
  for (let i = 0; i < N; i++) hole[i] = mask[i] ? 1 : 0;
  const out = await session.run({
    image: new ort.Tensor('float32', img, dims),
    mask: new ort.Tensor('float32', hole, maskDims),
  });
  const data = (out.output ?? out[session.outputNames[0]]).data as Float32Array;
  const result = new Uint8Array(3 * N);
  for (let i = 0; i < 3 * N; i++) result[i] = Math.max(0, Math.min(255, Math.round(data[i])));
  return result;
};

const handle = async (event: MessageEvent<Request>) => {
  const msg = event.data;
  if (msg.type === 'config') {
    // Jen před první session, potom už runtime počet vláken nezmění.
    if (sessions.size === 0) ort.env.wasm.numThreads = Math.max(1, msg.numThreads);
    post({ type: 'ready', id: msg.id });
    return;
  }
  try {
    const session = await getSession(msg.model, msg.id);
    if (msg.type === 'load') {
      post({ type: 'ready', id: msg.id, backend: backends.get(msg.model) });
      return;
    }
    const started = performance.now();
    const result = await runModel(session, msg.model, msg.image, msg.mask);
    post(
      { type: 'result', id: msg.id, result, ms: Math.round(performance.now() - started), backend: backends.get(msg.model) },
      [result.buffer],
    );
  } catch (error) {
    post({ type: 'error', id: msg.id, error: error instanceof Error ? error.message : String(error) });
  }
};

if (!IS_ORT_THREAD) self.onmessage = handle;
