import exifr from 'exifr';
import type { CullingExif } from '../types';
import { PREVIEW_MAX_SIDE, readMetrics } from '../utils/cullingMetrics';
import { buildCullingResult, computeSimilarityGroups, type PhotoAnalysis } from '../utils/cullingEngine';
import type { CullingRequest } from '../utils/cullingProtocol';

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
    return { metrics, aspectRatio: bitmap.width / bitmap.height, source: request.source, exif: await readExif(request.metadataFile) };
  } finally { bitmap.close(); }
}

// Caller awaits each request: at most one decoded original is resident.
self.onmessage = async ({ data }: MessageEvent<CullingRequest>) => {
  try {
    const value = data.kind === 'analyze' ? await analyze(data)
      : data.kind === 'group' ? [...computeSimilarityGroups(data.items)]
      : buildCullingResult(data.analysis, data.genre);
    self.postMessage({ id: data.id, value });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
