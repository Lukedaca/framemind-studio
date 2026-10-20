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
    const metrics = readMetrics(context.getImageData(0, 0, width, height).data, width, height);
    if (Math.max(bitmap.width, bitmap.height) > PREVIEW_MAX_SIDE) {
      const samples = nativeSampleRects(bitmap.width, bitmap.height).map(rect => {
        // Reuse the canvas and original bitmap; no full-resolution pixel buffer or model.
        canvas.width = rect.width; canvas.height = rect.height;
        context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        return readMetrics(context.getImageData(0, 0, rect.width, rect.height).data, rect.width, rect.height, false);
      });
      metrics.native = summarizeNativeSamples(samples, bitmap.width, bitmap.height);
    }
    return { metrics, aspectRatio: bitmap.width / bitmap.height, source: request.source, exif: await readExif(request.metadataFile) };
  } finally { bitmap.close(); }
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

// Callers await requests sequentially: at most one decoded original is resident.
self.onmessage = async ({ data }: MessageEvent<CullingRequest>) => {
  try {
    const value = data.kind === 'analyze' ? await analyze(data)
      : data.kind === 'inspect' ? await inspect(data)
      : data.kind === 'group' ? [...computeSimilarityGroups(data.items)]
      : buildCullingResult(data.analysis, data.genre);
    self.postMessage({ id: data.id, value });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
