import { describe, expect, it } from 'vitest';
import { SEGMENT_INPUT, SEGMENT_MASK, SEGMENT_MEAN, SEGMENT_STD, SEGMENT_TOTAL_BYTES, maskArea, toSegmentPixels } from '../utils/segmentModel';

describe('toSegmentPixels', () => {
  it('RGBA 1024² → planární float s normalizací ImageNet', () => {
    const n = SEGMENT_INPUT * SEGMENT_INPUT;
    const rgba = new Uint8ClampedArray(n * 4);
    rgba[0] = 255; // první pixel: čistě červený
    const out = toSegmentPixels(rgba);
    expect(out.length).toBe(3 * n);
    expect(out[0]).toBeCloseTo((1 - SEGMENT_MEAN[0]) / SEGMENT_STD[0], 5);
    expect(out[n]).toBeCloseTo((0 - SEGMENT_MEAN[1]) / SEGMENT_STD[1], 5);
    expect(out[2 * n]).toBeCloseTo((0 - SEGMENT_MEAN[2]) / SEGMENT_STD[2], 5);
  });
});

describe('maskArea', () => {
  it('počítá jen kladné logity a respektuje posun', () => {
    const size = SEGMENT_MASK * SEGMENT_MASK;
    const logits = new Float32Array(size * 2).fill(-1);
    logits.fill(2, size, size + 100);
    expect(maskArea(logits)).toBe(0);
    expect(maskArea(logits, size)).toBe(100);
  });
});

describe('SEGMENT_TOTAL_BYTES', () => {
  it('odpovídá velikosti souborů na Hugging Face (~61 MB)', () => {
    expect(SEGMENT_TOTAL_BYTES).toBe(441_167 + 52_573_088 + 290_416 + 8_662_016);
  });
});
