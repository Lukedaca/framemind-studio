// Native-size region evidence and the real UI in an isolated browser profile.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.CULLING_SMOKE_URL ?? 'http://127.0.0.1:3100';
const output = new URL('../output/playwright/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CULLING_SMOKE_BROWSER ? { executablePath: process.env.CULLING_SMOKE_BROWSER } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30000);
const errors = [], external = [], report = {};
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
  const fixtures = await page.evaluate(async () => {
    const { CullingSession } = await import('/services/cullingSession.ts');
    const { computeSimilarityGroups, rescoreCullingResult } = await import('/utils/cullingEngine.ts');
    const size = { width: 2048, height: 1536 }, patch = { x: 800, y: 550, width: 128, height: 128 };
    const selected = { x: patch.x / size.width, y: patch.y / size.height, width: patch.width / size.width, height: patch.height / size.height };
    const inputs = [];
    for (const detailed of [false, true]) {
      const canvas = document.createElement('canvas'); Object.assign(canvas, size);
      const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(size.width, size.height);
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
        const sx = x - patch.x, sy = y - patch.y, inside = sx >= 0 && sy >= 0 && sx < patch.width && sy < patch.height;
        const value = inside ? 128 + 45 * Math.sin(sx / 6) + 45 * Math.cos(sy / 7) +
          (detailed ? ((Math.floor(sx / 2) + Math.floor(sy / 2)) % 2 ? 28 : -28) : 0) :
          8 * Math.sin(x / 160) + 8 * Math.cos(y / 130) + ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 190 : 60);
        pixels.data.set([value, value, value, 255], (y * size.width + x) * 4);
      }
      ctx.putImageData(pixels, 0, 0);
      const data = canvas.toDataURL('image/png').split(',')[1];
      const file = new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], `DETAIL_000${inputs.length + 1}.png`, { type: 'image/png' });
      inputs.push({ id: file.name, file, originalFile: file, previewUrl: '', originalPreviewUrl: '', data });
    }
    const hash = async file => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].join(',');
    const before = await Promise.all(inputs.map(f => hash(f.file)));
    const session = new CullingSession();
    try {
      const global = await session.score(await session.analyze(inputs[0], false, null, false), 'other');
      const analysis = await session.analyze(inputs[0], false, [selected]);
      const normal = await session.score(analysis, 'other');
      const strict = await session.score(analysis, 'other', 'detail');
      const motion = await session.score(analysis, 'other', 'motion');
      const multi = await session.analyze(inputs[0], false, [selected, { x: 0.1, y: 0.1, width: selected.width, height: selected.height }]);
      const multiStrict = await session.score(multi, 'other', 'detail');
      const reference = await session.score(await session.analyze(inputs[1], false, [selected]), 'other');
      const results = [normal, reference];
      const groups = computeSimilarityGroups(results.map((r, i) => ({ id: inputs[i].id, filename: inputs[i].file.name,
        signature: r.metrics.signature, aspectRatio: r.aspectRatio, finalScore: r.finalScore,
        sharpness: r.metrics.technical.laplacianVariance, detailConfidence: r.metrics.technical.detailConfidence,
        native: r.metrics.native, focusRegions: r.metrics.focusRegions })));
      const grouped = results.map((r, i) => rescoreCullingResult({ ...r, ...groups.get(inputs[i].id) }, 'other'));
      const intents = {};
      for (const intent of ['creative', 'stack']) intents[intent] = (await session.score(analysis, 'other', intent)).decision;
      window.regionFixtures = { inputs, selected };
      return { images: inputs.map(f => ({ name: f.file.name, data: f.data })),
        worker: { version: normal.engineVersion, globalDecision: global.decision, globalScore: global.finalScore, globalRisks: global.risks,
          selectedDecision: normal.decision, selectedScore: normal.finalScore, strictDecision: strict.decision,
          motionDecision: motion.decision, multiStrictDecision: multiStrict.decision,
          multiCount: multi.metrics.focusRegions.length, selected: normal.metrics.focusRegions[0],
          reference: reference.metrics.focusRegions[0], grouped: grouped.map(r => ({ decision: r.decision,
            reasons: r.reasons, winner: r.isBestInGroup, compared: r.focusComparisonVerified })), intents,
          originalsUnchanged: (await Promise.all(inputs.map(f => hash(f.file)))).every((value, i) => value === before[i]) } };
    } finally { session.close(); }
  });
  report.worker = fixtures.worker;
  await writeFile(new URL('culling-regions-worker.json', output), JSON.stringify(report.worker, null, 2));
  assert.equal(report.worker.version, 'local-1.8');
  assert.equal(report.worker.globalDecision, 'keep');
  assert.equal(report.worker.selectedDecision, 'review');
  assert.equal(report.worker.strictDecision, 'reject');
  assert.equal(report.worker.motionDecision, 'keep');
  assert.equal(report.worker.multiStrictDecision, 'reject');
  assert.equal(report.worker.multiCount, 2);
  assert.equal(report.worker.originalsUnchanged, true);
  assert.equal(report.worker.grouped[1].winner, true);
  assert.equal(report.worker.grouped[0].compared, true);
  assert.equal(report.worker.grouped[0].decision, 'reject');
  assert.ok(!Object.values(report.worker.intents).includes('reject'));

  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(fixtures.images.map(f => ({ name: f.name, mimeType: 'image/png', buffer: Buffer.from(f.data, 'base64') })));
  await page.getByRole('button', { name: 'Spustit lokální culling', exact: true }).click();
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).waitFor();
  external.length = 0;
  await page.getByRole('checkbox', { name: 'Sbalit série (jeden reprezentant)' }).uncheck();
  for (const n of [1, 2]) await page.getByRole('button', { name: `Vybrat k porovnání DETAIL_000${n}.jpeg`, exact: true }).click();
  await page.getByRole('button', { name: 'Porovnat výběr (2/4)', exact: true }).click();
  const dialog = page.getByRole('dialog'), panels = dialog.getByTestId('culling-compare-panel');
  await page.waitForFunction(() => [...document.querySelectorAll('dialog img')].every(image => image.complete && image.naturalWidth));
  const select = dialog.getByRole('button', { name: 'Označit hlavní motiv', exact: true });
  await select.click();
  await dialog.getByRole('button', { name: '128 px', exact: true }).click();
  const clickPoint = async (x, y) => {
    await select.waitFor();
    const viewport = panels.first().getByTestId('culling-original-image');
    const box = await viewport.boundingBox(), scale = Math.min(box.width / 2048, box.height / 1536);
    await viewport.click({ position: { x: (box.width - 2048 * scale) / 2 + x * scale, y: (box.height - 1536 * scale) / 2 + y * scale } });
  };
  await clickPoint(864, 614);
  await panels.first().getByRole('button', { name: 'Odebrat oblast 1', exact: true }).waitFor();
  await panels.first().getByRole('combobox').selectOption('detail');
  await panels.first().getByRole('button', { name: 'K · Ponechat', exact: true }).click();
  await dialog.getByRole('button', { name: 'Nahrazovat oblasti', exact: true }).click();
  for (const [i, point] of [[200, 200], [400, 1000], [1600, 1000]].entries()) {
    await clickPoint(...point);
    await panels.first().getByRole('button', { name: `Odebrat oblast ${i + 2}`, exact: true }).waitFor();
  }
  await select.click(); // wait for measurement, then leave selection mode
  assert.equal(await panels.first().getByRole('button', { name: /^Odebrat oblast/ }).count(), 4);
  await select.click();
  await clickPoint(1800, 200); // capped at four
  assert.equal(await panels.first().getByRole('button', { name: /^Odebrat oblast/ }).count(), 4);
  await dialog.getByRole('button', { name: 'Použít oblasti na porovnávané', exact: true }).click();
  await panels.nth(1).getByRole('button', { name: 'Odebrat oblast 4', exact: true }).waitFor();
  await panels.first().getByRole('combobox').selectOption('motion');
  await panels.nth(1).getByRole('combobox').selectOption('stack');
  await select.click(); // wait for rescoring to finish
  assert.equal(await panels.first().getByRole('button', { name: 'K · Ponechat', exact: true }).getAttribute('aria-pressed'), 'true');
  await dialog.getByRole('button', { name: 'Zavřít fotografii', exact: true }).click();
  assert.equal(await page.locator('#culling-intent').inputValue(), '');
  await page.locator('#culling-genre').selectOption('landscape');
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).click();
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Porovnat výběr (2/4)', exact: true }).click();
  assert.equal(await panels.first().getByRole('combobox').inputValue(), 'motion');
  assert.equal(await panels.nth(1).getByRole('combobox').inputValue(), 'stack');
  assert.equal(await panels.first().getByRole('button', { name: /^Odebrat oblast/ }).count(), 4);
  assert.equal(await panels.nth(1).getByRole('button', { name: /^Odebrat oblast/ }).count(), 4);
  assert.equal(await panels.first().getByRole('button', { name: 'K · Ponechat', exact: true }).getAttribute('aria-pressed'), 'true');
  await panels.nth(1).getByRole('button', { name: 'Odebrat oblast 4', exact: true }).click();
  await panels.nth(1).getByRole('combobox').selectOption('stack');
  await page.waitForFunction(() => !document.querySelector('dialog select')?.disabled);
  assert.equal(await panels.nth(1).getByRole('button', { name: /^Odebrat oblast/ }).count(), 3);
  await page.screenshot({ path: fileURLToPath(new URL('culling-regions.png', output)), fullPage: true });
  report.ui = { fourRegionLimit: true, copiedRegions: true, removedRegion: true, perPhotoIntents: true,
    preservedOnProfileAndRerun: true, manualPriority: true };
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  report.externalRequests = 0; report.pageErrors = errors;
  await writeFile(new URL('culling-regions.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, worker: { ...report.worker, selected: undefined, reference: undefined } }, null, 2));
} catch (error) {
  await writeFile(new URL('culling-regions-failure.txt', output), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: fileURLToPath(new URL('culling-regions-failure.png', output)), fullPage: true });
  throw error;
} finally { await browser.close(); }
