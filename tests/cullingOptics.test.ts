import { describe, expect, it } from 'vitest';
import { measureEdgeBlur, opticsPlan, opticsVerdict, outputScale, sharpUpTo, summarizeOptics, tileBlur, tileLuma, validOptics,
  OPTICS_MASK_SIZE, OPTICS_TILE, type MeasuredTile, type OpticsLevel } from '../utils/cullingOptics';

const N = OPTICS_TILE;

/** Bars at four orientations (one per quadrant), blurred by a known Gaussian, optional horizontal motion and noise. */
function scene(size: number, sigma: number, options: { period?: number; contrast?: number; motion?: number; noise?: number } = {}): Float32Array {
  const { period = 36, contrast = 80, motion = 0, noise = 0 } = options;
  const pad = Math.ceil(sigma * 4) + motion + 2, full = size + pad * 2;
  let image = new Float32Array(full * full);
  for (let y = 0; y < full; y++) for (let x = 0; x < full; x++) {
    const quadrant = (x < full / 2 ? 0 : 1) + (y < full / 2 ? 0 : 2), angle = quadrant * Math.PI / 4;
    const u = x * Math.cos(angle) + y * Math.sin(angle);
    image[y * full + x] = 128 + (Math.floor(u / (period / 2)) % 2 === 0 ? -contrast / 2 : contrast / 2);
  }
  const convolve = (kernel: number[], horizontal: boolean) => {
    const radius = (kernel.length - 1) / 2, out = new Float32Array(full * full);
    for (let y = 0; y < full; y++) for (let x = 0; x < full; x++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) {
        const xx = Math.min(full - 1, Math.max(0, horizontal ? x + i : x)), yy = Math.min(full - 1, Math.max(0, horizontal ? y : y + i));
        sum += image[yy * full + xx] * kernel[i + radius];
      }
      out[y * full + x] = sum;
    }
    image = out;
  };
  if (sigma > 0) {
    const radius = Math.ceil(sigma * 4), kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
    const total = kernel.reduce((a, b) => a + b, 0), normalized = kernel.map(v => v / total);
    convolve(normalized, true); convolve(normalized, false);
  }
  if (motion > 1) convolve(Array.from({ length: motion }, () => 1 / motion), true);
  let seed = 12345;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gaussian = noise ? Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random()) * noise : 0;
    out[y * size + x] = Math.min(255, Math.max(0, image[(y + pad) * full + x + pad] + gaussian));
  }
  return out;
}

/** The centred n·level footprint of a large scene, box-averaged like the worker does. */
const pyramid = (large: Float32Array, size: number) => (level: OpticsLevel) => {
  const side = N * level, offset = Math.floor((size - side) / 2), out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let sum = 0;
    for (let dy = 0; dy < level; dy++) for (let dx = 0; dx < level; dx++) sum += large[(offset + y * level + dy) * size + offset + x * level + dx];
    out[y * N + x] = sum / (level * level);
  }
  return out;
};

describe('edge blur in pixels', () => {
  it('reads unblurred steps as sharp and recovers a known Gaussian blur', () => {
    expect(measureEdgeBlur(scene(N, 0), N)!.blur).toBeLessThan(0.35);
    expect(measureEdgeBlur(scene(N, 1), N)!.blur).toBeGreaterThan(0.75);
    expect(measureEdgeBlur(scene(N, 1), N)!.blur).toBeLessThan(1.3);
    expect(measureEdgeBlur(scene(N, 1.5), N)!.blur).toBeGreaterThan(1.2);
    expect(measureEdgeBlur(scene(N, 1.5), N)!.blur).toBeLessThan(1.9);
  });

  it('does not depend on edge contrast or on how much texture the tile has', () => {
    const reference = measureEdgeBlur(scene(N, 1.2), N)!.blur;
    expect(Math.abs(measureEdgeBlur(scene(N, 1.2, { contrast: 30 }), N)!.blur - reference)).toBeLessThan(0.2);
    expect(Math.abs(measureEdgeBlur(scene(N, 1.2, { contrast: 160 }), N)!.blur - reference)).toBeLessThan(0.2);
    expect(Math.abs(measureEdgeBlur(scene(N, 1.2, { period: 20 }), N)!.blur - reference)).toBeLessThan(0.3);
    expect(Math.abs(measureEdgeBlur(scene(N, 1.2, { period: 60 }), N)!.blur - reference)).toBeLessThan(0.3);
  });

  it('stays usable with moderate sensor noise and refuses featureless tiles', () => {
    const noisy = measureEdgeBlur(scene(N, 1.2, { noise: 3 }), N)!;
    expect(noisy.blur).toBeGreaterThan(0.8);
    expect(noisy.blur).toBeLessThan(1.6);
    expect(measureEdgeBlur(new Float32Array(N * N).fill(120), N)).toBeNull();
    const flatNoise = scene(N, 0, { contrast: 0, noise: 4 });
    expect(measureEdgeBlur(flatNoise, N)).toBeNull();
  });

  it('separates horizontal motion from the unaffected orientation', () => {
    const moved = measureEdgeBlur(scene(N * 2, 0.6, { motion: 9 }), N * 2)!;
    expect(moved.bins[0]).not.toBeNull();
    expect(moved.bins[2]).not.toBeNull();
    expect(moved.bins[0]!).toBeGreaterThan(moved.bins[2]! * 2);
  });

  it('measures strong blur on a coarser level, in source pixels', () => {
    const size = N * 4;
    for (const sigma of [0.8, 3, 6]) {
      const measured = tileBlur(pyramid(scene(size, sigma, { period: 96 }), size))!;
      expect(measured.blur).toBeGreaterThan(sigma * 0.7);
      expect(measured.blur).toBeLessThan(sigma * 1.35);
    }
    expect(tileBlur(pyramid(scene(size, 0.8, { period: 96 }), size))!.level).toBe(1);
    expect(tileBlur(pyramid(scene(size, 6, { period: 96 }), size))!.level).toBeGreaterThan(1);
    expect(tileBlur(() => null)).toBeNull();
  });

  it('never reports sharpness from averaged pixels', () => {
    // Faint, mildly blurred edges: too weak at 1:1, and one coarse pixel hides their blur.
    const size = N * 4;
    for (const contrast of [16, 18, 22, 26]) {
      const measured = tileBlur(pyramid(scene(size, 1.2, { contrast, period: 96 }), size));
      expect(measured === null || measured.level === 1 || measured.blur >= 1.5).toBe(true);
    }
  });

  it('reads a featureless tile once and never widens it', () => {
    let reads = 0;
    expect(tileBlur(() => { reads++; return new Float32Array(N * N).fill(90); })).toBeNull();
    expect(reads).toBe(1);
  });

  it('averages RGBA pixels into luminance tiles', () => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) data.set(i % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], i * 4);
    const gray = tileLuma(data, 32, 2);
    expect(gray).toHaveLength(32 * 32);
    expect(gray[0]).toBeCloseTo(127.5, 1);
    expect(() => tileLuma(data, 32, 4)).toThrow();
  });
});

describe('sampling plan', () => {
  it('covers the frame evenly in either orientation and skips tiny images', () => {
    const landscape = opticsPlan(5616, 3744), portrait = opticsPlan(3744, 5616);
    expect(landscape.tile).toBe(128);
    expect(landscape.tiles).toHaveLength(96);
    expect(portrait.tiles).toHaveLength(96);
    expect(landscape.tiles.every(t => t.x >= 0 && t.y >= 0 && t.x + 128 <= 5616 && t.y + 128 <= 3744 && t.subject === 0)).toBe(true);
    expect(opticsPlan(5616, 3744)).toEqual(landscape);
    expect(opticsPlan(500, 400).tiles).toHaveLength(0);
  });

  it('adds a bounded finer lattice inside the salient mask', () => {
    const mask = new Uint8Array(OPTICS_MASK_SIZE ** 2);
    for (let y = 100; y < 220; y++) for (let x = 120; x < 200; x++) mask[y * OPTICS_MASK_SIZE + x] = 1;
    const plan = opticsPlan(5616, 3744, mask);
    expect(plan.tiles.length).toBeGreaterThan(96);
    expect(plan.tiles.length).toBeLessThanOrEqual(120);
    expect(plan.tiles.slice(96).every(t => t.subject >= 0.6)).toBe(true);
    expect(() => opticsPlan(5616, 3744, new Uint8Array(10))).toThrow();
  });
});

describe('what the blur means for a delivery size', () => {
  const tile = (x: number, y: number, blur: number, subject: number): MeasuredTile =>
    ({ x, y, blur, subject, edges: 200, level: 1, noise: 0.5, bins: [blur, blur, blur, blur] });
  const frame = (subjectBlur: number, backgroundBlur: number) => summarizeOptics([
    ...[0, 1, 2, 3].map(i => tile(2000 + i * 128, 1500, subjectBlur, 1)),
    ...[0, 1, 2, 3].map(i => tile(200 + i * 128, 300, backgroundBlur, 0)),
  ], 5616, 3744, 128, 96);

  it('summarizes subject and background from their second sharpest tile', () => {
    const lucky = summarizeOptics([0.1, 1.6, 1.7, 1.8].map((blur, i) => tile(2000 + i * 128, 1500, blur, 1)), 5616, 3744, 128, 96);
    expect(lucky.subjectBlur).toBeCloseTo(1.6); // one spurious sharp tile does not decide
    const optics = frame(0.2, 2.4);
    expect(optics.subjectBlur).toBeCloseTo(0.2);
    expect(optics.backgroundBlur).toBeCloseTo(2.4);
    expect(optics.frameBlur).toBeCloseTo(0.2);
    expect(optics.focus?.subject).toBe(1);
    expect(optics.map).toHaveLength(8 * 4);
    expect(validOptics(optics)).toBe(true);
    expect(validOptics({ ...optics, map: [1, 2, 3] })).toBe(false);
  });

  it('reports a soft salient object beside a sharper area without judging it', () => {
    expect(opticsVerdict(frame(0.8, 2.4)).kind).toBe('subject-sharp');
    expect(opticsVerdict(frame(1.6, 0.4)).kind).toBe('focus-elsewhere');
    expect(opticsVerdict(frame(1.2, 1.3)).kind).toBe('subject-soft');
    expect(opticsVerdict(frame(1.8, 2.0)).kind).toBe('frame-blurred');
    expect(opticsVerdict(undefined).kind).toBe('unmeasured');
  });

  it('judges the same blur against the size the photo is delivered at', () => {
    const optics = frame(2.0, 2.2);
    expect(outputScale('web', 5616, 3744)).toBeCloseTo(2048 / 5616);
    expect(outputScale('web', 1600, 1200)).toBe(1);
    expect(opticsVerdict(optics, 'full').kind).toBe('frame-blurred');
    expect(opticsVerdict(optics, 'print').kind).toBe('subject-soft'); // 2.0 × 3600/5616 = 1.28 px
    expect(opticsVerdict(optics, 'web').kind).toBe('subject-sharp'); // 0.73 px
    expect(opticsVerdict(optics, 'web').sharpUpTo).toBe(2808);
    expect(sharpUpTo(2.0, 5616, 3744)).toBe(2808);
    expect(sharpUpTo(0.9, 5616, 3744)).toBe(5616);
  });

  it('uses the sharpest area when no salient object was found', () => {
    const none = summarizeOptics([0, 1, 2, 3].map(i => tile(i * 400, 300, 0.3, 0)), 5616, 3744, 128, 96);
    expect(none.subjectBlur).toBeUndefined();
    expect(opticsVerdict(none).kind).toBe('frame-sharp');
    const soft = summarizeOptics([0, 1, 2, 3].map(i => tile(i * 400, 300, 2.5, 0)), 5616, 3744, 128, 96);
    expect(opticsVerdict(soft).kind).toBe('frame-blurred');
    expect(opticsVerdict(summarizeOptics([], 5616, 3744, 128, 96)).kind).toBe('unmeasured');
  });
});
