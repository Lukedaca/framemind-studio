import type { CullingMetrics } from '../types';

export const INSPECTION_SIZE = 384;
export interface InspectionPoint { x: number; y: number }
export interface InspectionRect { x: number; y: number; width: number; height: number }
export interface CullingInspection {
  region: InspectionRect;
  sourceWidth: number;
  sourceHeight: number;
  metrics: CullingMetrics;
  image: Blob;
}

// Normalized coordinates refer to the decoded, EXIF-oriented source image.
export function inspectionRect(width: number, height: number, point: InspectionPoint): InspectionRect {
  if (![width, height].every(v => Number.isInteger(v) && v > 0) ||
      ![point.x, point.y].every(Number.isFinite)) throw new Error('Invalid inspection coordinates');
  const w = Math.min(INSPECTION_SIZE, width), h = Math.min(INSPECTION_SIZE, height);
  return {
    x: Math.max(0, Math.min(width - w, Math.round(point.x * width - w / 2))),
    y: Math.max(0, Math.min(height - h, Math.round(point.y * height - h / 2))),
    width: w, height: h,
  };
}

// Ignore letterboxing: a click outside the actual photo must not select its edge.
export function inspectionPoint(x: number, y: number, boxWidth: number, boxHeight: number,
  sourceWidth: number, sourceHeight: number): InspectionPoint | null {
  if (![x, y, boxWidth, boxHeight, sourceWidth, sourceHeight].every(Number.isFinite) ||
      Math.min(boxWidth, boxHeight, sourceWidth, sourceHeight) <= 0) return null;
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const w = sourceWidth * scale, h = sourceHeight * scale;
  const left = (boxWidth - w) / 2, top = (boxHeight - h) / 2;
  return x < left || y < top || x > left + w || y > top + h ? null : { x: (x - left) / w, y: (y - top) / h };
}

// At 1:1, one source pixel occupies one physical display pixel, including HiDPI.
export function inspectionDisplaySize(region: InspectionRect, devicePixelRatio: number, zoom: 1 | 2) {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { width: region.width * zoom / dpr, height: region.height * zoom / dpr };
}
