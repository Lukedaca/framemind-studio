import exifr from 'exifr';
import type { CullingExif } from '../types';
import { PREVIEW_MAX_SIDE, nativeSampleRects, readMetrics, summarizeNativeSamples } from '../utils/cullingMetrics';
import { buildCullingResult, computeSimilarityGroups, type PhotoAnalysis } from '../utils/cullingEngine';
import type { CullingRequest } from '../utils/cullingProtocol';
import { inspectionRect, type CullingInspection } from '../utils/cullingInspection';

async function readExif(file: File): Promise<CullingExif | undefined> {
  try {
    const values = await exifr.parse(file, { pick: ['DateTimeOriginal', 'SubSecTimeOriginal', 'ExposureTime', 'ISO', 'FNumber', 'FocalLength'] });
    if (!values) return undefined;
    const exif: CullingExif = {};
    if (values.DateTimeOriginal instanceof Date && Number.isFinite(values.DateTimeOriginal.getTime())) {
      const fraction = /^\d+$/.test(String(values.SubSecTimeOriginal ?? '')) ? Number(`0.${values.SubSecTimeOriginal}`) * 1000 : 0;
      exif.captureTimeMs = values.DateTimeOriginal.getTime() + (values.DateTimeOriginal.getMilliseconds() ? 0 : fraction);
    }
    for (const [key, field] of [['exposureTime', 'ExposureTime'], ['iso', 'ISO'], ['aperture', 'FNumber'], ['focalLength', 'FocalLength']] as const) {
      const value = Number(values[field]);
      if (Number.isFinite(value) && value > 0) exif[key] = value;
    }
    return Object.keys(exif).length ? exif : undefined;
  } catch { return undefined; } // Missing EXIF never prevents pixel analysis.
}

async function analyze(request: Extract<CullingRequest, { kind: 'analyze' }>): Promise<PhotoAnalysis> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error('Local culling needs worker image decoding and OffscreenCanvas');
  }
  const bitmap = await createImageBitmap(request.file);
  try {
    const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Culling canvas unavailable');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const preview = context.getImageData(0, 0, width, height);
    const metrics = readMetrics(preview.data, width, height);
    if (Math.max(bitmap.width, bitmap.height) > PREVIEW_MAX_SIDE) {
      const samples = nativeSampleRects(bitmap.width, bitmap.height, preview).map(rect => {
        // Reuse the canvas and original bitmap; no full-resolution pixel buffer or model.
        canvas.width = rect.width; canvas.height = rect.height;
        context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        return readMetrics(context.getImageData(0, 0, rect.width, rect.height).data, rect.width, rect.height, false, false);
      });
      metrics.native = summarizeNativeSamples(samples, bitmap.width, bitmap.height, nativeSampleRects(bitmap.width, bitmap.height).length);
    }
    if (request.focusRegion) {
      const region = request.focusRegion;
      if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) throw new Error('Invalid focus region');
      const w = Math.max(1, Math.min(384, bitmap.width, Math.round(region.width * bitmap.width)));
      const h = Math.max(1, Math.min(384, bitmap.height, Math.round(region.height * bitmap.height)));
      const x = Math.max(0, Math.min(bitmap.width - w, Math.round(region.x * bitmap.width)));
      const y = Math.max(0, Math.min(bitmap.height - h, Math.round(region.y * bitmap.height)));
      canvas.width = w; canvas.height = h;
      context.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
      const focus = readMetrics(context.getImageData(0, 0, w, h).data, w, h, false);
      metrics.focus = { region: { x: x / bitmap.width, y: y / bitmap.height, width: w / bitmap.width, height: h / bitmap.height }, technical: focus.technical!, sharpnessScore: focus.sharpnessScore };
    }
    return { metrics, focusRegion: metrics.focus?.region, aspectRatio: bitmap.width / bitmap.height, source: request.source, exif: await readExif(request.metadataFile) };
  } finally { bitmap.close(); }
}

/** Inspect every decoded source pixel in bounded tiles; tiny changed moments veto duplication. */
async function verifyDuplicate(file: File, reference: File, bytesOnly = false): Promise<boolean> {
  if (bytesOnly) {
    if (file.size !== reference.size || !self.crypto?.subtle) return false;
    const a = new Uint8Array(await self.crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
    const b = new Uint8Array(await self.crypto.subtle.digest('SHA-256', await reference.arrayBuffer()));
    return a.every((value, index) => value === b[index]);
  }
  const a = await createImageBitmap(file);
  let b: ImageBitmap | undefined;
  try {
    if (a.width * a.height > 64_000_000) return false;
    b = await createImageBitmap(reference);
    if (a.width !== b.width || a.height !== b.height) return false;
    const first = new OffscreenCanvas(512, 128), second = new OffscreenCanvas(512, 128);
    const ac = first.getContext('2d', { willReadFrequently: true })!, bc = second.getContext('2d', { willReadFrequently: true })!;
    for (let y = 0; y < a.height; y += 128) for (let x = 0; x < a.width; x += 512) {
      const w = Math.min(512, a.width - x), h = Math.min(128, a.height - y);
      ac.clearRect(0, 0, 512, 128); bc.clearRect(0, 0, 512, 128);
      ac.drawImage(a, x, y, w, h, 0, 0, w, h); bc.drawImage(b, x, y, w, h, 0, 0, w, h);
      const av = ac.getImageData(0, 0, w, h).data, bv = bc.getImageData(0, 0, w, h).data;
      for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
    }
    return true;
  } finally { a.close(); b?.close(); }
}

async function inspect(request: Extract<CullingRequest, { kind: 'inspect' }>): Promise<CullingInspection> {
  const bitmap = await createImageBitmap(request.file);
  try {
    const region = inspectionRect(bitmap.width, bitmap.height, request.point);
    const canvas = new OffscreenCanvas(region.width, region.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Inspection canvas unavailable');
    context.drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
    const metrics = readMetrics(context.getImageData(0, 0, region.width, region.height).data, region.width, region.height, false);
    // PNG preserves the decoded crop exactly; the original is never re-encoded.
    return { region, sourceWidth: bitmap.width, sourceHeight: bitmap.height, metrics,
      image: await canvas.convertToBlob({ type: 'image/png' }) };
  } finally { bitmap.close(); }
}

// Requests are awaited sequentially; duplicate verification owns at most two bitmaps.
self.onmessage = async ({ data }: MessageEvent<CullingRequest>) => {
  try {
    const value = data.kind === 'analyze' ? await analyze(data)
      : data.kind === 'inspect' ? await inspect(data)
      : data.kind === 'verify-duplicate' ? await verifyDuplicate(data.file, data.reference, data.bytesOnly)
      : data.kind === 'group' ? [...computeSimilarityGroups(data.items)]
      : buildCullingResult(data.analysis, data.genre);
    self.postMessage({ id: data.id, value });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
