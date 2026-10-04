import type { CullingSignature } from '../types';

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }

function areaAverage(values: Float32Array, width: number, height: number, columns: number, rows: number): number[] {
  const result: number[] = [];
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < columns; cx += 1) {
      // Fractional area weighting avoids nearest-neighbour/phase hash aliasing.
      const x0 = cx * width / columns;
      const x1 = (cx + 1) * width / columns;
      const y0 = cy * height / rows;
      const y1 = (cy + 1) * height / rows;
      let sum = 0;
      let weight = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
        for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
          const w = (Math.min(x + 1, x1) - Math.max(x, x0)) * (Math.min(y + 1, y1) - Math.max(y, y0));
          sum += values[Math.min(height - 1, y) * width + Math.min(width - 1, x)] * w;
          weight += w;
        }
      }
      result.push(sum / Math.max(weight, 1e-9) / 255);
    }
  }
  return result;
}

export function createSignature(gray: Float32Array, data: Uint8ClampedArray, width: number, height: number,
  histogram: Uint32Array, standardDeviation: number): CullingSignature {
  const luma = areaAverage(gray, width, height, 32, 32);
  const small = areaAverage(gray, width, height, 16, 16);
  const differences = areaAverage(gray, width, height, 17, 16);
  const mean = small.reduce((sum, v) => sum + v, 0) / small.length;
  let differenceHash = '';
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) differenceHash += differences[y * 17 + x] >= differences[y * 17 + x + 1] ? '1' : '0';
  }
  const channels: number[][] = [];
  for (let c = 0; c < 3; c += 1) {
    const channel = new Float32Array(width * height);
    for (let p = 0; p < channel.length; p += 1) {
      const alpha = data[p * 4 + 3] / 255;
      channel[p] = data[p * 4 + c] * alpha + 128 * (1 - alpha);
    }
    channels.push(areaAverage(channel, width, height, 16, 16));
  }
  const color: number[] = [];
  for (let p = 0; p < 256; p += 1) for (const channel of channels) color.push(channel[p]);
  const bins = Array.from({ length: 16 }, (_, b) => {
    let sum = 0;
    for (let i = b * 16; i < (b + 1) * 16; i += 1) sum += histogram[i];
    return sum / (width * height);
  });
  return { averageHash: small.map(v => v >= mean ? '1' : '0').join(''), differenceHash, luma, color,
    histogram: bins, detail: standardDeviation / 255 };
}

function hashSimilarity(a: string, b: string): number {
  if (a.length !== 256 || b.length !== 256) return 0;
  let different = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) different += 1;
  return 1 - different / a.length;
}

export interface SimilarityComparison {
  score: number;
  structure: number;
  color: number;
  histogram: number;
  meanDifference: number;
  maxLocalDifference: number;
  informative: boolean;
  nearDuplicate: boolean;
  similarScene: boolean;
}

export function isValidSignature(value: CullingSignature | undefined): value is CullingSignature {
  return !!value && /^[01]{256}$/.test(value.averageHash) && /^[01]{256}$/.test(value.differenceHash) &&
    Array.isArray(value.luma) && value.luma.length === 1024 && Array.isArray(value.color) && value.color.length === 768 &&
    Array.isArray(value.histogram) && value.histogram.length === 16 &&
    Number.isFinite(value.detail) && value.detail >= 0 && value.detail <= 1 &&
    [value.luma, value.color, value.histogram].every(values => values.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
}

export function compareSignatures(a: CullingSignature, b: CullingSignature): SimilarityComparison {
  if (!isValidSignature(a) || !isValidSignature(b)) throw new Error('Invalid perceptual signature');
  const n = a.luma.length;
  const meanA = a.luma.reduce((s, v) => s + v, 0) / n;
  const meanB = b.luma.reduce((s, v) => s + v, 0) / n;
  let va = 0;
  let vb = 0;
  let cov = 0;
  let absolute = 0;
  let maxLocalDifference = 0;
  // Local cells prevent a small changed subject being hidden by a large field.
  // This is comparison, not subject detection.
  for (let by = 0; by < 32; by += 4) {
    for (let bx = 0; bx < 32; bx += 4) {
      let local = 0;
      for (let y = by; y < by + 4; y += 1) {
        for (let x = bx; x < bx + 4; x += 1) {
          const i = y * 32 + x;
          const da = a.luma[i] - meanA;
          const db = b.luma[i] - meanB;
          va += da * da; vb += db * db; cov += da * db;
          const diff = Math.abs(da - db);
          local += diff; absolute += diff;
        }
      }
      maxLocalDifference = Math.max(maxLocalDifference, local / 16);
    }
  }
  const correlation = clamp(cov / Math.max(1e-9, Math.sqrt(va * vb)));
  const structure = clamp(correlation * 0.6 + (1 - absolute / n / 0.15) * 0.4);
  let colorDifference = 0;
  for (let i = 0; i < a.color.length; i += 1) colorDifference += Math.abs(a.color[i] - b.color[i]);
  const color = clamp(1 - colorDifference / a.color.length / 0.18);
  const histogram = a.histogram.reduce((sum, v, i) => sum + Math.min(v, b.histogram[i]), 0);
  const average = hashSimilarity(a.averageHash, b.averageHash);
  const difference = hashSimilarity(a.differenceHash, b.differenceHash);
  const score = clamp(structure * 0.4 + color * 0.2 + average * 0.15 + difference * 0.15 + histogram * 0.1);
  const informative = a.detail >= 0.035 && b.detail >= 0.035 && va / n > 0.0004 && vb / n > 0.0004;
  const meanDifference = Math.abs(meanA - meanB);
  return {
    score, structure, color, histogram, meanDifference, maxLocalDifference, informative,
    nearDuplicate: informative && score >= 0.965 && structure >= 0.985 && color >= 0.92 &&
      average >= 0.97 && difference >= 0.94 && maxLocalDifference <= 0.018 && meanDifference <= 0.035,
    similarScene: informative && score >= 0.84 && structure >= 0.91 && color >= 0.76 &&
      average >= 0.86 && maxLocalDifference <= 0.09,
  };
}
