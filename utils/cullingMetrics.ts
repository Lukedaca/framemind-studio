// Čisté pixelové heuristiky pro AI culling — žádný DOM, žádné globály.
// Importuje je culling worker (běžná cesta mimo main thread) i synchronní
// fallback v cullingEngine. Jediný zdroj pravdy, aby se skóre nikdy nerozešla.
// Prahy jsou kalibrované na dekód s delší stranou ~420 px — neměnit jedno bez druhého.

import type { CullingMetrics } from '../types';

export function readMetrics(data: Uint8ClampedArray, width: number, height: number): CullingMetrics {
  const total = width * height;
  const gray = new Float32Array(total);
  const saturation = new Float32Array(total);
  let sum = 0;
  let sumSq = 0;
  let highlights = 0;
  let shadows = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const red = data[i];
    const green = data[i + 1];
    const blue = data[i + 2];
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const sat = high === 0 ? 0 : (high - low) / high;

    gray[p] = luma;
    saturation[p] = sat;
    sum += luma;
    sumSq += luma * luma;
    if (luma > 246) highlights += 1;
    if (luma < 10) shadows += 1;
  }

  const meanLuma = sum / total;
  const variance = Math.max(0, sumSq / total - meanLuma * meanLuma);
  const standardDeviation = Math.sqrt(variance);
  const highlightClipping = highlights / total;
  const shadowClipping = shadows / total;
  const laplacianVariance = computeLaplacianVariance(gray, width, height);
  const noiseEstimate = computeNoiseEstimate(gray, width, height);
  const composition = computeComposition(gray, saturation, width, height);
  const hash = averageHash(gray, width, height);

  const clippingPenalty = highlightClipping * 1.4 + shadowClipping * 1.2;
  const sharpnessScore = clamp01((Math.log10(laplacianVariance + 1) - 1.25) / 1.6);
  const exposureScore = clamp01(1 - Math.abs(meanLuma - 128) / 165 - clippingPenalty);
  const contrastScore = clamp01((standardDeviation - 16) / 64);
  const noiseScore = clamp01(1 - noiseEstimate / 46);

  return {
    hash,
    meanLuma,
    sharpnessScore,
    exposureScore,
    highlightClipping,
    shadowClipping,
    contrastScore,
    noiseScore,
    compositionScore: composition.score,
  };
}

function computeLaplacianVariance(gray: Float32Array, width: number, height: number): number {
  const values: number[] = [];
  let sum = 0;
  let sumSq = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value =
        -4 * gray[index] +
        gray[index - 1] +
        gray[index + 1] +
        gray[index - width] +
        gray[index + width];
      values.push(value);
      sum += value;
    }
  }

  const mean = sum / Math.max(values.length, 1);
  for (const value of values) {
    const diff = value - mean;
    sumSq += diff * diff;
  }

  return sumSq / Math.max(values.length, 1);
}

function computeNoiseEstimate(gray: Float32Array, width: number, height: number): number {
  let total = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const index = y * width + x;
      const localMean =
        (gray[index - 1] + gray[index + 1] + gray[index - width] + gray[index + width]) / 4;
      total += Math.abs(gray[index] - localMean);
      count += 1;
    }
  }

  return total / Math.max(count, 1);
}

function computeComposition(
  gray: Float32Array,
  saturation: Float32Array,
  width: number,
  height: number
): { score: number } {
  let weightSum = 0;
  let xSum = 0;
  let ySum = 0;
  let borderWeight = 0;
  let leftWeight = 0;
  let rightWeight = 0;
  let topWeight = 0;
  let bottomWeight = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx =
        -gray[index - width - 1] -
        2 * gray[index - 1] -
        gray[index + width - 1] +
        gray[index - width + 1] +
        2 * gray[index + 1] +
        gray[index + width + 1];
      const gy =
        -gray[index - width - 1] -
        2 * gray[index - width] -
        gray[index - width + 1] +
        gray[index + width - 1] +
        2 * gray[index + width] +
        gray[index + width + 1];
      const edge = Math.sqrt(gx * gx + gy * gy);
      const subject = edge * (0.76 + saturation[index] * 0.4);
      if (subject < 12) continue;

      weightSum += subject;
      xSum += x * subject;
      ySum += y * subject;
      if (x < width * 0.1 || x > width * 0.9 || y < height * 0.1 || y > height * 0.9) {
        borderWeight += subject;
      }
      if (x < width / 2) leftWeight += subject;
      else rightWeight += subject;
      if (y < height / 2) topWeight += subject;
      else bottomWeight += subject;
    }
  }

  if (weightSum <= 0) return { score: 0.34 };

  const cx = xSum / weightSum;
  const cy = ySum / weightSum;
  const thirds: [number, number][] = [
    [width / 3, height / 3],
    [(width * 2) / 3, height / 3],
    [width / 3, (height * 2) / 3],
    [(width * 2) / 3, (height * 2) / 3],
  ];
  const nearestThird = Math.min(...thirds.map(([tx, ty]) => Math.hypot(cx - tx, cy - ty)));
  const diagonal = Math.hypot(width, height);
  const thirdScore = clamp01(1 - nearestThird / (diagonal * 0.24));
  const centerOffset = Math.hypot(cx - width / 2, cy - height / 2) / diagonal;
  const centerScore = clamp01(1 - centerOffset / 0.42);
  const subjectStrength = clamp01(weightSum / (width * height * 34));
  const balance =
    1 -
    clamp01(
      (Math.abs(leftWeight - rightWeight) + Math.abs(topWeight - bottomWeight)) /
        Math.max(weightSum * 1.8, 1)
    );
  const borderPenalty = clamp01(borderWeight / weightSum) * 0.26;

  return {
    score: clamp01(
      thirdScore * 0.4 +
        centerScore * 0.18 +
        subjectStrength * 0.24 +
        balance * 0.18 -
        borderPenalty
    ),
  };
}

// 16×16 average hash pro detekci duplicit/sérií — porovnává se přes XOR+popcount.
function averageHash(gray: Float32Array, width: number, height: number): string {
  const size = 16;
  const cells: number[] = [];
  let sum = 0;

  for (let gy = 0; gy < size; gy += 1) {
    for (let gx = 0; gx < size; gx += 1) {
      const startX = Math.floor((gx / size) * width);
      const endX = Math.max(startX + 1, Math.floor(((gx + 1) / size) * width));
      const startY = Math.floor((gy / size) * height);
      const endY = Math.max(startY + 1, Math.floor(((gy + 1) / size) * height));
      let local = 0;
      let count = 0;

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          local += gray[y * width + x];
          count += 1;
        }
      }

      const value = local / Math.max(count, 1);
      cells.push(value);
      sum += value;
    }
  }

  const mean = sum / cells.length;
  return cells.map((value) => (value >= mean ? '1' : '0')).join('');
}

export function hashToWords(hash: string): Uint32Array {
  const words = new Uint32Array(8);
  const len = Math.min(hash.length, 256);
  for (let i = 0; i < len; i += 1) {
    if (hash[i] === '1') words[i >> 5] |= 1 << (i & 31);
  }
  return words;
}

export function hammingWords(a: Uint32Array, b: Uint32Array): number {
  let distance = 0;
  for (let i = 0; i < 8; i += 1) {
    let x = a[i] ^ b[i];
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    x = (x + (x >> 4)) & 0x0f0f0f0f;
    distance += (x * 0x01010101) >> 24;
  }
  return distance;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
