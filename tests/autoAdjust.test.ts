import { describe, expect, it } from 'vitest';
import { computeAutoAdjust } from '../utils/autoAdjust';

const image = (pixels: number, fill: (i: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const [r, g, b] = fill(i);
    data.set([r, g, b, 255], i * 4);
  }
  return data;
};

describe('computeAutoAdjust', () => {
  it('prázdný vstup nic nemění', () => {
    expect(computeAutoAdjust(new Uint8ClampedArray(0))).toEqual({
      brightness: 0, contrast: 0, shadows: 0, highlights: 0, vibrance: 0,
    });
  });

  it('tmavou fotku zesvětlí', () => {
    const dark = image(1000, (i) => [20 + (i % 40), 25 + (i % 40), 30 + (i % 40)]);
    expect(computeAutoAdjust(dark).brightness).toBeGreaterThan(20);
  });

  it('přepálenou fotku ztmaví a stáhne světla', () => {
    const bright = image(1000, (i) => (i % 10 === 0 ? [255, 255, 255] : [210, 205, 200]));
    const edits = computeAutoAdjust(bright);
    expect(edits.brightness).toBeLessThan(0);
    expect(edits.highlights).toBeGreaterThan(0);
  });

  it('plochou šedou fotku kontrastuje a oživí barvy', () => {
    const flat = image(1000, (i) => [110 + (i % 30), 112 + (i % 30), 115 + (i % 30)]);
    const edits = computeAutoAdjust(flat);
    expect(edits.contrast).toBeGreaterThan(0);
    expect(edits.vibrance).toBeGreaterThan(0);
  });

  it('vyváženou fotku skoro nechá být', () => {
    const good = image(2560, (i) => {
      const v = i % 256;
      return [v, v, v];
    });
    const edits = computeAutoAdjust(good);
    expect(Math.abs(edits.brightness)).toBeLessThanOrEqual(10);
    expect(edits.contrast).toBe(0);
  });
});
