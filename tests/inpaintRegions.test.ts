import { describe, expect, it } from 'vitest';
import { computeInpaintCrop } from '../utils/inpaintMath';
import { MAX_INPAINT_REGIONS, planInpaintRegions } from '../utils/inpaintRegions';

describe('planInpaintRegions', () => {
  it('keeps distant strokes in separate local crops without changing the input', () => {
    const width = 400, height = 300;
    const alpha = new Uint8Array(width * height);
    for (const [cx, cy] of [[10, 20], [380, 270]]) {
      for (let y = cy; y < cy + 4; y++) for (let x = cx; x < cx + 5; x++) alpha[y * width + x] = 255;
    }
    const original = alpha.slice();
    const plan = planInpaintRegions(alpha, width, height, 12, { padding: 8 });
    expect(plan.regions.map(region => region.box)).toEqual([
      { x: 10, y: 20, width: 5, height: 4 },
      { x: 380, y: 270, width: 5, height: 4 },
    ]);
    expect(plan.regions.map(region => region.area)).toEqual([20, 20]);
    for (const { box } of plan.regions) {
      const crop = computeInpaintCrop({ x: box.x * 10, y: box.y * 10, width: box.width * 10, height: box.height * 10 }, 4000, 3000, 4);
      expect(crop.width).toBe(512);
      expect(crop.height).toBe(512);
    }
    expect(plan.labels[20 * width + 10]).toBe(1);
    expect(plan.labels[270 * width + 380]).toBe(2);
    expect(plan.labels[150 * width + 200]).toBe(0);
    expect(alpha).toEqual(original);
  });

  it('preserves diagonal brush connectivity and soft tails while counting significant area', () => {
    const alpha = new Uint8Array(100);
    alpha[22] = 255;
    alpha[33] = 80;
    alpha[44] = 7;
    alpha[45] = 1;
    const plan = planInpaintRegions(alpha, 10, 10);
    expect(plan.regions).toEqual([{ id: 1, box: { x: 2, y: 2, width: 4, height: 3 }, area: 2 }]);
    for (const index of [22, 33, 44, 45]) expect(plan.labels[index]).toBe(1);
  });

  it('drops isolated low-alpha components and respects the strict significance threshold', () => {
    const alpha = new Uint8Array(400);
    alpha[0] = 12;
    alpha[1] = 1;
    alpha[15 * 20 + 15] = 13;
    const plan = planInpaintRegions(alpha, 20, 20);
    expect(plan.regions).toEqual([{ id: 1, box: { x: 15, y: 15, width: 1, height: 1 }, area: 1 }]);
    expect(plan.labels[0]).toBe(0);
    expect(plan.labels[1]).toBe(0);
    expect(planInpaintRegions(alpha, 20, 20, 13).regions).toEqual([]);
  });

  it('merges nearby expanded halos, including transitive overlap, before inference', () => {
    const alpha = new Uint8Array(100 * 20);
    for (const x of [5, 18, 31, 90]) alpha[10 * 100 + x] = 255;
    const plan = planInpaintRegions(alpha, 100, 20, 12, { padding: 6 });
    expect(plan.regions).toEqual([
      { id: 1, box: { x: 5, y: 10, width: 27, height: 1 }, area: 3 },
      { id: 2, box: { x: 90, y: 10, width: 1, height: 1 }, area: 1 },
    ]);
    expect([5, 18, 31].map(x => plan.labels[10 * 100 + x])).toEqual([1, 1, 1]);
  });

  it('caps inference regions deterministically without losing significant pixels or labels', () => {
    const width = 500, height = 50;
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < 40; i++) alpha[(i % 3 * 15 + 2) * width + i * 12 + 2] = i % 2 ? 255 : 13;
    const plan = planInpaintRegions(alpha, width, height, 12, { maxRegions: 4 });
    expect(plan.regions.length).toBeLessThanOrEqual(4);
    expect(plan.regions.length).toBeGreaterThan(1);
    expect(plan.regions.reduce((sum, region) => sum + region.area, 0)).toBe(40);
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i]) {
        expect(plan.labels[i]).toBeGreaterThan(0);
        const region = plan.regions[plan.labels[i] - 1];
        const x = i % width, y = Math.floor(i / width);
        expect(x).toBeGreaterThanOrEqual(region.box.x);
        expect(x).toBeLessThan(region.box.x + region.box.width);
        expect(y).toBeGreaterThanOrEqual(region.box.y);
        expect(y).toBeLessThan(region.box.y + region.box.height);
      } else expect(plan.labels[i]).toBe(0);
    }
    expect(planInpaintRegions(alpha, width, height, 12, { maxRegions: 4 })).toEqual(plan);
  });

  it('does not tile a large connected object or lose holes in an irregular mask', () => {
    const width = 700, height = 80;
    const alpha = new Uint8Array(width * height);
    for (let x = 1; x < width - 1; x++) alpha[40 * width + x] = 255;
    for (let y = 10; y <= 40; y++) alpha[y * width + 100] = 255;
    const plan = planInpaintRegions(alpha, width, height, 12, { maxRegions: 1 });
    expect(plan.regions).toEqual([{ id: 1, box: { x: 1, y: 10, width: 698, height: 31 }, area: 728 }]);
    expect(plan.labels[20 * width + 200]).toBe(0);
    expect(plan.labels[40 * width + 600]).toBe(1);
  });

  it('does not connect opposite row edges and retains border strokes', () => {
    const alpha = new Uint8Array(60);
    alpha[9] = 255;
    alpha[10] = 255;
    const plan = planInpaintRegions(alpha, 10, 6);
    expect(plan.regions).toEqual([
      { id: 1, box: { x: 9, y: 0, width: 1, height: 1 }, area: 1 },
      { id: 2, box: { x: 0, y: 1, width: 1, height: 1 }, area: 1 },
    ]);
  });

  it('handles a dense viewport mask as one exact region', () => {
    const width = 1536, height = 1024;
    const alpha = new Uint8Array(width * height).fill(255);
    const plan = planInpaintRegions(alpha, width, height);
    expect(plan.regions).toEqual([{ id: 1, box: { x: 0, y: 0, width, height }, area: width * height }]);
    expect(plan.labels[0]).toBe(1);
    expect(plan.labels[plan.labels.length - 1]).toBe(1);
  });

  it('returns no regions for an empty mask', () => {
    const plan = planInpaintRegions(new Uint8Array(9), 3, 3);
    expect(plan.regions).toEqual([]);
    expect(Array.from(plan.labels)).toEqual(new Array(9).fill(0));
  });

  it('preserves complete connected components and exact area on irregular masks', () => {
    let state = 76123;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const width = 31, height = 19;
    for (let sample = 0; sample < 25; sample++) {
      const alpha = Uint8Array.from({ length: width * height }, () => {
        const value = random();
        return value < 0.12 ? 255 : value < 0.38 ? 6 : 0;
      });
      const plan = planInpaintRegions(alpha, width, height, 12, { maxRegions: 4 });
      const visited = new Uint8Array(alpha.length);
      const measuredArea = new Array(plan.regions.length).fill(0);
      for (let seed = 0; seed < alpha.length; seed++) {
        if (!alpha[seed]) {
          expect(plan.labels[seed]).toBe(0);
          continue;
        }
        if (visited[seed]) continue;
        const component = [seed];
        visited[seed] = 1;
        for (let at = 0; at < component.length; at++) {
          const x = component[at] % width, y = Math.floor(component[at] / width);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
            const next = (y + dy) * width + x + dx;
            if (alpha[next] && !visited[next]) {
              visited[next] = 1;
              component.push(next);
            }
          }
        }
        const significant = component.filter(index => alpha[index] > 12).length;
        const id = plan.labels[seed];
        expect(id > 0).toBe(significant > 0);
        for (const index of component) expect(plan.labels[index]).toBe(id);
        if (significant) measuredArea[id - 1] += significant;
      }
      expect(plan.regions.map(region => region.area)).toEqual(measuredArea);
    }
  });

  it('rejects malformed dimensions and unbounded inference options', () => {
    expect(() => planInpaintRegions(new Uint8Array(9), 0, 3)).toThrow(RangeError);
    expect(() => planInpaintRegions(new Uint8Array(9), 3, 2)).toThrow(RangeError);
    expect(() => planInpaintRegions(new Uint8Array(9), 1.5, 6)).toThrow(RangeError);
    expect(() => planInpaintRegions(new Uint8Array(9), 3, 3, -1)).toThrow(RangeError);
    expect(() => planInpaintRegions(new Uint8Array(9), 3, 3, 12, { padding: Infinity })).toThrow(RangeError);
    expect(() => planInpaintRegions(new Uint8Array(9), 3, 3, 12, { maxRegions: MAX_INPAINT_REGIONS + 1 })).toThrow(RangeError);
  });
});
