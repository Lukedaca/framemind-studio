// Pure measurements on a bounded preview. No content/face/subject inference.
import type { CullingMetrics, CullingNativeMetrics, CullingTechnicalMetrics } from '../types';
import { createSignature } from './cullingSimilarity';

export const PREVIEW_MAX_SIDE = 768;
export const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

function validatePreview(data: Uint8ClampedArray, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > PREVIEW_MAX_SIDE || height > PREVIEW_MAX_SIDE || data.length !== width * height * 4) {
    throw new Error('Invalid or unbounded culling preview');
  }
}

function percentile(histogram: Uint32Array, count: number, fraction: number): number {
  let sum = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    sum += histogram[i];
    if (sum >= Math.max(1, Math.ceil(count * fraction))) return i;
  }
  return 255;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

export function readMetrics(data: Uint8ClampedArray, width: number, height: number, withSignature = true, multiScale = true): CullingMetrics {
  validatePreview(data, width, height);
  const count = width * height;
  const gray = new Float32Array(count);
  const histogram = new Uint32Array(256);
  const channelHighlights = [0, 0, 0], channelShadows = [0, 0, 0];
  let sum = 0, sumSquared = 0, highlights = 0, shadows = 0;
  for (let p = 0; p < count; p += 1) {
    const alpha = data[p * 4 + 3] / 255;
    const matte = 128 * (1 - alpha);
    const red = data[p * 4] * alpha + matte, green = data[p * 4 + 1] * alpha + matte,
      blue = data[p * 4 + 2] * alpha + matte;
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    gray[p] = luma; histogram[Math.round(luma)] += 1;
    sum += luma; sumSquared += luma * luma;
    if (luma >= 250) highlights += 1;
    if (luma <= 5) shadows += 1;
    if (red >= 250) channelHighlights[0] += 1;
    if (green >= 250) channelHighlights[1] += 1;
    if (blue >= 250) channelHighlights[2] += 1;
    if (red <= 5) channelShadows[0] += 1;
    if (green <= 5) channelShadows[1] += 1;
    if (blue <= 5) channelShadows[2] += 1;
  }
  const meanLuma = sum / count;
  const standardDeviation = Math.sqrt(Math.max(0, sumSquared / count - meanLuma * meanLuma));
  let entropy = 0;
  for (const frequency of histogram) {
    if (frequency) { const probability = frequency / count; entropy -= probability * Math.log2(probability); }
  }

  // Noise is estimated only in locally smooth samples, away from clipping.
  const residuals: number[] = [];
  let samples = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      samples += 1;
      const p = y * width + x;
      const neighbours = [gray[p - 1], gray[p + 1], gray[p - width], gray[p + width]];
      if (Math.max(...neighbours) - Math.min(...neighbours) > 32 || gray[p] < 10 || gray[p] > 245) continue;
      residuals.push(Math.abs(gray[p] - neighbours.reduce((s, v) => s + v, 0) / 4));
    }
  }
  const noiseConfidence = clamp01(residuals.length / Math.max(1, samples) / 0.4);
  const noiseEstimate = median(residuals) / (0.6745 * Math.sqrt(1.25));
  const filtered = gray.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      filtered[p] = (gray[p] * 4 + (gray[p - 1] + gray[p + 1] + gray[p - width] + gray[p + width]) * 2 +
        gray[p - width - 1] + gray[p - width + 1] + gray[p + width - 1] + gray[p + width + 1]) / 16;
    }
  }
  let lapSum = 0, lapSquared = 0, xx = 0, yy = 0, xy = 0, edgeCount = 0, measured = 0;
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const p = y * width + x;
      const lap = -4 * filtered[p] + filtered[p - 1] + filtered[p + 1] + filtered[p - width] + filtered[p + width];
      const gx = -filtered[p - width - 1] - 2 * filtered[p - 1] - filtered[p + width - 1] +
        filtered[p - width + 1] + 2 * filtered[p + 1] + filtered[p + width + 1];
      const gy = -filtered[p - width - 1] - 2 * filtered[p - width] - filtered[p - width + 1] +
        filtered[p + width - 1] + 2 * filtered[p + width] + filtered[p + width + 1];
      lapSum += lap; lapSquared += lap * lap;
      xx += gx * gx; yy += gy * gy; xy += gx * gy;
      if (gx * gx + gy * gy > Math.max(24 * 24, noiseEstimate * noiseEstimate * 16)) edgeCount += 1;
      measured += 1;
    }
  }
  const divisor = Math.max(1, measured);
  // Filtered Laplacian kernel noise gain for independent pixel noise.
  const laplacianVariance = Math.max(0, lapSquared / divisor - (lapSum / divisor) ** 2 - noiseEstimate ** 2 * 0.40625 * noiseConfidence);
  const tenengrad = Math.max(0, (xx + yy) / divisor - noiseEstimate ** 2 * 5.46875 * noiseConfidence);
  const edgeDensity = edgeCount / divisor;
  const gradientAnisotropy = clamp01(Math.hypot(xx - yy, 2 * xy) / Math.max(1e-9, xx + yy));
  const motionConfidence = clamp01(edgeDensity / 0.15) * clamp01(standardDeviation / 30);
  // A directional scene can give the same cue: this never proves motion blur.
  const motionBlurEstimate = gradientAnisotropy * (1 - clamp01(laplacianVariance / 120));
  const detailConfidence = clamp01(edgeDensity / 0.08) * clamp01(standardDeviation / 24);
  const p5 = percentile(histogram, count, 0.05), p95 = percentile(histogram, count, 0.95);
  const technical: CullingTechnicalMetrics = {
    width, height, medianLuma: percentile(histogram, count, 0.5), p1: percentile(histogram, count, 0.01),
    p5, p95, p99: percentile(histogram, count, 0.99), standardDeviation, entropy, dynamicRange: p95 - p5,
    redClip: channelHighlights[0] / count, greenClip: channelHighlights[1] / count, blueClip: channelHighlights[2] / count,
    redShadowClip: channelShadows[0] / count, greenShadowClip: channelShadows[1] / count, blueShadowClip: channelShadows[2] / count,
    laplacianVariance, tenengrad, edgeDensity, detailConfidence, noiseEstimate, noiseConfidence,
    gradientAnisotropy, motionBlurEstimate, motionConfidence,
  };
  if (multiScale) {
    const coarse = filtered.slice();
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      coarse[p] = (filtered[p] * 4 + 2 * (filtered[p - 1] + filtered[p + 1] + filtered[p - width] + filtered[p + width]) +
        filtered[p - width - 1] + filtered[p - width + 1] + filtered[p + width - 1] + filtered[p + width + 1]) / 16;
    }
    let fine = 0, broad = 0, measuredEdges = 0;
    for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
      const p = y * width + x;
      fine += (filtered[p + 1] - filtered[p - 1]) ** 2 + (filtered[p + width] - filtered[p - width]) ** 2;
      broad += (coarse[p + 1] - coarse[p - 1]) ** 2 + (coarse[p + width] - coarse[p - width]) ** 2;
      measuredEdges++;
    }
    const floor = noiseEstimate ** 2 * noiseConfidence;
    technical.fineEdgeEnergy = Math.max(0, fine / Math.max(1, measuredEdges) - floor * 0.46875);
    technical.coarseEdgeEnergy = Math.max(0, broad / Math.max(1, measuredEdges) - floor * 0.179443359375);
    technical.scaleConsistency = clamp01(technical.coarseEdgeEnergy / Math.max(1, technical.fineEdgeEnergy));
  }
  const signature = withSignature ? createSignature(gray, data, width, height, histogram, standardDeviation) : undefined;
  return {
    hash: signature?.averageHash ?? '', meanLuma,
    sharpnessScore: clamp01((Math.log10(laplacianVariance + 1) / 3 + Math.log10(tenengrad + 1) / 4) / 2),
    // No preference for middle grey exposure: only measurable clipping.
    exposureScore: clamp01(1 - (highlights + shadows) / count * 0.7),
    highlightClipping: highlights / count, shadowClipping: shadows / count,
    contrastScore: clamp01((p95 - p5) / 100), noiseScore: clamp01(1 - noiseEstimate / 32),
    compositionScore: 0, nativeSharpness: 0, technical, signature,
  };
}

export const NATIVE_SAMPLE_SIZE = 384;
interface SamplingPreview { data: Uint8ClampedArray; width: number; height: number }

// A small preview only proposes extra locations. All evidence used for a verdict
// still comes from measured original-resolution pixels, including the noise veto.
function detailLocations(preview: SamplingPreview): { x: number; y: number; strength: number }[] {
  const { data, width, height } = preview;
  validatePreview(data, width, height);
  const gray = new Float32Array(width * height);
  for (let p = 0; p < gray.length; p++) {
    const alpha = data[p * 4 + 3] / 255;
    gray[p] = (data[p * 4] * 0.2126 + data[p * 4 + 1] * 0.7152 + data[p * 4 + 2] * 0.0722) * alpha + 128 * (1 - alpha);
  }
  const cellSize = 16, columns = Math.ceil(width / cellSize), cells = columns * Math.ceil(height / cellSize);
  const energy = new Float64Array(cells), weightedX = new Float64Array(cells), weightedY = new Float64Array(cells);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = y * width + x;
    const lap = -4 * gray[p] + gray[p - 1] + gray[p + 1] + gray[p - width] + gray[p + width];
    const value = lap * lap;
    if (value <= 4) continue;
    const cell = Math.floor(y / cellSize) * columns + Math.floor(x / cellSize);
    energy[cell] += value; weightedX[cell] += x * value; weightedY[cell] += y * value;
  }
  return Array.from(energy, (value, i) => ({
    x: value ? weightedX[i] / value / width : 0,
    y: value ? weightedY[i] / value / height : 0,
    strength: value / (cellSize * cellSize),
  })).filter(point => point.strength > 4).sort((a, b) => b.strength - a.strength || a.y - b.y || a.x - b.x);
}

export function nativeSampleRects(width: number, height: number, preview?: SamplingPreview): { x: number; y: number; width: number; height: number }[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Invalid source dimensions');
  const points = preview ? detailLocations(preview) : [];
  const w = Math.min(width, NATIVE_SAMPLE_SIZE), h = Math.min(height, NATIVE_SAMPLE_SIZE);
  const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
  const add = (cx: number, cy: number) => {
    const x = Math.max(0, Math.min(width - w, Math.round(cx - w / 2)));
    const y = Math.max(0, Math.min(height - h, Math.round(cy - h / 2)));
    rects.set(`${x}:${y}`, { x, y, width: w, height: h });
  };
  for (const fy of [0.25, 0.5, 0.75]) for (const fx of [0.25, 0.5, 0.75]) {
    add(width * fx, height * fy);
  }
  const limit = rects.size + 4;
  for (const point of points) {
    const x = point.x * width, y = point.y * height;
    // Retain the fixed coverage and spend the extra budget outside measured areas.
    if ([...rects.values()].some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)) continue;
    add(x, y);
    if (rects.size >= limit) break;
  }
  return [...rects.values()];
}

export function summarizeNativeSamples(samples: CullingMetrics[], sourceWidth: number, sourceHeight: number,
  fixedSampleCount = samples.length): CullingNativeMetrics {
  if (!Number.isInteger(fixedSampleCount) || fixedSampleCount < 0 || fixedSampleCount > samples.length) throw new Error('Invalid fixed sample count');
  const isInformative = (m: CullingMetrics) => m.technical && m.technical.detailConfidence >= 0.3 &&
    m.technical.tenengrad >= 100 && m.technical.standardDeviation >= 10;
  const informative = samples.filter(isInformative), fixed = samples.slice(0, fixedSampleCount), fixedInformative = fixed.filter(isInformative);
  return {
    sourceWidth, sourceHeight, sampleSize: NATIVE_SAMPLE_SIZE, sampleCount: samples.length,
    fixedSampleCount, fixedInformativeSamples: fixedInformative.length,
    fixedMaxSharpnessScore: Math.max(0, ...fixedInformative.map(m => m.sharpnessScore)),
    fixedMaxLaplacianVariance: Math.max(0, ...fixed.map(m => m.technical?.laplacianVariance ?? 0)),
    informativeSamples: informative.length,
    maxSharpnessScore: Math.max(0, ...informative.map(m => m.sharpnessScore)),
    // The strongest observed detail protects shallow depth of field from a majority of blurred background samples.
    maxLaplacianVariance: Math.max(0, ...samples.map(m => m.technical?.laplacianVariance ?? 0)),
    maxEdgeAcutance: Math.max(0, ...informative.map(m => m.technical!.laplacianVariance / m.technical!.tenengrad)),
    maxNoiseEstimate: Math.max(0, ...samples.map(m => m.technical?.noiseEstimate ?? 0)),
  };
}
