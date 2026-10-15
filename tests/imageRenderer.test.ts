import { describe, expect, it } from 'vitest';
import type { ManualEdits } from '../types';
import { getRenderGeometry } from '../utils/imageRenderer';

const edits: ManualEdits = { brightness: 0, contrast: 0, saturation: 0, vibrance: 0, shadows: 0, highlights: 0, clarity: 0, sharpness: 0, noiseReduction: 0 };

describe('shared preview and export geometry', () => {
  it('bounds large previews but preserves full-resolution exports', () => {
    const preview = getRenderGeometry(6000, 4000, edits, { scale: 1, maxSize: 1600 });
    expect([preview.finalWidth, preview.finalHeight]).toEqual([1600, 1066]);
    const full = getRenderGeometry(6000, 4000, edits, { scale: 1 });
    expect([full.finalWidth, full.finalHeight]).toEqual([6000, 4000]);
  });
  it('uses the cropped region before bounding and never upscales a small source', () => {
    const crop = getRenderGeometry(6000, 4000, { ...edits, cropRect: { x: 1000, y: 1000, width: 800, height: 600 } }, { scale: 1, maxSize: 1600 });
    expect([crop.srcX, crop.srcY, crop.finalWidth, crop.finalHeight]).toEqual([1000, 1000, 800, 600]);
    const portrait = getRenderGeometry(4000, 6000, { ...edits, aspectRatio: 1 }, { scale: 1, maxSize: 1600 });
    expect([portrait.srcX, portrait.srcY, portrait.srcW, portrait.srcH, portrait.finalWidth, portrait.finalHeight]).toEqual([0, 1000, 4000, 4000, 1600, 1600]);
  });
  it('keeps tiny scaled exports encodable instead of producing a zero-sized canvas', () => {
    const tiny = getRenderGeometry(1, 2, edits, { scale: 0.1 });
    expect([tiny.finalWidth, tiny.finalHeight]).toEqual([1, 1]);
  });
  it('rejects invalid dimensions and out-of-bounds crops instead of hanging export', () => {
    expect(() => getRenderGeometry(0, 20, edits, { scale: 1 })).toThrow(RangeError);
    expect(() => getRenderGeometry(100, 20, edits, { scale: NaN })).toThrow(RangeError);
    expect(() => getRenderGeometry(100, 20, edits, { scale: 1, maxSize: 0 })).toThrow(RangeError);
    expect(() => getRenderGeometry(100, 20, { ...edits, aspectRatio: 0 }, { scale: 1 })).toThrow(RangeError);
    expect(() => getRenderGeometry(100, 20, { ...edits, cropRect: { x: 100, y: 0, width: 5, height: 5 } }, { scale: 1 })).toThrow(RangeError);
  });
});
