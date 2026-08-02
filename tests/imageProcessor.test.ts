// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isJpegFile, normalizeImageFile } from '../utils/imageProcessor';

describe('JPEG import normalization', () => {
  it('recognizes JPEG from MIME type or file extension', () => {
    expect(isJpegFile(new File([], 'photo.bin', { type: 'image/jpeg' }))).toBe(true);
    expect(isJpegFile(new File([], 'photo.JPG'))).toBe(true);
    expect(isJpegFile(new File([], 'photo.jpeg'))).toBe(true);
    expect(isJpegFile(new File([], 'photo.png', { type: 'image/png' }))).toBe(false);
  });

  it('returns an imported JPEG unchanged without decoding or recompression', async () => {
    const originalBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const original = new File([originalBytes], 'IMG_9885.jpg', {
      type: 'image/jpeg',
      lastModified: 1_721_520_000_000,
    });

    const normalized = await normalizeImageFile(original);

    expect(normalized).toBe(original);
    expect(normalized.name).toBe('IMG_9885.jpg');
    expect(normalized.type).toBe('image/jpeg');
    expect(normalized.lastModified).toBe(1_721_520_000_000);
    expect(new Uint8Array(await normalized.arrayBuffer())).toEqual(originalBytes);
  });
});
