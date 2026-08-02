// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isRawFile, RAW_EXTENSIONS, RAW_OUTPUT_SOURCE } from '../utils/rawProcessor';

describe('rawProcessor', () => {
  it('workflow je označený jako embedded preview, ne RAW development', () => {
    expect(RAW_OUTPUT_SOURCE).toBe('embedded-jpeg-preview');
  });

  it('isRawFile pozná RAW přípony bez ohledu na velikost písmen', () => {
    expect(isRawFile(new File([], 'IMG_0001.CR2'))).toBe(true);
    expect(isRawFile(new File([], 'photo.nef'))).toBe(true);
    expect(isRawFile(new File([], 'photo.ArW'))).toBe(true);
  });

  it('isRawFile odmítne běžné obrázky', () => {
    expect(isRawFile(new File([], 'photo.jpg'))).toBe(false);
    expect(isRawFile(new File([], 'photo.png'))).toBe(false);
    expect(isRawFile(new File([], 'photo'))).toBe(false);
  });

  it('seznam přípon pokrývá hlavní výrobce', () => {
    for (const extension of ['.cr2', '.cr3', '.nef', '.arw', '.dng']) {
      expect(RAW_EXTENSIONS).toContain(extension);
    }
  });
});
