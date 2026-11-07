// Repeatable local benchmark. Never modifies source photographs.
import { chromium } from 'playwright';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const label = process.argv[2] ?? 'current';
assert.match(label, /^[a-z0-9-]+$/i);
const folder = process.argv[3];
const paths = folder ? (await readdir(folder)).filter(n => /\.(jpe?g|png)$/i.test(n)).sort()
  .slice(0, 12).map(n => resolve(folder, n)) : [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = await Promise.all(paths.map(async p => digest(await readFile(p))));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const base = process.env.CULLING_SMOKE_URL ?? 'http://127.0.0.1:3100';
const external = [], errors = [];
await page.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin) {
    external.push(url); return route.abort();
  }
  return route.continue();
});
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  external.length = 0;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  const metrics = await page.evaluate(async () => {
    const { readMetrics } = await import('/utils/cullingMetrics.ts');
    const rows = [];
    for (const size of [128, 384, 768]) for (const noise of [false, true]) {
      const pixels = new Uint8ClampedArray(size * size * 4);
      let seed = 987654321;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const value = noise ? seed >>> 24 : 128 + 55 * Math.sin(x / 6) + 45 * Math.cos(y / 7);
        pixels.set([value, value * .8, value * .7, 255], (y * size + x) * 4);
      }
      const signature = size === 768;
      for (let i = 0; i < 3; i++) readMetrics(pixels, size, size, signature);
      const times = []; let result;
      for (let i = 0; i < 9; i++) {
        const start = performance.now(); result = readMetrics(pixels, size, size, signature);
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const bytes = new TextEncoder().encode(JSON.stringify(result));
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(v => v.toString(16).padStart(2, '0')).join('');
      rows.push({ size, noise, medianMs: times[4], p95Ms: times[8], sha256 });
    }
    return rows;
  });
  const { profile } = await cdp.send('Profiler.stop');
  const hotspots = profile.nodes.filter(n => n.hitCount).sort((a, b) => b.hitCount - a.hitCount).slice(0, 12)
    .map(n => ({ function: n.callFrame.functionName, file: n.callFrame.url.split('/').pop(), hits: n.hitCount }));
  await page.evaluate(async () => {
    const { CullingSession } = await import('/services/cullingSession.ts');
    window.audit = { session: new CullingSession(), files: [] };
    const input = document.createElement('input'); input.type = 'file'; input.id = 'perf-input'; document.body.append(input);
  });
  const photos = [];
  for (const path of paths) {
    await page.locator('#perf-input').setInputFiles(path);
    photos.push(await page.evaluate(async () => {
      const file = document.querySelector('#perf-input').files[0];
      const input = { id: file.name, file, originalFile: file };
      const start = performance.now();
      const analysis = await window.audit.session.analyze(input);
      const measuredMs = performance.now() - start;
      const scoreStart = performance.now();
      const result = await window.audit.session.score(analysis, null);
      window.audit.files.push(input);
      return { name: file.name, measuredMs, scoreMs: performance.now() - scoreStart,
        result, automatic: analysis.metrics.automatic?.status };
    }));
  }
  const repeatMs = await page.evaluate(async () => {
    const start = performance.now();
    for (const file of window.audit.files) await window.audit.session.analyze(file);
    window.audit.session.close(); return performance.now() - start;
  });
  for (let i = 0; i < paths.length; i++) assert.equal(digest(await readFile(paths[i])), hashes[i]);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  assert.ok(photos.every(p => p.automatic !== 'unavailable'));
  const report = { label, metrics, hotspots, photos, repeatMs, originalsUnchanged: true, external, errors };
  await mkdir('output/playwright', { recursive: true });
  await writeFile(join('output/playwright', `culling-perf-${label}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, photos: photos.map(({ result, ...row }) => ({ ...row, decision: result.decision })) }, null, 2));
} finally { await browser.close(); }
