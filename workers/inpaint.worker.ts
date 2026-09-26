// Lokální inpainting mimo main thread. Model se stáhne jednou, uloží do Cache
// Storage a další spuštění appky ho čte z disku — bez API, bez klíče, offline.
//
// Vstup i výstup je čtverec MODEL_SIZE×MODEL_SIZE; výřez, zmenšení a vložení
// zpátky do plného rozlišení řeší services/localInpaint.ts.

import * as ort from 'onnxruntime-web';
import { INPAINT_MODELS, type InpaintModelId } from '../utils/inpaintModels';
import { MODEL_SIZE } from '../utils/inpaintMath';

type Request =
  | { type: 'load'; id: number; model: InpaintModelId }
  | { type: 'run'; id: number; model: InpaintModelId; image: Uint8Array; mask: Uint8Array };

const CACHE_NAME = 'fm-inpaint-models-v1';
const sessions = new Map<InpaintModelId, Promise<ort.InferenceSession>>();
const backends = new Map<InpaintModelId, string>();

// Vlákna WASM jdou jen v cross-origin izolované stránce (SharedArrayBuffer).
// Bez izolace ort spadne na jedno vlákno sám, ale explicitně je to čitelnější.
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(8, Math.max(1, (self.navigator?.hardwareConcurrency ?? 4) - 1))
  : 1;

const post = (message: unknown, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

const fetchModel = async (model: InpaintModelId, id: number): Promise<Uint8Array> => {
  const { url, bytes: expected } = INPAINT_MODELS[model];
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) {
      post({ type: 'progress', id, loaded: expected, total: expected, cached: true });
      return new Uint8Array(await hit.arrayBuffer());
    }
  } catch {
    // Cache Storage nemusí být dostupná (soukromé okno) — stáhne se pokaždé.
    cache = null;
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`MODEL_DOWNLOAD_FAILED: HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length')) || expected;
  const buffer = new Uint8Array(total);
  const reader = response.body.getReader();
  let loaded = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > buffer.length) {
      throw new Error('MODEL_DOWNLOAD_FAILED: unexpected size');
    }
    buffer.set(value, loaded);
    loaded += value.length;
    if (loaded - lastReport > total / 100) {
      lastReport = loaded;
      post({ type: 'progress', id, loaded, total, cached: false });
    }
  }
  if (loaded !== total) throw new Error('MODEL_DOWNLOAD_FAILED: incomplete');

  if (cache) {
    try {
      await cache.put(url, new Response(buffer, { headers: { 'content-type': 'application/octet-stream' } }));
    } catch {
      // Plná kvóta — model poběží, jen se příště stáhne znovu.
    }
  }
  return buffer;
};

const createSession = async (model: InpaintModelId, bytes: Uint8Array) => {
  // WebGPU je u LaMa několikanásobně rychlejší; když ho prohlížeč nemá nebo
  // model na něm neprojde, jede se na WASM (CPU).
  const hasWebGpu = typeof (self.navigator as Navigator & { gpu?: unknown })?.gpu !== 'undefined';
  if (hasWebGpu) {
    try {
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
      backends.set(model, 'webgpu');
      return session;
    } catch {
      // pokračuje na WASM
    }
  }
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  backends.set(model, 'wasm');
  return session;
};

const getSession = (model: InpaintModelId, id: number) => {
  let pending = sessions.get(model);
  if (!pending) {
    pending = fetchModel(model, id).then((bytes) => createSession(model, bytes));
    // Při chybě zapomenout, ať jde zkusit znovu.
    pending.catch(() => sessions.delete(model));
    sessions.set(model, pending);
  }
  return pending;
};

const N = MODEL_SIZE * MODEL_SIZE;

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

self.onmessage = async (event: MessageEvent<Request>) => {
  const msg = event.data;
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
