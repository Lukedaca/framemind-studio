import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const [beforeLabel = 'before', afterLabel = 'wasm'] = process.argv.slice(2);
for (const label of [beforeLabel, afterLabel]) assert.match(label, /^[a-z0-9-]+$/i);
const [before, after] = await Promise.all([beforeLabel, afterLabel].map(async label =>
  JSON.parse(await readFile(`output/playwright/culling-perf-${label}.json`, 'utf8'))));
assert.equal(after.metrics.length, before.metrics.length);
for (let i = 0; i < before.metrics.length; i++) {
  assert.equal(after.metrics[i].size, before.metrics[i].size);
  assert.equal(after.metrics[i].noise, before.metrics[i].noise);
  assert.equal(after.metrics[i].sha256, before.metrics[i].sha256, 'Pixel diagnostics changed');
}
assert.equal(after.photos.length, before.photos.length);
for (let i = 0; i < before.photos.length; i++) {
  const a = before.photos[i], b = after.photos[i];
  assert.equal(a.name, b.name);
  assert.deepEqual(a.result.metrics, b.result.metrics, `Photo measurements changed: ${a.name}`);
  for (const field of ['finalScore', 'decision', 'reasons', 'risks', 'scoreBreakdown'])
    assert.deepEqual(a.result[field], b.result[field], `Photo verdict changed: ${a.name}: ${field}`);
}
const median = values => { const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const warmBefore = median(before.photos.slice(1).map(p => p.measuredMs));
const warmAfter = median(after.photos.slice(1).map(p => p.measuredMs));
console.log(JSON.stringify({ photoCount: after.photos.length, diagnosticsIdentical: true, verdictsIdentical: true,
  metrics: before.metrics.map((row, i) => ({ size: row.size, noise: row.noise,
    beforeMs: row.medianMs, afterMs: after.metrics[i].medianMs, speedup: row.medianMs / after.metrics[i].medianMs })),
  warmMedianBeforeMs: warmBefore, warmMedianAfterMs: warmAfter, warmTimeReduction: 1 - warmAfter / warmBefore,
  coldBeforeMs: before.photos[0]?.measuredMs, coldAfterMs: after.photos[0]?.measuredMs,
  cachedRepeatMs: after.repeatMs }, null, 2));
