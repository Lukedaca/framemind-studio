import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import modelUrl from '../assets/culling/u2netp.onnx?url';
import { automaticSamplePlan, subjectInput, SUBJECT_INPUT_SIZE } from '../utils/cullingAutomatic';

const MODEL_SHA256 = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';
let session: Promise<ort.InferenceSession> | undefined;

async function loadModel(): Promise<ort.InferenceSession> {
  // The model and WASM are packaged assets. No external host or image upload.
  const url = new URL(modelUrl, self.location.origin);
  if (url.origin !== self.location.origin) throw new Error('Nonlocal culling model');
  const response = await fetch(url, { method: 'GET', credentials: 'omit' });
  if (!response.ok) throw new Error('Missing culling model');
  const bytes = await response.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== 4574861 || hash !== MODEL_SHA256) throw new Error('Invalid culling model');
  ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.origin).href, mjs: new URL(wasmModuleUrl, self.location.origin).href };
  // Keep inference in this worker. WebView2's packaged origin can stall nested
  // WASM pthread workers even when crossOriginIsolated is true.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

export async function automaticRegions(bitmap: ImageBitmap) {
  session ??= loadModel();
  const model = await session;
  const canvas = new OffscreenCanvas(SUBJECT_INPUT_SIZE, SUBJECT_INPUT_SIZE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Subject canvas unavailable');
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, SUBJECT_INPUT_SIZE, SUBJECT_INPUT_SIZE);
  const input = new ort.Tensor('float32', subjectInput(context.getImageData(0, 0, SUBJECT_INPUT_SIZE, SUBJECT_INPUT_SIZE).data), [1, 3, SUBJECT_INPUT_SIZE, SUBJECT_INPUT_SIZE]);
  try {
    const output = await model.run({ [model.inputNames[0]]: input }, [model.outputNames[0]]);
    try { return automaticSamplePlan(output[model.outputNames[0]].data as Float32Array, bitmap.width, bitmap.height); }
    finally { Object.values(output).forEach(tensor => tensor.dispose()); }
  } finally { input.dispose(); }
}
