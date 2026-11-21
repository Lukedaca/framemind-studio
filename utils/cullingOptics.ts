// Optical blur evidence: blur radius in source pixels, measured at edges.
// Pure math, no image/network I/O. Across a step edge the gradient profile is a
// Gaussian whose width is the blur; its width is read from the profile's shape, so
// edge contrast and the amount of texture cancel out. Laplacian energy cannot
// tell a plain surface apart from a blurred one. Only straight, isolated steps count:
// thin lines, dots and noise are narrower than the blur that produced them.
import type { CullingOptics, CullingOutputTarget } from '../types';

export const OPTICS_VERSION = 1 as const;
export const OPTICS_TILE = 128;
export const OPTICS_LATTICE = 12; // tiles along the long side
export const OPTICS_SUBJECT_TILES = 24;
export const OPTICS_MASK_SIZE = 320;
export const OPTICS_LEVELS = [1, 2, 4] as const;
export type OpticsLevel = typeof OPTICS_LEVELS[number];
/**
 * Blur at the chosen output size, in output pixels. Calibrated on 24 inspected 1:1
 * crops (Canon 5616 × 3744 JPEG): visibly sharp subjects 0–0.9, visibly soft 1.1+.
 * Lens, demosaicing and JPEG leave sharp photos well above zero.
 */
export const OUTPUT_SHARP = 1.0;
export const OUTPUT_SOFT = 1.4;
/** Fewer measured tiles than this cannot speak for the whole frame. */
export const OPTICS_MIN_TILES = 24;
export const CULLING_TARGETS: CullingOutputTarget[] = ['full', 'print', 'web'];
const TARGET_LONG_SIDE: Record<CullingOutputTarget, number> = { full: Infinity, print: 3600, web: 2048 };

const SMOOTHING = 1; // Gaussian applied before differentiation, in tile pixels
const MARGIN = 8, COARSER_ABOVE = 1.8, COARSE_FLOOR = 0.9, MAX_SIGMA = 20, MIN_GRADIENT = 6, FLAT_DEVIATION = 4;
// An opposite edge this close (in steps across the edge) makes the feature a line or a dot, not a step.
const ISOLATION = 6, OPPOSITE = 0.25;
// Two pixels along the edge must still carry the same edge: rejects corners, dots and noise.
const ALONG_STRENGTH = 0.4, ALONG_DIRECTION = 0.85;
// Gradient orientation bins 0°, 45°, 90°, 135° as pixel steps across the edge.
const STEP_X = [1, 1, 0, -1], STEP_Y = [0, 1, 1, 1];
const TAN_22_5 = Math.tan(Math.PI / 8);
const profile = new Float64Array(5);

function gaussian(sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3), kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) sum += kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}
const KERNEL = gaussian(SMOOTHING);

const reflect = (i: number, n: number) => i < 0 ? -i - 1 : i >= n ? 2 * n - 1 - i : i;

function blur(source: Float32Array, target: Float32Array, scratch: Float32Array, n: number, kernel: Float32Array): void {
  const radius = (kernel.length - 1) / 2;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      let sum = 0;
      if (x >= radius && x < n - radius) for (let i = -radius; i <= radius; i++) sum += source[row + x + i] * kernel[i + radius];
      else for (let i = -radius; i <= radius; i++) sum += source[row + reflect(x + i, n)] * kernel[i + radius];
      scratch[row + x] = sum;
    }
  }
  for (let y = 0; y < n; y++) {
    const inside = y >= radius && y < n - radius;
    for (let x = 0; x < n; x++) {
      let sum = 0;
      if (inside) for (let i = -radius; i <= radius; i++) sum += scratch[(y + i) * n + x] * kernel[i + radius];
      else for (let i = -radius; i <= radius; i++) sum += scratch[reflect(y + i, n) * n + x] * kernel[i + radius];
      target[y * n + x] = sum;
    }
  }
}

/** Linear-interpolated quantile of an ascending array. */
function quantile(sorted: Float32Array, fraction: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * fraction, low = Math.floor(position), high = Math.min(sorted.length - 1, low + 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

// One set of work buffers per tile size; a batch measures thousands of equal tiles.
interface Buffers { smooth: Float32Array; scratch: Float32Array; gx: Float32Array; gy: Float32Array; magnitude: Float32Array; strength: Float32Array; sigma: Float32Array; orientation: Uint8Array; residuals: Float32Array }
const buffers = new Map<number, Buffers>();
function buffersFor(n: number): Buffers {
  let set = buffers.get(n);
  if (!set) {
    const f = () => new Float32Array(n * n);
    set = { smooth: f(), scratch: f(), gx: f(), gy: f(), magnitude: f(), strength: f(), sigma: f(), orientation: new Uint8Array(n * n), residuals: f() };
    buffers.set(n, set);
  }
  return set;
}

function tileNoise(gray: Float32Array, n: number, residuals: Float32Array): number {
  let count = 0;
  for (let y = 1; y < n - 1; y += 2) for (let x = 1; x < n - 1; x += 2) {
    const p = y * n + x, left = gray[p - 1], right = gray[p + 1], top = gray[p - n], bottom = gray[p + n];
    if (Math.max(left, right, top, bottom) - Math.min(left, right, top, bottom) > 32 || gray[p] < 10 || gray[p] > 245) continue;
    residuals[count++] = Math.abs(gray[p] - (left + right + top + bottom) / 4);
  }
  if (count < 50) return 0;
  return quantile(residuals.subarray(0, count).sort(), 0.5) / (0.6745 * Math.sqrt(1.25));
}

/** True when the tile has almost no luminance variation: nothing to measure at any scale. */
export function isFlatTile(gray: Float32Array): boolean {
  let sum = 0, squared = 0;
  for (let i = 0; i < gray.length; i++) { sum += gray[i]; squared += gray[i] * gray[i]; }
  const mean = sum / gray.length;
  return Math.sqrt(Math.max(0, squared / gray.length - mean * mean)) < FLAT_DEVIATION;
}

export interface EdgeBlur {
  edges: number;
  blur: number; // 20th percentile of per-edge blur among the stronger half of edges, in tile pixels
  median: number;
  /** 25th-percentile blur per gradient orientation: 0° (vertical edges), 45°, 90°, 135°. */
  bins: (number | null)[];
  noise: number;
}

/** Blur of one square luminance tile. Null when it has too few isolated edges to measure. */
export function measureEdgeBlur(gray: Float32Array, n: number): EdgeBlur | null {
  if (!Number.isInteger(n) || n < 32 || gray.length !== n * n) throw new Error('Invalid optics tile');
  const { smooth, scratch, gx, gy, magnitude, strength, sigma, orientation, residuals } = buffersFor(n);
  blur(gray, smooth, scratch, n, KERNEL);
  // Hot loop: no closures, allocations, hypot or atan2 per pixel.
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const p = y * n + x, dx = (smooth[p + 1] - smooth[p - 1]) * 0.5, dy = (smooth[p + n] - smooth[p - n]) * 0.5;
    gx[p] = dx; gy[p] = dy; magnitude[p] = Math.sqrt(dx * dx + dy * dy);
  }
  const noise = tileNoise(gray, n, residuals), threshold = Math.max(MIN_GRADIENT, noise * 3);
  const perBin = [0, 0, 0, 0];
  let edges = 0;
  for (let y = MARGIN; y < n - MARGIN; y++) for (let x = MARGIN; x < n - MARGIN; x++) {
    const p = y * n + x, g = magnitude[p];
    if (g < threshold) continue;
    const ux = gx[p] / g, uy = gy[p] / g, ax = ux < 0 ? -ux : ux, ay = uy < 0 ? -uy : uy;
    // Nearest of 0°, 45°, 90°, 135° (tan 22.5° = 0.4142).
    const bin = ay < TAN_22_5 * ax ? 0 : ax < TAN_22_5 * ay ? 2 : ux * uy > 0 ? 1 : 3;
    // Non-maximum suppression across the edge: one sample per edge crossing.
    const sx = STEP_X[bin], sy = STEP_Y[bin], step = sy * n + sx;
    if (g < magnitude[p + step] || g < magnitude[p - step]) continue;
    // Gradient measured along this edge's own direction, two pixels along the edge each way.
    const tangent = sx * n - sy, qa = p + 2 * tangent, qb = p - 2 * tangent;
    const va = gx[qa] * ux + gy[qa] * uy, vb = gx[qb] * ux + gy[qb] * uy;
    if (va < ALONG_STRENGTH * g || va < ALONG_DIRECTION * magnitude[qa] ||
        vb < ALONG_STRENGTH * g || vb < ALONG_DIRECTION * magnitude[qb]) continue;
    let clean = true;
    for (let d = 2, limit = -OPPOSITE * g; d <= ISOLATION; d++) {
      const f = p + d * step, b = p - d * step;
      if (gx[f] * ux + gy[f] * uy < limit || gx[b] * ux + gy[b] * uy < limit) { clean = false; break; }
    }
    if (!clean) continue;
    const m2 = gx[p - 2 * step] * ux + gy[p - 2 * step] * uy, m1 = gx[p - step] * ux + gy[p - step] * uy;
    const p1 = gx[p + step] * ux + gy[p + step] * uy, p2 = gx[p + 2 * step] * ux + gy[p + 2 * step] * uy;
    profile[0] = m2; profile[1] = m1; profile[2] = g; profile[3] = p1; profile[4] = p2;
    // Weighted parabola through the log of the profile: exact for a Gaussian at any sub-pixel offset.
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0, inner = true;
    for (let i = -2; i <= 2; i++) {
      const value = profile[i + 2];
      if (value <= 0.08 * g) { if (i === 1 || i === -1) inner = false; continue; }
      if ((i === 2 && value > p1) || (i === -2 && value > m1)) continue; // rising again: another edge
      const ratio = value / g, weight = ratio * ratio, log = Math.log(value), i2 = i * i;
      s0 += weight; s1 += weight * i; s2 += weight * i2; s3 += weight * i2 * i; s4 += weight * i2 * i2;
      t0 += weight * log; t1 += weight * i * log; t2 += weight * i2 * log;
    }
    if (!inner) continue;
    const determinant = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s2 * s3) + s2 * (s1 * s3 - s2 * s2);
    const curvature = (s0 * (s2 * t2 - t1 * s3) - s1 * (s1 * t2 - t1 * s2) + t0 * (s1 * s3 - s2 * s2)) / determinant;
    // One step across the edge covers this many pixels of the true normal.
    const reach = Math.abs(sx * ux + sy * uy);
    // The central difference is a two-pixel box along each axis; it widens the profile with the smoothing.
    const own = SMOOTHING * SMOOTHING + (ux * ux * ux * ux + uy * uy * uy * uy) / 3;
    sigma[edges] = !(curvature < -1e-4) ? MAX_SIGMA
      : Math.sqrt(Math.min(MAX_SIGMA ** 2, Math.max(0, reach * reach / (-2 * curvature) - own)));
    strength[edges] = g; orientation[edges] = bin; perBin[bin]++; edges++;
  }
  if (edges < Math.max(24, Math.floor(n * n * 0.0025))) return null;
  // Dense fine texture has interfering edges; the stronger half is closer to isolated steps.
  const upperHalf = (bin: number, size: number) => {
    const strengths = new Float32Array(size), values = new Float32Array(size);
    let count = 0;
    for (let i = 0; i < edges; i++) if (bin < 0 || orientation[i] === bin) strengths[count++] = strength[i];
    const cutoff = quantile(strengths.sort(), 0.5);
    count = 0;
    for (let i = 0; i < edges; i++) if ((bin < 0 || orientation[i] === bin) && strength[i] >= cutoff) values[count++] = sigma[i];
    return values.subarray(0, count).sort();
  };
  const sorted = upperHalf(-1, edges);
  return { edges, blur: quantile(sorted, 0.2), median: quantile(sorted, 0.5), noise,
    // Each orientation keeps its own stronger half: motion weakens only the edges across it.
    bins: perBin.map((size, bin) => {
      const values = size ? upperHalf(bin, size) : sorted.subarray(0, 0);
      return values.length >= 12 ? quantile(values, 0.25) : null;
    }) };
}

/** Rec. 709 luminance of an RGBA square, optionally box-averaged by an integer factor. */
export function tileLuma(data: Uint8ClampedArray, n: number, factor: OpticsLevel = 1): Float32Array {
  const side = n * factor;
  if (data.length !== side * side * 4) throw new Error('Invalid optics pixels');
  const gray = new Float32Array(n * n), area = factor * factor;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let sum = 0;
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) {
      const p = ((y * factor + dy) * side + x * factor + dx) * 4, alpha = data[p + 3] / 255;
      sum += (data[p] * 0.2126 + data[p + 1] * 0.7152 + data[p + 2] * 0.0722) * alpha + 128 * (1 - alpha);
    }
    gray[y * n + x] = sum / area;
  }
  return gray;
}

export interface TileBlur { blur: number; edges: number; level: OpticsLevel; noise: number; bins: (number | null)[] }

// Averaging f×f source pixels is a box filter of variance f²/12 source pixels.
const toSource = (value: number, level: OpticsLevel) => level === 1 ? value
  : Math.sqrt(Math.max(0, (value * level) ** 2 - (level * level) / 12));
const atLevel = (measured: EdgeBlur, level: OpticsLevel): TileBlur => ({
  blur: toSource(measured.blur, level), edges: measured.edges, level, noise: measured.noise,
  bins: measured.bins.map(value => value === null ? null : toSource(value, level)),
});

/**
 * Blur of one location in source pixels. Strong blur leaves no steep edges at 1:1,
 * so a larger footprint is averaged down until the edge is steep enough to measure.
 * `read` returns luminance for an n×n tile covering n·level source pixels, or null.
 * Featureless tiles stop after one read; a coarser level is only read for blur.
 */
export function tileBlur(read: (level: OpticsLevel) => Float32Array | null, n = OPTICS_TILE): TileBlur | null {
  const fine = read(1);
  if (!fine || isFlatTile(fine)) return null; // sky, plain walls: nothing to measure at any scale
  const first = measureEdgeBlur(fine, n);
  if (first && first.blur < COARSER_ABOVE) return atLevel(first, 1);
  const fallback = first ? atLevel(first, 1) : null;
  const half = read(2), second = half && measureEdgeBlur(half, n);
  // A coarse reading under its floor is unresolved, not sharp: averaged pixels hide
  // blur below about one coarse pixel. Only 1:1 pixels may report sharpness.
  if (!second || second.blur < COARSE_FLOOR) return fallback;
  if (second.blur < COARSER_ABOVE) return atLevel(second, 2);
  const quarter = read(4), third = quarter && measureEdgeBlur(quarter, n);
  return third && third.blur >= COARSE_FLOOR ? atLevel(third, 4) : atLevel(second, 2);
}

export interface OpticsTilePlan { x: number; y: number; subject: number }
export interface OpticsPlan { tile: number; tiles: OpticsTilePlan[] }

function maskFraction(mask: Uint8Array, x: number, y: number, tile: number, width: number, height: number): number {
  const size = OPTICS_MASK_SIZE;
  const left = Math.max(0, Math.floor(x / width * size)), right = Math.min(size, Math.max(left + 1, Math.floor((x + tile) / width * size)));
  const top = Math.max(0, Math.floor(y / height * size)), bottom = Math.min(size, Math.max(top + 1, Math.floor((y + tile) / height * size)));
  let sum = 0;
  for (let my = top; my < bottom; my++) for (let mx = left; mx < right; mx++) sum += mask[my * size + mx];
  return sum / Math.max(1, (right - left) * (bottom - top));
}

/** Even lattice over the frame plus a finer lattice inside the salient mask. Bounded and deterministic. */
export function opticsPlan(width: number, height: number, mask?: Uint8Array | null): OpticsPlan {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Invalid source dimensions');
  if (mask && mask.length !== OPTICS_MASK_SIZE ** 2) throw new Error('Invalid subject mask');
  const landscape = width >= height;
  const columns = landscape ? OPTICS_LATTICE : Math.max(1, Math.round(OPTICS_LATTICE * width / height));
  const rows = landscape ? Math.max(1, Math.round(OPTICS_LATTICE * height / width)) : OPTICS_LATTICE;
  const tile = Math.min(OPTICS_TILE, Math.floor(width / columns), Math.floor(height / rows));
  if (tile < 64) return { tile: 0, tiles: [] }; // Too small for a lattice; the preview metrics already see every pixel.
  const place = (cx: number, cy: number) => ({
    x: Math.max(0, Math.min(width - tile, Math.round(cx - tile / 2))),
    y: Math.max(0, Math.min(height - tile, Math.round(cy - tile / 2))),
  });
  const tiles: OpticsTilePlan[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const position = place((i + 0.5) * width / columns, (j + 0.5) * height / rows);
    tiles.push({ ...position, subject: mask ? maskFraction(mask, position.x, position.y, tile, width, height) : 0 });
  }
  if (mask) {
    const inside: OpticsTilePlan[] = [];
    for (let j = 0; j < rows * 2; j++) for (let i = 0; i < columns * 2; i++) {
      const position = place((i + 0.5) * width / (columns * 2), (j + 0.5) * height / (rows * 2));
      const subject = maskFraction(mask, position.x, position.y, tile, width, height);
      if (subject >= 0.6) inside.push({ ...position, subject });
    }
    inside.sort((a, b) => b.subject - a.subject || a.y - b.y || a.x - b.x);
    tiles.push(...inside.slice(0, OPTICS_SUBJECT_TILES));
  }
  return { tile, tiles };
}

export interface MeasuredTile extends OpticsTilePlan, TileBlur {}

// The second sharpest of at least three tiles: one spurious tile (a printed logo,
// a stray sharp edge) or one outlier (a blurred limb inside the mask) cannot decide.
const sharpest = (values: number[]) => values.length >= 3 ? [...values].sort((a, b) => a - b)[1] : undefined;

function direction(tiles: MeasuredTile[]): number[] | undefined {
  const pooled = [0, 1, 2, 3].map(bin => {
    const values = tiles.flatMap(tile => tile.bins[bin] ?? []).sort((a, b) => a - b);
    return values.length >= 3 ? quantile(Float32Array.from(values), 0.25) : null;
  });
  return pooled.every(value => value !== null) ? pooled as number[] : undefined;
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Subject = inside the salient mask, background = clearly outside. The second sharpest tile of each speaks for it. */
export function summarizeOptics(tiles: MeasuredTile[], width: number, height: number, tile: number, planned: number): CullingOptics {
  const subject = tiles.filter(t => t.subject >= 0.5), background = tiles.filter(t => t.subject <= 0.05);
  const focus = tiles.length ? tiles.reduce((best, t) => t.blur < best.blur || (t.blur === best.blur && t.subject > best.subject) ? t : best) : undefined;
  return {
    version: OPTICS_VERSION, sourceWidth: width, sourceHeight: height, tile, planned,
    map: tiles.flatMap(t => [round((t.x + tile / 2) / width, 4), round((t.y + tile / 2) / height, 4), round(t.blur, 2), round(t.subject, 2)]),
    subjectTiles: subject.length, backgroundTiles: background.length,
    subjectBlur: sharpest(subject.map(t => t.blur)), backgroundBlur: sharpest(background.map(t => t.blur)),
    frameBlur: sharpest(tiles.map(t => t.blur)),
    noise: tiles.length ? quantile(Float32Array.from(tiles.map(t => t.noise)).sort(), 0.5) : 0,
    subjectDirection: direction(subject), backgroundDirection: direction(background),
    focus: focus ? { x: round((focus.x + tile / 2) / width, 4), y: round((focus.y + tile / 2) / height, 4), subject: round(focus.subject, 2) } : undefined,
  };
}

export function validOptics(optics: CullingOptics | undefined): boolean {
  if (!optics) return true;
  const finite = (value: number | undefined) => value === undefined || (Number.isFinite(value) && value >= 0);
  return optics.version === OPTICS_VERSION && optics.sourceWidth > 0 && optics.sourceHeight > 0 &&
    Array.isArray(optics.map) && optics.map.length % 4 === 0 && optics.map.every(value => Number.isFinite(value) && value >= 0) &&
    [optics.subjectBlur, optics.backgroundBlur, optics.frameBlur, optics.noise, optics.tile, optics.planned, optics.subjectTiles, optics.backgroundTiles].every(finite) &&
    [optics.subjectDirection, optics.backgroundDirection].every(d => d === undefined || (d.length === 4 && d.every(finite)));
}

/** Fraction by which the photo shrinks for the chosen delivery size. Never enlarges. */
export function outputScale(target: CullingOutputTarget, width: number, height: number): number {
  return Math.min(1, TARGET_LONG_SIDE[target] / Math.max(1, width, height));
}

/** Longest side, in pixels, at which this blur still reads as sharp. */
export function sharpUpTo(blur: number, width: number, height: number): number {
  const longSide = Math.max(width, height);
  return blur <= OUTPUT_SHARP ? longSide : Math.round(longSide * OUTPUT_SHARP / blur);
}

/** 1 up to 0.6 output pixels, 0.75 at the sharp limit, 0.5 at the soft limit, 0 at 2.2. */
export const opticalSharpness = (outputBlur: number) => Math.min(1, Math.max(0, 1 - Math.max(0, outputBlur - 0.6) / 1.6));

/** Enough measured tiles that the summary describes the frame, not a few lucky patches. */
export const reliableOptics = (optics: CullingOptics | undefined): optics is CullingOptics =>
  !!optics && validOptics(optics) && optics.map.length / 4 >= OPTICS_MIN_TILES && optics.frameBlur !== undefined;

/** Sharpest single measured tile anywhere, in source pixels. */
export function sharpestTile(optics: CullingOptics): number {
  let best = Infinity;
  for (let i = 2; i < optics.map.length; i += 4) best = Math.min(best, optics.map[i]);
  return best;
}

/** Count of measured tiles at or below a blur limit in output pixels. */
export function sharpTileCount(optics: CullingOptics, target: CullingOutputTarget = 'full', limit = OUTPUT_SHARP): number {
  const scale = outputScale(target, optics.sourceWidth, optics.sourceHeight);
  let count = 0;
  for (let i = 2; i < optics.map.length; i += 4) if (optics.map[i] * scale <= limit) count++;
  return count;
}

export interface OpticalMotionSummary {
  maxBlur: number;
  minBlur: number;
  ratio: number;
  source: 'subject' | 'frame';
}

/**
 * Directional blur anisotropy from the 4 orientation bins (0°, 45°, 90°, 135°).
 * Linear motion blur leaves edges parallel to the motion sharp while smearing
 * perpendicular edges; a single scalar percentile across all orientations hides it.
 */
export function opticalMotionBlur(optics: CullingOptics | undefined, target: CullingOutputTarget = 'full'): OpticalMotionSummary | undefined {
  if (!optics || !validOptics(optics)) return undefined;
  const bins = optics.subjectDirection ?? (optics.subjectTiles === 0 ? optics.backgroundDirection : undefined);
  if (!bins || bins.length !== 4) return undefined;
  const scale = outputScale(target, optics.sourceWidth, optics.sourceHeight);
  const maxBlur = Math.max(...bins) * scale;
  const minBlur = Math.min(...bins) * scale;
  return {
    maxBlur,
    minBlur,
    ratio: maxBlur / Math.max(0.35, minBlur),
    source: optics.subjectDirection ? 'subject' : 'frame',
  };
}

/** Share of measured background tiles that are sharp at this delivery size. */
export function sharpBackgroundShare(optics: CullingOptics, target: CullingOutputTarget = 'full'): number {
  const scale = outputScale(target, optics.sourceWidth, optics.sourceHeight);
  let background = 0, sharp = 0;
  for (let i = 0; i < optics.map.length; i += 4) {
    if (optics.map[i + 3] > 0.05) continue;
    background++;
    if (optics.map[i + 2] * scale <= OUTPUT_SHARP) sharp++;
  }
  return background ? sharp / background : 0;
}

export type OpticsKind = 'subject-sharp' | 'focus-elsewhere' | 'subject-soft' | 'frame-sharp' | 'frame-soft' | 'frame-blurred' | 'unmeasured';
export interface OpticsVerdict {
  kind: OpticsKind;
  /** Blur that speaks for the photo (subject when found, else the sharpest area), in output pixels. */
  outputBlur?: number;
  sourceBlur?: number;
  sharpUpTo?: number;
}

/**
 * What the measured blur means for one delivery size. A soft salient object next to a
 * sharper area is reported, never judged: the model's object is not proof of the intended subject.
 */
export function opticsVerdict(optics: CullingOptics | undefined, target: CullingOutputTarget = 'full'): OpticsVerdict {
  if (!optics || !validOptics(optics) || optics.frameBlur === undefined) return { kind: 'unmeasured' };
  const scale = outputScale(target, optics.sourceWidth, optics.sourceHeight);
  const frame = optics.frameBlur * scale;
  const describe = (kind: OpticsKind, blur: number): OpticsVerdict => ({ kind, outputBlur: blur * scale, sourceBlur: blur,
    sharpUpTo: sharpUpTo(blur, optics.sourceWidth, optics.sourceHeight) });
  if (optics.subjectBlur !== undefined) {
    const subject = optics.subjectBlur * scale;
    if (subject <= OUTPUT_SHARP) return describe('subject-sharp', optics.subjectBlur);
    if (frame <= OUTPUT_SHARP) return describe('focus-elsewhere', optics.subjectBlur);
    return describe(frame > OUTPUT_SOFT ? 'frame-blurred' : 'subject-soft', optics.subjectBlur);
  }
  return describe(frame <= OUTPUT_SHARP ? 'frame-sharp' : frame > OUTPUT_SOFT ? 'frame-blurred' : 'frame-soft', optics.frameBlur);
}
