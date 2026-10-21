// Local regression of the real worker and comparison UI; no external requests.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const desktopCdp = process.env.DESKTOP_SMOKE_CDP;
const base = desktopCdp ? 'https://tauri.localhost' : process.env.CULLING_SMOKE_URL ?? 'http://127.0.0.1:3100';
const output = new URL('../output/playwright/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = desktopCdp ? await chromium.connectOverCDP(desktopCdp) : await chromium.launch({ headless: true,
  ...(process.env.CULLING_SMOKE_BROWSER ? { executablePath: process.env.CULLING_SMOKE_BROWSER } : {}) });
const context = desktopCdp ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5 });
const page = desktopCdp ? context.pages().find(page => page.url().startsWith(base)) : await context.newPage();
assert.ok(page, 'No Studio window found');
page.setDefaultTimeout(30000);
const external = [], errors = [], report = {};
await context.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin && !/^https?:\/\/ipc\.localhost\//.test(url)) {
    external.push(url); return route.abort();
  }
  return route.continue();
});
page.on('pageerror', error => errors.push(error.message));
const label = desktopCdp ? 'native-culling-inspection' : 'culling-inspection';
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (desktopCdp) assert.equal(await page.evaluate(() => !!window.__TAURI_INTERNALS__), true);
  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1280;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 1920, 1280);
    // Small sharp subject between the automatic sample locations.
    for (let y = 100; y < 260; y += 4) for (let x = 100; x < 260; x += 4) {
      ctx.fillStyle = (x + y) % 8 ? '#eee' : '#222'; ctx.fillRect(x, y, 4, 4);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles(Array.from({ length: 5 }, (_, i) => ({
    name: `FOCUS_000${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  })));
  await page.getByRole('heading', { name: 'Lokální culling', exact: true }).waitFor();
  external.length = 0;
  await page.getByRole('button', { name: 'Spustit lokální culling', exact: true }).click();
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Sbalit série (jeden reprezentant)' }).uncheck();
  assert.equal(await page.locator('.fm-grid-photos > div').count(), 5);
  assert.equal(await page.locator('.fm-grid-photos > div > button > img').first().evaluate(el => getComputedStyle(el).objectFit), 'contain');
  for (let i = 1; i <= 4; i++) await page.getByRole('button', { name: `Vybrat k porovnání FOCUS_000${i}.jpeg`, exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Vybrat k porovnání FOCUS_0005.jpeg', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Porovnat výběr (4/4)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Fotografie v plném rozlišení' });
  await dialog.waitFor();
  const panels = dialog.getByTestId('culling-compare-panel');
  const originals = dialog.getByTestId('culling-original-image').locator('img');
  await originals.nth(3).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('dialog img')].every(image => image.complete && image.naturalWidth));
  assert.equal(await panels.count(), 4);
  assert.equal(await dialog.getByRole('button', { name: 'Celý snímek', exact: true }).getAttribute('aria-pressed'), 'true');
  for (const viewport of await dialog.getByTestId('culling-original-image').all()) {
    const fit = await viewport.evaluate(area => ({ width: area.clientWidth, height: area.clientHeight,
      scrollWidth: area.scrollWidth, scrollHeight: area.scrollHeight,
      image: area.querySelector('img').getBoundingClientRect().toJSON() }));
    assert.ok(fit.scrollWidth <= fit.width + 1 && fit.scrollHeight <= fit.height + 1,
      'Fit must show the entire image without overflowing its viewport: ' + JSON.stringify(fit));
  }
  report.originalBytes = await originals.first().evaluate(async (element, original) => {
    const displayed = new Uint8Array(await (await fetch(element.src)).arrayBuffer());
    const imported = Uint8Array.from(atob(original), c => c.charCodeAt(0));
    return { identical: displayed.length === imported.length && displayed.every((value, i) => value === imported[i]),
      bytes: displayed.length, width: element.naturalWidth, height: element.naturalHeight };
  }, image);
  assert.equal(report.originalBytes.identical, true);
  assert.equal(report.originalBytes.width, 1920); assert.equal(report.originalBytes.height, 1280);
  await page.screenshot({ path: fileURLToPath(new URL(`${label}-fit.png`, output)), fullPage: true });
  await dialog.getByRole('button', { name: '100%', exact: true }).click();
  report.pixelScale = await originals.first().evaluate(image => ({
    width: image.naturalWidth, height: image.naturalHeight, displayWidth: image.getBoundingClientRect().width,
    dpr: window.devicePixelRatio,
  }));
  assert.ok(Math.abs(report.pixelScale.displayWidth * report.pixelScale.dpr - 1920) < 1);
  await dialog.getByRole('button', { name: '200%', exact: true }).click();
  assert.ok(await originals.first().evaluate(image => Math.abs(image.getBoundingClientRect().width * devicePixelRatio - image.naturalWidth * 2) < 1));
  const viewport = panels.first().getByTestId('culling-original-image');
  const before = await viewport.evaluate(area => ({ x: area.scrollLeft, y: area.scrollTop }));
  const bounds = await viewport.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 - 80, bounds.y + bounds.height / 2 - 60, { steps: 5 }); await page.mouse.up();
  const after = await viewport.evaluate(area => ({ x: area.scrollLeft, y: area.scrollTop }));
  assert.ok(after.x > before.x && after.y > before.y, 'Dragging must move the full image');
  await page.mouse.wheel(0, -200);
  await dialog.getByRole('button', { name: '400%', exact: true }).getAttribute('aria-pressed').then(value => assert.equal(value, 'true'));
  await panels.nth(1).locator('button').first().click();
  await page.keyboard.press('k');
  await panels.nth(1).locator('button[aria-pressed="true"]').filter({ hasText: 'K · Ponechat' }).waitFor();
  assert.equal(await panels.nth(1).getByRole('button', { name: 'K · Ponechat', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, output)), fullPage: true });
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).click();
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).waitFor();
  const card = page.locator('.fm-grid-photos > div').filter({ has: page.getByText('FOCUS_0002.jpeg', { exact: true }) });
  assert.equal(await card.getByText('Ručně', { exact: true }).count(), 1);
  report.fourFrameComparison = true; report.selectionLimit = true; report.dragAndWheelZoom = true;
  report.manualDecisionSurvivesRerun = true;
  await card.getByRole('button', { name: 'Otevřít celou fotografii FOCUS_0002.jpeg', exact: true }).click({ position: { x: 40, y: 50 } });
  await dialog.waitFor();
  assert.equal(await dialog.getByTestId('culling-compare-panel').count(), 1);
  const single = dialog.getByTestId('culling-original-image');
  await single.locator('img').waitFor();
  await page.waitForFunction(() => document.querySelector('dialog img')?.naturalWidth === 1920);
  await page.screenshot({ path: fileURLToPath(new URL(`${label}-single.png`, output)), fullPage: true });
  await single.click();
  assert.equal(await dialog.getByRole('button', { name: '100%', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('0');
  assert.equal(await dialog.getByRole('button', { name: 'Celý snímek', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  report.singleClickFullImage = true;

  if (!desktopCdp) {
    report.worker = await page.evaluate(async image => {
      const { CullingSession } = await import('/services/cullingSession.ts');
      const data = Uint8Array.from(atob(image), c => c.charCodeAt(0));
      const original = new File([data], 'source.png', { type: 'image/png' });
      const source = { id: 'source', file: original, originalFile: original, previewUrl: '', originalPreviewUrl: '' };
      const hash = async file => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].join(',');
      const before = await hash(original), session = new CullingSession();
      try {
        const empty = await session.inspect(source, { x: 0.5, y: 0.5 });
        const subject = await session.inspect(source, { x: 180 / 1920, y: 180 / 1280 });
        const bitmap = await createImageBitmap(subject.image), full = await createImageBitmap(original);
        let exactPixels = false;
        try {
          const a = new OffscreenCanvas(bitmap.width, bitmap.height), b = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ca = a.getContext('2d'), cb = b.getContext('2d'); ca.drawImage(bitmap, 0, 0);
          cb.drawImage(full, subject.region.x, subject.region.y, subject.region.width, subject.region.height, 0, 0, bitmap.width, bitmap.height);
          const aa = ca.getImageData(0, 0, bitmap.width, bitmap.height).data, bb = cb.getImageData(0, 0, bitmap.width, bitmap.height).data;
          exactPixels = aa.every((value, i) => value === bb[i]);
        } finally { bitmap.close(); full.close(); }
        // Reuse is checked against actual worker requests, not a timing guess.
        const initial = await session.analyze(source); session.close();
        const resumed = new CullingSession(), worker = resumed.worker, originalPost = worker.postMessage.bind(worker);
        let analysisRequests = 0;
        worker.postMessage = (...args) => { if (args[0].kind === 'analyze') analysisRequests++; return originalPost(...args); };
        try {
          const reused = await resumed.analyze(source);
          const cachedRequests = analysisRequests;
          await resumed.analyze(source, true);
          return { exactPixels, cropType: subject.image.type, originalUnchanged: before === await hash(original),
            selectedDetail: subject.metrics.technical.laplacianVariance, emptyDetail: empty.metrics.technical.laplacianVariance,
            cachedRequests, forcedRequests: analysisRequests, sameMeasurement: reused === initial };
        } finally { resumed.close(); }
      } finally { session.close(); }
    }, image);
    assert.equal(report.worker.exactPixels, true); assert.equal(report.worker.cropType, 'image/png');
    assert.equal(report.worker.originalUnchanged, true); assert.ok(report.worker.selectedDetail > report.worker.emptyDetail + 10);
    assert.equal(report.worker.cachedRequests, 0); assert.equal(report.worker.forcedRequests, 1); assert.equal(report.worker.sameMeasurement, true);
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  report.externalRequests = external.length; report.pageErrors = errors;
  await writeFile(new URL(`${label}.json`, output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(new URL(`${label}-failure.txt`, output), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: fileURLToPath(new URL(`${label}-failure.png`, output)), fullPage: true });
  throw error;
} finally {
  await context.unrouteAll({ behavior: 'wait' }); await browser.close();
}
