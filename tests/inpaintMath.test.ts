import { describe, expect, it } from 'vitest';
import {
  MODEL_SIZE,
  computeInpaintCrop,
  dilateMask,
  maskBoundingBox,
  planarToRgba,
  rgbaToPlanar,
} from '../utils/inpaintMath';

describe('maskBoundingBox', () => {
  it('vrátí null pro prázdnou masku', () => {
    expect(maskBoundingBox(new Uint8Array(16), 4, 4)).toBeNull();
  });

  it('najde obdélník kolem všech bodů', () => {
    const w = 10;
    const alpha = new Uint8Array(w * 10);
    alpha[2 * w + 3] = 255;
    alpha[7 * w + 8] = 40;
    expect(maskBoundingBox(alpha, w, 10)).toEqual({ x: 3, y: 2, width: 6, height: 6 });
  });

  it('respektuje práh', () => {
    const alpha = new Uint8Array(4);
    alpha[1] = 5;
    expect(maskBoundingBox(alpha, 2, 2, 10)).toBeNull();
  });
});

describe('computeInpaintCrop', () => {
  it('malá maska dostane aspoň 512 px čtverec vycentrovaný na ní', () => {
    const crop = computeInpaintCrop({ x: 1000, y: 1000, width: 40, height: 20 }, 4000, 3000);
    expect(crop.width).toBe(MODEL_SIZE);
    expect(crop.height).toBe(MODEL_SIZE);
    expect(crop.x + crop.width / 2).toBeCloseTo(1020, 0);
    expect(crop.y + crop.height / 2).toBeCloseTo(1010, 0);
  });

  it('velká maska dostane okolí pro kontext', () => {
    const crop = computeInpaintCrop({ x: 500, y: 500, width: 600, height: 300 }, 6000, 4000);
    expect(crop.width).toBe(1200);
    expect(crop.x).toBeLessThanOrEqual(500);
    expect(crop.x + crop.width).toBeGreaterThanOrEqual(1100);
  });

  it('u okraje se výřez posune, nezmenší', () => {
    const crop = computeInpaintCrop({ x: 0, y: 0, width: 30, height: 30 }, 4000, 3000);
    expect(crop).toEqual({ x: 0, y: 0, width: 512, height: 512 });
    const far = computeInpaintCrop({ x: 3980, y: 2980, width: 20, height: 20 }, 4000, 3000);
    expect(far.x + far.width).toBe(4000);
    expect(far.y + far.height).toBe(3000);
  });

  it('malá fotka: výřez nepřeteče', () => {
    const crop = computeInpaintCrop({ x: 10, y: 10, width: 20, height: 20 }, 300, 200);
    expect(crop.width).toBe(200);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(300);
  });

  it('maska delší než kratší strana fotky: vezme celou fotku', () => {
    const crop = computeInpaintCrop({ x: 100, y: 1000, width: 3500, height: 60 }, 4000, 3000);
    expect(crop).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
  });

  it('výřez vždy obsahuje celou masku', () => {
    const cases = [
      { x: 10, y: 2900, width: 700, height: 90 },
      { x: 3500, y: 100, width: 480, height: 480 },
      { x: 1200, y: 800, width: 1400, height: 1000 },
    ];
    for (const m of cases) {
      const c = computeInpaintCrop(m, 4000, 3000);
      expect(c.x).toBeLessThanOrEqual(m.x);
      expect(c.y).toBeLessThanOrEqual(m.y);
      expect(c.x + c.width).toBeGreaterThanOrEqual(m.x + m.width);
      expect(c.y + c.height).toBeGreaterThanOrEqual(m.y + m.height);
    }
  });
});

describe('dilateMask', () => {
  it('rozšíří jeden bod na čtverec o poloměru r', () => {
    const w = 9;
    const mask = new Uint8Array(w * w);
    mask[4 * w + 4] = 1;
    const out = dilateMask(mask, w, w, 2);
    let count = 0;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const inside = Math.abs(x - 4) <= 2 && Math.abs(y - 4) <= 2;
        expect(out[y * w + x]).toBe(inside ? 1 : 0);
        if (out[y * w + x]) count++;
      }
    }
    expect(count).toBe(25);
  });

  it('nesahá mimo hranice a poloměr 0 vrací kopii', () => {
    const mask = new Uint8Array([1, 0, 0, 0]);
    expect(Array.from(dilateMask(mask, 2, 2, 5))).toEqual([1, 1, 1, 1]);
    const copy = dilateMask(mask, 2, 2, 0);
    expect(Array.from(copy)).toEqual([1, 0, 0, 0]);
    expect(copy).not.toBe(mask);
  });
});

describe('rgbaToPlanar / planarToRgba', () => {
  it('jsou navzájem inverzní (kromě alfy)', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128]);
    const planar = rgbaToPlanar(rgba, 2);
    expect(Array.from(planar)).toEqual([10, 40, 20, 50, 30, 60]);
    expect(Array.from(planarToRgba(planar, 2))).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });
});
