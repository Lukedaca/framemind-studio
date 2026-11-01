import type { CullingFocusRegion, CullingMetrics } from '../types';
import { validFocusEvidence } from './cullingRegions';

export const CULLING_SUBJECT_MODEL = 'u2netp-309c8469' as const;
export const SUBJECT_INPUT_SIZE = 320;
export const MAX_AUTOMATIC_SAMPLES = 12;

export function validAutomaticEvidence(metrics: CullingMetrics): boolean {
  const auto = metrics.automatic;
  if (!auto) return true;
  if (auto.model !== CULLING_SUBJECT_MODEL || !['measured', 'no-region', 'unavailable'].includes(auto.status) ||
      !Number.isFinite(auto.coverage) || auto.coverage < 0 || auto.coverage > 1 || auto.samples.length > MAX_AUTOMATIC_SAMPLES) return false;
  if (auto.status !== 'measured') return !auto.samples.length && !auto.summary;
  return auto.samples.length > 0 && !!auto.summary && auto.summary.sampleCount === auto.samples.length &&
    Object.values(auto.summary).every(v => Number.isFinite(v) && v >= 0) && auto.samples.every(sample =>
      sample.sourceWidth === auto.summary!.sourceWidth && sample.sourceHeight === auto.summary!.sourceHeight &&
      validFocusEvidence({ focusRegions: [sample] } as CullingMetrics));
}

/** Model input protocol, RGB/NCHW. Pure math; no image or network I/O. */
export function subjectInput(data: Uint8ClampedArray): Float32Array {
  const count = SUBJECT_INPUT_SIZE ** 2;
  if (data.length !== count * 4) throw new Error('Invalid subject input');
  let maximum = 1;
  const pixel = (i: number, c: number) => data[i * 4 + c] * (data[i * 4 + 3] / 255) + 128 * (1 - data[i * 4 + 3] / 255);
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) maximum = Math.max(maximum, pixel(i, c));
  const input = new Float32Array(count * 3), mean = [.485, .456, .406], deviation = [.229, .224, .225];
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) input[c * count + i] = (pixel(i, c) / maximum - mean[c]) / deviation[c];
  return input;
}

/** Connected foreground components, then bounded interior 1:1 samples. No center/person assumption. */
export function automaticSamplePlan(prediction: Float32Array, width: number, height: number): { regions: CullingFocusRegion[]; coverage: number } {
  const size = SUBJECT_INPUT_SIZE, count = size ** 2;
  if (prediction.length !== count || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('Invalid subject map');
  let minimum = 1, maximum = 0;
  for (const value of prediction) {
    if (!Number.isFinite(value) || value < 0 || value > 1.00001) throw new Error('Invalid subject map');
    minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
  }
  if (maximum < .7 || maximum - minimum < .25) return { regions: [], coverage: 0 };
  const mask = new Uint8Array(count), seen = new Uint8Array(count), queue = new Int32Array(count);
  let foreground = 0;
  for (let i = 0; i < count; i++) if ((prediction[i] - minimum) / (maximum - minimum) >= .65) { mask[i] = 1; foreground++; }
  const coverage = foreground / count;
  if (coverage < .0025 || coverage > .65) return { regions: [], coverage };
  const parts: { pixels: number[]; left: number; right: number; top: number; bottom: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (!mask[i] || seen[i]) continue;
    let head = 0, tail = 1; queue[0] = i; seen[i] = 1;
    const part = { pixels: [] as number[], left: size, right: 0, top: size, bottom: 0 };
    while (head < tail) {
      const p = queue[head++], x = p % size, y = Math.floor(p / size);
      part.pixels.push(p); part.left = Math.min(part.left, x); part.right = Math.max(part.right, x);
      part.top = Math.min(part.top, y); part.bottom = Math.max(part.bottom, y);
      for (const next of [x > 0 ? p - 1 : -1, x < size - 1 ? p + 1 : -1, y > 0 ? p - size : -1, y < size - 1 ? p + size : -1]) {
        if (next >= 0 && mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
    }
    if (part.pixels.length >= Math.max(32, foreground * .08)) parts.push(part);
  }
  parts.sort((a, b) => b.pixels.length - a.pixels.length || a.top - b.top || a.left - b.left);
  const regions: CullingFocusRegion[] = [], w = Math.min(128, width), h = Math.min(128, height);
  for (const part of parts.slice(0, 4)) {
    const candidates: { x: number; y: number; score: number }[] = [];
    for (const fy of [.15, .35, .5, .65, .85]) for (const fx of [.25, .5, .75]) {
      const x = Math.max(0, Math.min(width - w, Math.round((part.left + (part.right - part.left) * fx) / size * width - w / 2)));
      const y = Math.max(0, Math.min(height - h, Math.round((part.top + (part.bottom - part.top) * fy) / size * height - h / 2)));
      let covered = 0, score = 0;
      for (let sy = 0; sy < 5; sy++) for (let sx = 0; sx < 5; sx++) {
        const mx = Math.min(size - 1, Math.floor((x + (sx + .5) * w / 5) / width * size));
        const my = Math.min(size - 1, Math.floor((y + (sy + .5) * h / 5) / height * size));
        covered += mask[my * size + mx]; score += prediction[my * size + mx];
      }
      if (covered >= 23) candidates.push({ x, y, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
    const chosen: typeof candidates = [];
    for (const candidate of candidates) {
      if (chosen.some(c => Math.abs(c.x - candidate.x) < w * .6 && Math.abs(c.y - candidate.y) < h * .6)) continue;
      chosen.push(candidate);
      regions.push({ x: candidate.x / width, y: candidate.y / height, width: w / width, height: h / height });
      if (chosen.length === 3 || regions.length === MAX_AUTOMATIC_SAMPLES) break;
    }
  }
  return { regions, coverage };
}
