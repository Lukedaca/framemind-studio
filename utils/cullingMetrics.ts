// Pure measurements on a bounded preview. No content/face/subject inference.
import type { CullingMetrics, CullingTechnicalMetrics } from '../types';
import { createSignature } from './cullingSimilarity';

export const PREVIEW_MAX_SIDE = 768;
export const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

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

export function readMetrics(data: Uint8ClampedArray, width: number, height: number): CullingMetrics {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > PREVIEW_MAX_SIDE || height > PREVIEW_MAX_SIDE || data.length !== width * height * 4) {
    throw new Error('Invalid or unbounded culling preview');
  }
  const count = width * height;
  const gray = new Float32Array(count);
  const histogram = new Uint32Array(256);
  const channelHighlights = [0, 0, 0], channelShadows = [0, 0, 0];
  let sum = 0, sumSquared = 0, highlights = 0, shadows = 0;
  for (let p = 0; p < count; p += 1) {
    const alpha = data[p * 4 + 3] / 255;
    const rgb = [0, 1, 2].map(c => data[p * 4 + c] * alpha + 128 * (1 - alpha));
    const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    gray[p] = luma; histogram[Math.round(luma)] += 1;
    sum += luma; sumSquared += luma * luma;
    if (luma >= 250) highlights += 1;
    if (luma <= 5) shadows += 1;
    for (let c = 0; c < 3; c += 1) {
      if (rgb[c] >= 250) channelHighlights[c] += 1;
      if (rgb[c] <= 5) channelShadows[c] += 1;
    }
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
  const signature = createSignature(gray, data, width, height, histogram, standardDeviation);
  return {
    hash: signature.averageHash, meanLuma,
    sharpnessScore: clamp01((Math.log10(laplacianVariance + 1) / 3 + Math.log10(tenengrad + 1) / 4) / 2),
    // No preference for middle grey exposure: only measurable clipping.
    exposureScore: clamp01(1 - (highlights + shadows) / count * 0.7),
    highlightClipping: highlights / count, shadowClipping: shadows / count,
    contrastScore: clamp01((p95 - p5) / 100), noiseScore: clamp01(1 - noiseEstimate / 32),
    compositionScore: 0, nativeSharpness: 0, technical, signature,
  };
}
