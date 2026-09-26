// Chytré laso mimo main thread: SAM 2.1 enkodér jednou na fotku, dekodér na
// každý klik. Fotka neopouští počítač.

import * as ort from 'onnxruntime-web';
import { SEGMENT_INPUT, SEGMENT_MODEL, type SegmentPart } from '../utils/segmentModel';
import { fetchCachedModel } from './modelFetch';

type Request =
  | { type: 'load'; id: number }
  | { type: 'encode'; id: number; key: string; pixels: Float32Array }
  | { type: 'decode'; id: number; key: string; points: number[]; labels: number[]; boxes?: number[] };

const CACHE_NAME = 'fm-segment-models-v1';

// Stejná past jako u retuše: pomocná WASM vlákna běží z tohoto souboru se
// jménem „em-pthread" a nesmí se jim přepsat obsluha zpráv.
const IS_ORT_THREAD = typeof self.name === 'string' && self.name.startsWith('em-pthread');
if (!IS_ORT_THREAD) {
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(8, Math.max(1, (self.navigator?.hardwareConcurrency ?? 4) - 1))
    : 1;
}

const post = (message: unknown, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

let sessions: Promise<{ encoder: ort.InferenceSession; decoder: ort.InferenceSession }> | null = null;
// Embeddingy poslední fotky (klíč = fotka + verze obsahu po retuši).
let embedded: { key: string; outputs: Record<string, ort.Tensor> } | null = null;

const loadPart = async (part: SegmentPart, onBytes: (n: number) => void) => {
  let graphLoaded = 0;
  let dataLoaded = 0;
  const report = () => onBytes(graphLoaded + dataLoaded);
  const [graph, data] = await Promise.all([
    fetchCachedModel(CACHE_NAME, part.graph.url, part.graph.bytes, (l) => {
      graphLoaded = l;
      report();
    }),
    fetchCachedModel(CACHE_NAME, part.data.url, part.data.bytes, (l) => {
      dataLoaded = l;
      report();
    }),
  ]);
  // Kvantovaný model počítá celočíselně — na CPU (WASM) spolehlivě, WebGPU
  // tyhle operace stejně z velké části vrací na CPU.
  return ort.InferenceSession.create(graph, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    externalData: [{ path: part.data.name, data }],
  });
};

const getSessions = (id: number) => {
  if (!sessions) {
    const { encoder, decoder } = SEGMENT_MODEL;
    const total = encoder.graph.bytes + encoder.data.bytes + decoder.graph.bytes + decoder.data.bytes;
    let enc = 0;
    let dec = 0;
    const report = () => post({ type: 'progress', id, loaded: enc + dec, total });
    sessions = Promise.all([
      loadPart(encoder, (n) => {
        enc = n;
        report();
      }),
      loadPart(decoder, (n) => {
        dec = n;
        report();
      }),
    ]).then(([e, d]) => ({ encoder: e, decoder: d }));
    sessions.catch(() => {
      sessions = null;
    });
  }
  return sessions;
};

const handle = async (event: MessageEvent<Request>) => {
  const msg = event.data;
  try {
    const { encoder, decoder } = await getSessions(msg.id);
    if (msg.type === 'load') {
      post({ type: 'ready', id: msg.id });
      return;
    }
    if (msg.type === 'encode') {
      if (embedded?.key !== msg.key) {
        const started = performance.now();
        const outputs = await encoder.run({
          pixel_values: new ort.Tensor('float32', msg.pixels, [1, 3, SEGMENT_INPUT, SEGMENT_INPUT]),
        });
        embedded = { key: msg.key, outputs };
        post({ type: 'ready', id: msg.id, ms: Math.round(performance.now() - started) });
      } else {
        post({ type: 'ready', id: msg.id, ms: 0 });
      }
      return;
    }
    if (!embedded || embedded.key !== msg.key) throw new Error('SEGMENT_NOT_ENCODED');
    // Body (klik) nebo obdélníky (z vyhledání textem) — model chce oba vstupy,
    // nepoužitý jde jako prázdný tenzor (ověřeno v Node).
    const n = msg.labels.length;
    const boxes = msg.boxes ?? [];
    const out = await decoder.run({
      input_points: new ort.Tensor('float32', Float32Array.from(msg.points), [1, 1, n, 2]),
      input_labels: new ort.Tensor('int64', BigInt64Array.from(msg.labels.map((l) => BigInt(l))), [1, 1, n]),
      input_boxes: new ort.Tensor('float32', Float32Array.from(boxes), [1, boxes.length / 4, 4]),
      'image_embeddings.0': embedded.outputs['image_embeddings.0'],
      'image_embeddings.1': embedded.outputs['image_embeddings.1'],
      'image_embeddings.2': embedded.outputs['image_embeddings.2'],
    });
    const masks = new Float32Array(out.pred_masks.data as Float32Array);
    const iou = Array.from(out.iou_scores.data as Float32Array);
    post({ type: 'result', id: msg.id, masks, iou }, [masks.buffer]);
  } catch (error) {
    post({ type: 'error', id: msg.id, error: error instanceof Error ? error.message : String(error) });
  }
};

if (!IS_ORT_THREAD) self.onmessage = handle;
