// Lokální inpainting mimo main thread. Model se stáhne jednou, uloží do Cache
// Storage a další spuštění appky ho čte z disku — bez API, bez klíče, offline.
//
// Vstup i výstup je čtverec 512×512 nebo LaMa 1024×1024; výřez a vložení
// zpátky do plného rozlišení řeší services/localInpaint.ts.

import * as ort from 'onnxruntime-web/webgpu';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortWasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { INPAINT_MODELS, type InpaintModelId } from '../utils/inpaintModels';
import { MODEL_SIZE } from '../utils/inpaintMath';
import { resizeLamaInput } from '../utils/inpaintModelShape';
import { fetchCachedModel } from './modelFetch';

type Request =
  | { type: 'config'; id: number; numThreads?: number; disableGpu?: boolean }
  | { type: 'load'; id: number; model: InpaintModelId }
  | { type: 'run'; id: number; model: InpaintModelId; size?: 512 | 1024; image: Uint8Array; mask: Uint8Array };

const CACHE_NAME = 'fm-inpaint-models-v1';
const sessions = new Map<string, Promise<ort.InferenceSession>>();
const backends = new Map<string, string>();
const sessionKey = (model: InpaintModelId, size: number) => `${model}:${size}`;

// Explicit URLs keep the WebGPU entry and both runtime assets on the same
// installed version/variant. WASM threads start the standalone runtime module,
// so they never replace their thread handler with this application's onmessage.
ort.env.wasm.wasmPaths = {
  wasm: new URL(ortWasmUrl, self.location.href).href,
  mjs: new URL(ortWasmModuleUrl, self.location.href).href,
};
// Vlákna WASM jdou jen v cross-origin izolované stránce (SharedArrayBuffer).
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(8, Math.max(1, (self.navigator?.hardwareConcurrency ?? 4) - 1))
  : 1;

const WEBGPU_INIT_TIMEOUT_MS = 30_000;
let gpuDisabled = false;

const rethrowGpuTimeout = (error: unknown) => {
  if (error instanceof Error && /WEBGPU_(INIT|WARMUP)_TIMEOUT/.test(error.message)) {
    // A timed-out call is still inside the shared runtime. CPU fallback must
    // start in a fresh worker, never initialize/run that same module concurrently.
    throw new Error('INPAINT_GPU_TIMEOUT');
  }
};

const withTimeout = <T>(promise: Promise<T>, ms: number, code: string, onLateResolve?: (value: T) => void | Promise<void>) =>
  new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(code));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (timedOut) {
          // A late GPU session still owns model/device buffers after CPU fallback.
          if (onLateResolve) void Promise.resolve().then(() => onLateResolve(value)).catch(() => {});
          return;
        }
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const releaseWhenSettled = (session: ort.InferenceSession, running: Promise<unknown>) => {
  // A timeout does not stop inference. Never release buffers underneath that run.
  const release = () => session.release();
  void running.then(release, release).catch(() => {});
};

const post = (message: unknown, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

const fetchModel = (model: InpaintModelId, id: number): Promise<Uint8Array> => {
  const { url, bytes } = INPAINT_MODELS[model];
  return fetchCachedModel(CACHE_NAME, url, bytes, (loaded, total, cached) =>
    post({ type: 'progress', id, loaded, total, cached }),
  );
};

// Zkušební průchod na prázdném vstupu. První inference kompiluje shadery
// (WebGPU) a alokuje buffery — bez zahřátí by na to čekal první tah štětcem.
const warmUp = async (session: ort.InferenceSession, model: InpaintModelId, size = MODEL_SIZE) => {
  const N = size * size;
  const started = performance.now();
  const mask = new Uint8Array(N);
  mask.fill(1, (N >> 1) - 4096, (N >> 1) + 4096);
  await runModel(session, model, new Uint8Array(3 * N), mask, size);
  return performance.now() - started;
};

// Druhý průchod po zahřátí = skutečná rychlost jednoho tahu na daném backendu.
const measure = async (session: ort.InferenceSession, model: InpaintModelId, size = MODEL_SIZE) => {
  await warmUp(session, model, size);
  return warmUp(session, model, size);
};

const createSession = async (model: InpaintModelId, bytes: Uint8Array, size: 512 | 1024) => {
  const key = sessionKey(model, size);
  const modelBytes = model === 'quality' ? resizeLamaInput(bytes, size) : bytes;
  // Both EPs share the WASM module. Finish its initialization before trying GPU.
  const cpu = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const hasWebGpu = !gpuDisabled && typeof (self.navigator as Navigator & { gpu?: unknown })?.gpu !== 'undefined';
  let gpu: ort.InferenceSession | null = null;
  if (hasWebGpu) {
    try {
      // Některé ovladače GPU inicializaci nikdy nedokončí, pak radši CPU.
      gpu = await withTimeout(
        ort.InferenceSession.create(modelBytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }),
        WEBGPU_INIT_TIMEOUT_MS,
        'WEBGPU_INIT_TIMEOUT',
        (lateSession) => lateSession.release(),
      );
    } catch (error) {
      rethrowGpuTimeout(error);
      gpu = null;
    }
  }

  // LaMa (208 MB) je na CPU několikanásobně pomalejší — když GPU projde, bere se GPU.
  if (gpu && model === 'quality') {
    const warming = warmUp(gpu, model, size);
    try {
      await withTimeout(warming, WEBGPU_INIT_TIMEOUT_MS, 'WEBGPU_WARMUP_TIMEOUT');
      await cpu.release().catch(() => {});
      backends.set(key, 'webgpu');
      return gpu;
    } catch (error) {
      rethrowGpuTimeout(error);
      releaseWhenSettled(gpu, warming);
      gpu = null;
    }
  }

  // Rychlý model (MI-GAN) má v grafu i předzpracování nad uint8, které WebGPU
  // často nepodporuje a přehazuje mezi GPU a CPU — na výkonném CPU bývá WASM
  // rychlejší. Proto se oba změří na tomhle počítači a nechá se rychlejší.
  if (gpu) {
    const measuring = measure(gpu, model, size);
    let gpuMs = Infinity;
    try {
      gpuMs = await withTimeout(measuring, WEBGPU_INIT_TIMEOUT_MS, 'WEBGPU_WARMUP_TIMEOUT');
    } catch (error) {
      rethrowGpuTimeout(error);
      releaseWhenSettled(gpu, measuring);
      gpu = null;
    }
    if (gpu) {
      let cpuMs: number;
      try {
        cpuMs = await measure(cpu, model, size);
      } catch {
        // Keep the verified GPU when the CPU benchmark itself fails.
        await cpu.release().catch(() => {});
        backends.set(key, 'webgpu');
        return gpu;
      }
      if (gpuMs < cpuMs) {
        await cpu.release().catch(() => {});
        backends.set(key, 'webgpu');
        return gpu;
      }
      await gpu.release().catch(() => {});
      backends.set(key, 'wasm');
      return cpu;
    }
  }
  if (model === 'fast') {
    try {
      await warmUp(cpu, model, size);
    } catch (error) {
      await cpu.release().catch(() => {});
      throw error;
    }
  }
  backends.set(key, 'wasm');
  return cpu;
};

const getSession = (model: InpaintModelId, id: number, size: 512 | 1024) => {
  const key = sessionKey(model, size);
  let pending = sessions.get(key);
  if (!pending) {
    pending = fetchModel(model, id).then((bytes) => {
      post({ type: 'progress', id, phase: 'init' });
      return createSession(model, bytes, size);
    });
    // Při chybě zapomenout, ať jde zkusit znovu.
    pending.catch(() => sessions.delete(key));
    sessions.set(key, pending);
  }
  return pending;
};

const runModel = async (
  session: ort.InferenceSession,
  model: InpaintModelId,
  image: Uint8Array,
  mask: Uint8Array,
  size = MODEL_SIZE,
): Promise<Uint8Array> => {
  const N = size * size;
  if (image.length !== 3 * N || mask.length !== N) throw new Error('INPAINT_INVALID_INPUT');
  const dims = [1, 3, size, size];
  const maskDims = [1, 1, size, size];
  let inputs: Record<string, ort.Tensor>;

  if (model === 'fast') {
    // MI-GAN pipeline: uint8, maska 255 = zachovat, 0 = doplnit (ověřeno
    // na ukázce — opačná konvence vrací nesmysl přes celý obraz).
    const keep = new Uint8Array(N);
    for (let i = 0; i < N; i++) keep[i] = mask[i] ? 0 : 255;
    inputs = {
      image: new ort.Tensor('uint8', image, dims),
      mask: new ort.Tensor('uint8', keep, maskDims),
    };
  } else {
    // LaMa: float 0–1, maska 1 = doplnit; výstup je float 0–255.
    const img = new Float32Array(3 * N);
    for (let i = 0; i < 3 * N; i++) img[i] = image[i] / 255;
    const hole = new Float32Array(N);
    for (let i = 0; i < N; i++) hole[i] = mask[i] ? 1 : 0;
    inputs = {
      image: new ort.Tensor('float32', img, dims),
      mask: new ort.Tensor('float32', hole, maskDims),
    };
  }

  let outputs: ort.InferenceSession.ReturnType | undefined;
  try {
    outputs = await session.run(inputs);
    const output = outputs.result ?? outputs.output ?? outputs[session.outputNames[0]];
    if (output.dims.length !== 4 || output.dims[2] !== size || output.dims[3] !== size || output.data.length !== 3 * N) throw new Error('INPAINT_INVALID_OUTPUT');
    if (model === 'fast') {
      return new Uint8Array(output.data as Uint8Array);
    }
    const data = (outputs.output ?? outputs[session.outputNames[0]]).data as Float32Array;
    const result = new Uint8Array(3 * N);
    for (let i = 0; i < 3 * N; i++) {
      if (!Number.isFinite(data[i])) throw new Error('INPAINT_INVALID_OUTPUT');
      result[i] = Math.max(0, Math.min(255, Math.round(data[i])));
    }
    return result;
  } finally {
    // Copy results before releasing buffers, including warm-up and failed runs.
    for (const tensor of new Set([...Object.values(inputs), ...Object.values(outputs ?? {})])) tensor.dispose();
  }
};

const handle = async (event: MessageEvent<Request>) => {
  const msg = event.data;
  if (msg.type === 'config') {
    // Jen před první session, potom už runtime počet vláken nezmění.
    if (sessions.size === 0) {
      if (msg.numThreads !== undefined) ort.env.wasm.numThreads = Math.max(1, msg.numThreads);
      gpuDisabled = msg.disableGpu === true;
    }
    post({ type: 'ready', id: msg.id });
    return;
  }
  try {
    const size = msg.type === 'run' ? msg.size ?? MODEL_SIZE : MODEL_SIZE;
    if ((size !== 512 && size !== 1024) || (size === 1024 && msg.model !== 'quality')) throw new Error('INPAINT_UNSUPPORTED_RESOLUTION');
    // Only one LaMa resolution lives on the GPU/CPU at a time. Messages are
    // serialized below, so a previous inference cannot lose its active session.
    if (msg.model === 'quality') {
      for (const [key, session] of sessions) {
        if (key.startsWith('quality:') && key !== sessionKey(msg.model, size)) {
          sessions.delete(key);
          backends.delete(key);
          await (await session).release();
        }
      }
    }
    const session = await getSession(msg.model, msg.id, size);
    if (msg.type === 'load') {
      post({ type: 'ready', id: msg.id, backend: backends.get(sessionKey(msg.model, size)) });
      return;
    }
    post({ type: 'progress', id: msg.id, phase: 'compute', backend: backends.get(sessionKey(msg.model, size)) });
    const started = performance.now();
    const result = await runModel(session, msg.model, msg.image, msg.mask, size);
    post(
      { type: 'result', id: msg.id, result, ms: Math.round(performance.now() - started), backend: backends.get(sessionKey(msg.model, size)) },
      [result.buffer],
    );
  } catch (error) {
    post({ type: 'error', id: msg.id, error: error instanceof Error ? error.message : String(error) });
  }
};

let queue = Promise.resolve();
self.onmessage = event => { queue = queue.then(() => handle(event), () => handle(event)); };
