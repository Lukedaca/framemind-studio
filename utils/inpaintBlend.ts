const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** Conservative boundary tone correction. Strong edges and clipped colors are excluded. */
export function harmonizeInpaintBoundary(filled: Uint8ClampedArray, original: Uint8ClampedArray,
  hole: Uint8Array, width: number, height: number): number[] {
  if (filled.length !== width * height * 4 || original.length !== filled.length || hole.length !== width * height) throw new RangeError('Invalid blend dimensions');
  const differences: number[][] = [[], [], []];
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const p = y * width + x;
    if (!hole[p]) continue;
    for (const direction of [-1, 1, -width, width]) {
      const q = p + direction, r = q + direction, inner = p - direction;
      if (hole[q] || hole[r] || !hole[inner]) continue;
      const values: number[] = [];
      let usable = true;
      for (let c = 0; c < 3; c++) {
        const outside = original[q * 4 + c], gradient = outside - original[r * 4 + c];
        const inside = filled[p * 4 + c], difference = outside + gradient - inside;
        if (outside < 8 || outside > 247 || Math.abs(gradient) > 8 || Math.abs(inside - filled[inner * 4 + c]) > 12 || Math.abs(difference) > 32) { usable = false; break; }
        values.push(difference);
      }
      if (usable) values.forEach((value, c) => differences[c].push(value));
    }
  }
  if (differences[0].length < 24) return [0, 0, 0];
  const shifts = differences.map(values => {
    const center = median(values);
    const deviation = median(values.map(value => Math.abs(value - center)));
    return deviation > 6 || Math.abs(center) < 1.5 ? 0 : Math.max(-12, Math.min(12, center * 0.75));
  });
  if (shifts.some(value => value !== 0)) for (let p = 0; p < hole.length; p++) {
    if (!hole[p]) continue;
    for (let c = 0; c < 3; c++) if (filled[p * 4 + c] > 4 && filled[p * 4 + c] < 251) filled[p * 4 + c] += shifts[c];
  }
  return shifts;
}
