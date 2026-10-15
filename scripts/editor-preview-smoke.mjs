// Optional browser verification; uses the same separately installed Playwright as culling smoke.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.EDITOR_SMOKE_URL || 'http://127.0.0.1:3101';
const output = new URL('../output/playwright/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [], external = [];
await context.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin) {
    external.push(url);
    return route.abort();
  }
  return route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && /Preview generation failed|Export failed/.test(message.text())) errors.push(message.text()); });
const report = {};
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await writeFile(new URL('editor-initial-snapshot.txt', output), await page.locator('body').ariaSnapshot());

  report.pipeline = await page.evaluate(async baselineModule => {
    const { EditorPreviewRenderer } = await import('/utils/editorPreview.ts');
    const { applyEditsAndExport } = await import('/utils/imageProcessor.ts');
    const baseline = baselineModule ? await import(baselineModule) : null;
    const neutral = { brightness: 0, contrast: 0, saturation: 0, vibrance: 0, shadows: 0, highlights: 0, clarity: 0, sharpness: 0, noiseReduction: 0 };
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 320;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(512, 320);
    for (let y = 0; y < 320; y++) for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      image.data.set([x % 256, (y * 2) % 256, (x + y) % 256, x < 64 ? 0 : x < 128 ? 128 : 255], i);
    }
    ctx.putImageData(image, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'fixture.png', { type: 'image/png' });
    const url = URL.createObjectURL(file);
    const renderer = new EditorPreviewRenderer();
    const pixels = async blob => {
      const bitmap = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const cctx = c.getContext('2d'); cctx.drawImage(bitmap, 0, 0); bitmap.close();
      return { width: c.width, height: c.height, data: cctx.getImageData(0, 0, c.width, c.height).data };
    };
    const compare = (a, b, label) => {
      if (a.width !== b.width || a.height !== b.height) throw new Error(`Dimension mismatch: ${label}`);
      let maximum = 0, changed = 0;
      for (let i = 0; i < a.data.length; i++) {
        const difference = Math.abs(a.data[i] - b.data[i]);
        maximum = Math.max(maximum, difference);
        if (difference) changed++;
      }
      return { maximum, changed };
    };
    const cases = [neutral,
      { ...neutral, brightness: 35 }, { ...neutral, contrast: -30 },
      { ...neutral, shadows: 45, highlights: 30 }, { ...neutral, saturation: -40, vibrance: 25 },
      { ...neutral, sharpness: 45, clarity: 20 }, { ...neutral, noiseReduction: 30 },
      { ...neutral, aspectRatio: 1 },
      { ...neutral, cropRect: { x: 80, y: 40, width: 300, height: 200 } },
      { ...neutral, watermark: { enabled: true, text: 'FrameMind', opacity: 70, size: 20, position: 'bottom-right', color: '#ffffff' } },
      { ...neutral, brightness: 10, contrast: 20, saturation: 15, vibrance: 30, shadows: 20, highlights: 15, clarity: 15, sharpness: 20, noiseReduction: 10 },
    ];
    const comparisons = [];
    try {
      for (let i = 0; i < cases.length; i++) {
        const preview = await renderer.render(file, 'fixture', cases[i]);
        if (preview.type !== 'image/png') throw new Error('Lossy editor preview');
        const exported = await applyEditsAndExport(url, cases[i], { format: 'png', quality: 100, scale: 1 });
        const actual = await pixels(exported);
        const worker = compare(await pixels(preview), actual, `worker ${i}`);
        const old = baseline ? compare(await pixels(await baseline.applyEditsAndExport(url, cases[i], { format: 'png', quality: 100, scale: 1 })), actual, `baseline ${i}`) : null;
        comparisons.push({ case: i, worker, old });
      }
      const transparent = await pixels(await renderer.render(file, 'fixture', neutral));
      const alpha = [transparent.data[3], transparent.data[(80 * 4) + 3], transparent.data[(200 * 4) + 3]];
      // A burst must publish only the final requested photo/settings.
      const burst = Array.from({ length: 12 }, (_, brightness) => renderer.render(file, 'fixture', { ...neutral, brightness }).then(blob => ({ blob }), error => ({ error: error.name })));
      const results = await Promise.all(burst);
      const final = await pixels(results.at(-1).blob);
      const expected = await pixels(await applyEditsAndExport(url, { ...neutral, brightness: 11 }, { format: 'png', quality: 100, scale: 1 }));
      const latest = compare(final, expected, 'latest slider request');
      // Keep this renderer for a real cache check from the Playwright worker context.
      window.__editorSmoke = { renderer, file, neutral };
      return { comparisons, alpha, latest, skipped: results.filter(result => result.error === 'AbortError').length, workerActive: !!renderer.worker && !renderer.workerFailed };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, process.env.EDITOR_BASELINE_MODULE || null);
  assert.equal(report.pipeline.workerActive, true, 'Worker unexpectedly fell back to the main thread');
  assert.deepEqual(report.pipeline.alpha, [0, 128, 255]);
  assert.equal(report.pipeline.skipped, 11);
  assert.equal(report.pipeline.latest.maximum, 0);
  for (const comparison of report.pipeline.comparisons) {
    assert.equal(comparison.worker.maximum, 0, `Worker/export pixels differ in case ${comparison.case}`);
    if (comparison.old) assert.equal(comparison.old.maximum, 0, `Existing export pixels changed in case ${comparison.case}`);
  }

  const worker = page.workers().find(worker => worker.url().includes('editorPreview.worker'));
  assert.ok(worker);
  await worker.evaluate(() => {
    const decode = globalThis.createImageBitmap;
    globalThis.__editorDecodes = 0;
    globalThis.createImageBitmap = (...args) => { globalThis.__editorDecodes++; return decode(...args); };
  });
  await page.evaluate(async () => {
    const { renderer, file, neutral } = window.__editorSmoke;
    await renderer.render(file, 'fixture', { ...neutral, brightness: 25 });
    await renderer.render(file, 'fixture', { ...neutral, brightness: 30 });
  });
  report.cachedSourceDecodes = await worker.evaluate(() => globalThis.__editorDecodes);
  assert.equal(report.cachedSourceDecodes, 0, 'Slider changes decoded the same source again');
  await page.evaluate(async () => {
    const { renderer, file, neutral } = window.__editorSmoke;
    await renderer.render(file, 'changed-source', neutral);
  });
  report.changedSourceDecodes = await worker.evaluate(() => globalThis.__editorDecodes);
  assert.equal(report.changedSourceDecodes, 1, 'Switching source did not invalidate the bitmap');

  report.performance = await page.evaluate(async baselineModule => {
    const { EditorPreviewRenderer } = await import('/utils/editorPreview.ts');
    const baseline = baselineModule ? await import(baselineModule) : null;
    const canvas = document.createElement('canvas'); canvas.width = 6000; canvas.height = 4000;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 6000, 4000);
    gradient.addColorStop(0, '#142435'); gradient.addColorStop(0.5, '#dbb18b'); gradient.addColorStop(1, '#568a64');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 6000, 4000);
    const file = new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95))], '24mp.jpg', { type: 'image/jpeg' });
    canvas.width = 1; canvas.height = 1;
    const before = new Uint8Array(await file.arrayBuffer());
    const { neutral } = window.__editorSmoke;
    const edits = { ...neutral, brightness: 20, contrast: 15, saturation: 10, shadows: 20, highlights: 25, sharpness: 30, clarity: 20 };
    const measure = async action => {
      let last = performance.now(), maxGap = 0, ticks = 0;
      const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks++; }, 5);
      const start = performance.now();
      const blob = await action();
      const elapsed = performance.now() - start;
      await new Promise(resolve => setTimeout(resolve, 15)); clearInterval(timer);
      const bitmap = await createImageBitmap(blob);
      const dimensions = [bitmap.width, bitmap.height]; bitmap.close();
      return { elapsedMs: Math.round(elapsed), maxMainThreadGapMs: Math.round(maxGap), ticks, dimensions };
    };
    const renderer = new EditorPreviewRenderer();
    let old = null;
    if (baseline) {
      const url = URL.createObjectURL(file);
      try { old = await measure(() => baseline.applyEditsAndExport(url, edits, { format: 'jpeg', quality: 90, scale: 0.5 })); }
      finally { URL.revokeObjectURL(url); }
    }
    const cold = await measure(() => renderer.render(file, '24mp', edits));
    const warm = await measure(() => renderer.render(file, '24mp', { ...edits, brightness: 25 }));
    const workerActive = !!renderer.worker && !renderer.workerFailed;
    renderer.dispose();
    const after = new Uint8Array(await file.arrayBuffer());
    const unchanged = before.length === after.length && before.every((byte, i) => byte === after[i]);
    return { old, cold, warm, workerActive, originalUnchanged: unchanged };
  }, process.env.EDITOR_BASELINE_MODULE || null);
  assert.equal(report.performance.workerActive, true);
  assert.equal(report.performance.originalUnchanged, true);
  assert.deepEqual(report.performance.warm.dimensions, [1600, 1066]);

  report.fallback = await page.evaluate(async () => {
    const { EditorPreviewRenderer } = await import('/utils/editorPreview.ts');
    const { applyEditsAndExport } = await import('/utils/imageProcessor.ts');
    const { file, neutral } = window.__editorSmoke;
    const savedWorker = window.Worker;
    window.Worker = undefined;
    const renderer = new EditorPreviewRenderer();
    const url = URL.createObjectURL(file);
    const read = async blob => {
      const bitmap = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = c.getContext('2d');
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    try {
      const edits = { ...neutral, brightness: 15, sharpness: 20 };
      const fallback = await renderer.render(file, 'fallback', edits);
      const actual = await read(fallback);
      const expected = await read(await applyEditsAndExport(url, edits, { format: 'png', quality: 100, scale: 1 }));
      return { type: fallback.type, identicalPixels: actual.length === expected.length && actual.every((byte, i) => byte === expected[i]) };
    } finally { renderer.dispose(); URL.revokeObjectURL(url); window.Worker = savedWorker; }
  });
  assert.equal(report.fallback.type, 'image/png');
  assert.equal(report.fallback.identicalPixels, true);
  await page.evaluate(() => window.__editorSmoke.renderer.dispose());
  await writeFile(new URL('editor-preview-smoke.json', output), JSON.stringify(report, null, 2));

  // Exercise the real React editor, not only the rendering API.
  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  const jpeg = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1280;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#526a46'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#d9aa74'; ctx.fillRect(400, 200, 600, 900);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles([
    { name: 'EDITOR_A.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') },
    { name: 'EDITOR_B.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') },
  ]);
  await page.getByRole('heading', { name: 'Lokální culling', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Úpravy 03', exact: true }).click();
  await page.getByRole('slider').first().waitFor();
  await writeFile(new URL('editor-adjust-snapshot.txt', output), await page.locator('body').ariaSnapshot());
  await page.getByRole('slider').first().fill('35');
  await page.getByRole('button', { name: 'EDITOR_A.jpg', exact: true }).waitFor();
  await page.getByRole('button', { name: /EDITOR_B\.jpg/ }).click();
  await page.getByRole('slider').first().fill('-20');
  await page.getByRole('button', { name: /EDITOR_A\.jpg/ }).click();
  assert.equal(await page.getByRole('slider').first().inputValue(), '35', 'Edits leaked between photos');
  await page.waitForTimeout(500);
  await page.screenshot({ path: fileURLToPath(new URL('editor-preview.png', output)), fullPage: true });
  report.editorInteraction = true;
  report.externalRequests = external.length;
  report.pageErrors = errors;
  assert.deepEqual(errors, []);
  await writeFile(new URL('editor-preview-smoke.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
