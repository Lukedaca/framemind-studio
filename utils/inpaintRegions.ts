import type { Rect } from './inpaintMath';

export const MAX_INPAINT_REGIONS = 16;

export interface InpaintRegion {
  id: number;
  /** Includes the component's soft alpha tail; area counts only significant pixels. */
  box: Rect;
  area: number;
}

export interface InpaintRegionPlan {
  /** Zero outside retained components; 1..regions.length identifies the owning region. */
  labels: Uint8Array;
  regions: InpaintRegion[];
}

export interface InpaintRegionOptions {
  /** Expand each region by this many mask pixels before deciding whether halos overlap. */
  padding?: number;
  maxRegions?: number;
}

interface Group {
  key: number;
  box: Rect;
  area: number;
}

const joinedBox = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x, y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

const boxGapSquared = (a: Rect, b: Rect) => {
  const dx = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width);
  const dy = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
  return dx * dx + dy * dy;
};

/**
 * Keep distant strokes at their own model scale. Connected objects are never tiled.
 * Scanline flood fill uses typed storage, including a bounded number of live groups.
 */
export function planInpaintRegions(
  alpha: Uint8Array,
  width: number,
  height: number,
  threshold = 12,
  options: InpaintRegionOptions = {},
): InpaintRegionPlan {
  const padding = options.padding ?? 0;
  const maxRegions = options.maxRegions ?? MAX_INPAINT_REGIONS;
  const pixels = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      !Number.isSafeInteger(pixels) || pixels >= 0xffffffff || alpha.length !== pixels ||
      !Number.isInteger(threshold) || threshold < 0 || threshold > 255 ||
      !Number.isFinite(padding) || padding < 0 ||
      !Number.isInteger(maxRegions) || maxRegions < 1 || maxRegions > MAX_INPAINT_REGIONS) {
    throw new RangeError('Invalid inpaint region dimensions or options.');
  }

  const components = new Uint32Array(pixels);
  let parents = new Uint32Array(Math.min(pixels + 1, 1024));
  let pending = new Uint32Array(Math.min(pixels, 1024));
  let pendingCount = 0;
  let componentCount = 0;
  const groups: Group[] = [];

  const push = (index: number) => {
    if (pendingCount === pending.length) {
      const larger = new Uint32Array(pending.length * 2);
      larger.set(pending);
      pending = larger;
    }
    pending[pendingCount++] = index;
  };

  const merge = (a: number, b: number) => {
    parents[groups[b].key] = groups[a].key;
    groups[a].box = joinedBox(groups[a].box, groups[b].box);
    groups[a].area += groups[b].area;
    groups.splice(b, 1);
  };

  const mergeOverlaps = () => {
    // At most 17 live groups: grouping cost stays bounded even for a speckled mask.
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let a = 0; a < groups.length; a++) {
        for (let b = a + 1; b < groups.length; b++) {
          const first = groups[a].box;
          const second = groups[b].box;
          if (first.x <= second.x + second.width + padding * 2 &&
              second.x <= first.x + first.width + padding * 2 &&
              first.y <= second.y + second.height + padding * 2 &&
              second.y <= first.y + first.height + padding * 2) {
            merge(a, b);
            changed = true;
            break outer;
          }
        }
      }
    }
  };

  for (let seed = 0; seed < pixels; seed++) {
    if (!alpha[seed] || components[seed]) continue;
    const key = ++componentCount;
    if (key === parents.length) {
      const larger = new Uint32Array(Math.min(pixels + 1, parents.length * 2));
      larger.set(parents);
      parents = larger;
    }
    parents[key] = key;
    let minX = width, minY = height, maxX = -1, maxY = -1, area = 0;
    push(seed);
    while (pendingCount) {
      const index = pending[--pendingCount];
      if (components[index]) continue;
      const y = Math.floor(index / width);
      const row = y * width;
      let left = index - row;
      let right = left;
      while (left > 0 && alpha[row + left - 1] && !components[row + left - 1]) left--;
      while (right + 1 < width && alpha[row + right + 1] && !components[row + right + 1]) right++;
      for (let x = left; x <= right; x++) {
        components[row + x] = key;
        if (alpha[row + x] > threshold) area++;
      }
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, right);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      // One pixel extra on either side gives brush diagonals 8-connectivity.
      for (let direction = -1; direction <= 1; direction += 2) {
        const nextY = y + direction;
        if (nextY < 0 || nextY >= height) continue;
        const nextRow = nextY * width;
        const end = Math.min(width - 1, right + 1);
        let x = Math.max(0, left - 1);
        while (x <= end) {
          if (alpha[nextRow + x] && !components[nextRow + x]) {
            push(nextRow + x);
            do { x++; } while (x <= end && alpha[nextRow + x] && !components[nextRow + x]);
          } else x++;
        }
      }
    }
    if (!area) {
      parents[key] = 0;
      continue;
    }
    groups.push({ key, box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, area });
    mergeOverlaps();
    if (groups.length > maxRegions) {
      let nearestA = 0, nearestB = 1, nearestDistance = Infinity;
      for (let a = 0; a < groups.length; a++) {
        for (let b = a + 1; b < groups.length; b++) {
          const distance = boxGapSquared(groups[a].box, groups[b].box);
          if (distance < nearestDistance) {
            nearestA = a;
            nearestB = b;
            nearestDistance = distance;
          }
        }
      }
      merge(nearestA, nearestB);
      mergeOverlaps();
    }
  }

  const regionIds = new Uint8Array(parents.length);
  const regions = groups.map((group, index) => {
    const id = index + 1;
    regionIds[group.key] = id;
    return { id, box: group.box, area: group.area };
  });
  const labels = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    let root = components[i];
    while (parents[root] !== root) root = parents[root];
    let current = components[i];
    while (parents[current] !== root) {
      const next = parents[current];
      parents[current] = root;
      current = next;
    }
    labels[i] = regionIds[root];
  }
  return { labels, regions };
}
