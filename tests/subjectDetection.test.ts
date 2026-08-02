import { describe, expect, it } from 'vitest';
import { normalizeDetections, MIN_SUBJECT_SIDE, type RawDetection } from '../services/subjectDetection';

const person = (
  originX: number,
  originY: number,
  width: number,
  height: number,
  score = 0.9
): RawDetection => ({
  boundingBox: { originX, originY, width, height },
  categories: [{ categoryName: 'person', score }],
});

describe('normalizeDetections', () => {
  it('největší osoba je primary — na ní fotograf ostří', () => {
    const result = normalizeDetections(
      [person(10, 10, 40, 90), person(200, 50, 120, 300), person(400, 20, 30, 60)],
      1000,
      600
    );
    expect(result.subjects).toHaveLength(3);
    expect(result.primary).toMatchObject({ x: 200, y: 50, w: 120, h: 300 });
  });

  it('rámeček přesahující okraj se ořízne do snímku, ne pod nulu', () => {
    const result = normalizeDetections([person(-40, -30, 200, 200)], 1000, 600);
    expect(result.primary).toMatchObject({ x: 0, y: 0, w: 160, h: 170 });
  });

  it('přetečení vpravo dole nevyleze ze snímku', () => {
    const result = normalizeDetections([person(900, 500, 300, 300)], 1000, 600);
    const box = result.primary!;
    expect(box.x + box.w).toBeLessThanOrEqual(1000);
    expect(box.y + box.h).toBeLessThanOrEqual(600);
  });

  it('drobty pod minimální stranou se zahodí', () => {
    const tiny = MIN_SUBJECT_SIDE - 1;
    const result = normalizeDetections([person(10, 10, tiny, 200), person(50, 50, 200, tiny)], 1000, 600);
    expect(result.subjects).toHaveLength(0);
    expect(result.primary).toBeNull();
  });

  it('detekce bez rámečku nebo s nesmyslnými čísly neshodí měření', () => {
    const result = normalizeDetections(
      [{ categories: [{ categoryName: 'person', score: 0.9 }] }, person(NaN, 0, 100, 100), person(10, 10, 100, 200)],
      1000,
      600
    );
    expect(result.subjects).toHaveLength(1);
    expect(result.primary).toMatchObject({ x: 10, y: 10 });
  });

  it('prázdný vstup vrátí prázdný výsledek, ne výjimku', () => {
    const result = normalizeDetections([], 1000, 600);
    expect(result.subjects).toEqual([]);
    expect(result.primary).toBeNull();
  });

  it('skóre se přenese z první kategorie', () => {
    const result = normalizeDetections([person(10, 10, 100, 200, 0.42)], 1000, 600);
    expect(result.primary!.score).toBeCloseTo(0.42);
  });
});
