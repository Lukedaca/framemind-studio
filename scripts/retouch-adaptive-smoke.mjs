// Real local inference on synthetic images and an isolated editor profile only.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';

const base = process.env.EDITOR_SMOKE_URL || 'http://127.0.0.1:3101';
const cdp = process.env.DESKTOP_SMOKE_CDP;
const includeHd = process.argv.includes('--hd');
const quick = process.argv.includes('--quick');
const output = new URL('../output/playwright/retouch-adaptive/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch({ headless: true });
const context = cdp ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = cdp ? context.pages()[0] : await context.newPage();
page.setDefaultTimeout(60000);
const report = { passed: false, syntheticOnly: true, native: !!cdp, errors: [], external: [] };
report.runtimeMessages = [];
const modelFile = new URL('../output/playwright/retouch-quality/fast.onnx', import.meta.url);
const modelUrl = 'https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx';
const qualityUrl = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx';
const qualityFile = new URL('../output/playwright/retouch-quality/quality.onnx', import.meta.url);
assert.equal((await stat(modelFile)).size, 28_079_181);
if (includeHd) assert.equal((await stat(qualityFile)).size, 208_044_816);
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.runtimeMessages.push(message.text().slice(0, 1800)); });
page.on('crash', () => report.errors.push('PAGE_CRASHED'));
await context.route('**/*', route => {
  const url = route.request().url();
  if (url === modelUrl) return route.fulfill({ path: fileURLToPath(modelFile), contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
  if (includeHd && url === qualityUrl) return route.fulfill({ path: fileURLToPath(qualityFile), contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
  if (/^https?:/.test(url) && !['127.0.0.1', 'localhost', 'tauri.localhost'].includes(new URL(url).hostname)) {
    report.external.push(url);
    return route.abort();
  }
  return route.continue();
});
let deadline;
try {
  await Promise.race([(async () => {
    if (!cdp) await page.goto(base, { waitUntil: 'networkidle' });
    console.log('Seeding isolated local model cache.');
    // Feed small chunks directly into the isolated cache: no network request,
    // giant base64 message, temporary CSP exception or full-model JS array.
    for (const [url, file] of quick ? [] : [[modelUrl, modelFile], ...(includeHd ? [[qualityUrl, qualityFile]] : [])]) {
      await page.evaluate(url => {
        const state = { controller: null, error: null, promise: null };
        const body = new ReadableStream({ start(controller) { state.controller = controller; } });
        state.promise = caches.open('fm-inpaint-models-v1').then(cache => cache.put(url, new Response(body, { headers: { 'Content-Type': 'application/octet-stream' } })));
        state.promise.catch(error => { state.error = error.message; });
        window.__localRetouchSeed = state;
      }, url);
      for await (const chunk of createReadStream(file, { highWaterMark: 256 * 1024 })) {
        await page.evaluate(async encoded => {
          const state = window.__localRetouchSeed;
          while (state.controller.desiredSize <= 0) {
            if (state.error) throw new Error(state.error);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          if (state.error) throw new Error(state.error);
          state.controller.enqueue(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)));
        }, chunk.toString('base64'));
      }
      await page.evaluate(async () => {
        const state = window.__localRetouchSeed;
        state.controller.close();
        try { await state.promise; } finally { delete window.__localRetouchSeed; }
      });
      console.log(`Cached ${file.pathname.endsWith('fast.onnx') ? 'MI-GAN' : 'LaMa'} in isolated profile.`);
    }
    await page.evaluate(quick => {
      if (quick) localStorage.setItem('fm_retouch_tool', 'clone');
      localStorage.setItem('fm_inpaint_model', 'fast');
      localStorage.setItem('fm_retouch_brush', JSON.stringify({ size: 160, hardness: 100, strength: 100 }));
    }, quick);
    console.log('Model cache seeded; application CSP remains enforced.');
    report.external = [];
    if (!cdp && !quick) {
      report.regions = await page.evaluate(async () => {
        const { inpaintRegion } = await import('/services/localInpaint.ts');
        const make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
        const source = make(2048, 1024), mask = make(2048, 1024);
        const s = source.getContext('2d'), m = mask.getContext('2d');
        s.fillStyle = '#527b48'; s.fillRect(0, 0, 2048, 1024);
        for (let x = 0; x < 2048; x += 12) { s.fillStyle = x % 24 ? '#5a804f' : '#4d7542'; s.fillRect(x, 0, 3, 1024); }
        for (const x of [180, 1760]) { s.fillStyle = '#ee2040'; s.fillRect(x, 450, 96, 96); m.fillStyle = '#fff'; m.fillRect(x - 6, 444, 108, 108); }
        const before = s.getImageData(0, 0, 2048, 1024).data;
        const patch = await inpaintRegion(source, mask, 'fast', undefined, { hardness: 1, strength: 1 });
        const unchanged = s.getImageData(0, 0, 2048, 1024).data;
        const sourceUnchanged = before.every((v, i) => v === unchanged[i]);
        const result = make(2048, 1024), alpha = make(2048, 1024);
        result.getContext('2d').drawImage(source, 0, 0);
        result.getContext('2d').drawImage(patch.layer, patch.x, patch.y);
        alpha.getContext('2d').drawImage(patch.layer, patch.x, patch.y);
        const after = result.getContext('2d').getImageData(0, 0, 2048, 1024).data;
        const coverage = alpha.getContext('2d').getImageData(0, 0, 2048, 1024).data;
        let outsideChanged = 0;
        for (let i = 0; i < before.length; i += 4) if (!coverage[i + 3] && [0, 1, 2].some(c => before[i + c] !== after[i + c])) outsideChanged++;
        let computeStarted = 0, cancelled = false, error;
        try {
          await inpaintRegion(source, mask, 'fast', p => { if (p.phase === 'compute') { computeStarted++; cancelled = true; } }, { hardness: 1, strength: 1, isCancelled: () => cancelled });
        } catch (e) { error = e.message; }
        return { regions: patch.regions, sourceUnchanged, outsideChanged, cancellation: { computeStarted, error }, before: source.toDataURL(), after: result.toDataURL() };
      });
      const { before, after, ...metrics } = report.regions;
      report.regions = metrics;
      await writeFile(new URL('regions-before.png', output), Buffer.from(before.split(',')[1], 'base64'));
      await writeFile(new URL('regions-after.png', output), Buffer.from(after.split(',')[1], 'base64'));
      assert.equal(metrics.regions.length, 2);
      assert.ok(metrics.regions.every(r => r.crop.width === 512 && r.inputSize === 512));
      assert.equal(metrics.sourceUnchanged, true);
      assert.equal(metrics.outsideChanged, 0);
      assert.equal(metrics.cancellation.error, 'INPAINT_CANCELLED');
      assert.equal(metrics.cancellation.computeStarted, 1);
      console.log('Independent regions, unchanged source and cancellation passed.');
    }
    const fixture = Buffer.from(await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 2048; c.height = 1536;
      const g = c.getContext('2d'); g.fillStyle = '#56724b'; g.fillRect(0, 0, c.width, c.height);
      for (let x = 0; x < c.width; x += 16) { g.fillStyle = x % 32 ? '#58784f' : '#526f48'; g.fillRect(x, 0, 3, c.height); }
      g.fillStyle = '#ee2040'; g.fillRect(970, 710, 108, 116);
      return c.toDataURL('image/jpeg', 0.96).split(',')[1];
    }), 'base64');
    await page.getByRole('button', { name: 'Import 01', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'ADAPTIVE_UI.jpg', mimeType: 'image/jpeg', buffer: fixture });
    await page.getByRole('slider').first().waitFor();
    await page.getByText('Uloženo lokálně', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retuš 04', exact: true }).click();
    if (quick) {
      await page.getByRole('radio', { name: 'Klonovat', exact: true }).waitFor();
      await page.waitForTimeout(200);
      const area = await page.locator('main canvas').first().boundingBox();
      const scale = Math.min(area.width / 2048, area.height / 1536) * 0.9;
      const left = area.x + (area.width - 2048 * scale) / 2, top = area.y + (area.height - 1536 * scale) / 2;
      await page.keyboard.down('Alt'); await page.mouse.click(left + 512 * scale, top + 768 * scale); await page.keyboard.up('Alt');
      await page.mouse.click(left + 1024 * scale, top + 768 * scale);
      const read = () => page.evaluate(async () => {
        const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        const db = await request(indexedDB.open('framemind-studio-projects-v2', 1));
        try {
          const snapshot = await request(db.transaction('metadata').objectStore('metadata').get('crm'));
          const photo = snapshot.workspace.history.present.state[0];
          const store = db.transaction('assets').objectStore('assets');
          const [working, original] = await Promise.all([request(store.get(photo.fileKey)), request(store.get(photo.originalKey))]);
          const pixel = async blob => { const image = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d').drawImage(image, 0, 0); image.close(); return Array.from(c.getContext('2d').getImageData(1024, 768, 1, 1).data); };
          return { type: working.type, pixel: await pixel(working.blob), originalPixel: await pixel(original.blob), steps: snapshot.workspace.history.past.length };
        } finally { db.close(); }
      });
      let result;
      for (let i = 0; i < 60; i++) { result = await read(); if (result.type === 'image/png') break; await page.waitForTimeout(100); }
      assert.equal(result.type, 'image/png');
      assert.ok(result.pixel[1] > result.pixel[0], 'Clone must replace the red spot with sampled green texture');
      assert.ok(result.originalPixel[0] > result.originalPixel[1], 'Original must retain its red spot');
      await page.getByRole('button', { name: 'Vrátit poslední krok (Ctrl+Z)', exact: true }).click();
      await page.getByText('Uloženo lokálně', { exact: true }).waitFor();
      report.clone = result; report.passed = true;
      await page.screenshot({ path: fileURLToPath(new URL(cdp ? 'native-tools.png' : 'tools.png', output)) });
      return;
    }
    await page.getByText('Model připraven', { exact: false }).waitFor({ timeout: 180000 });
    const inspect = () => page.evaluate(async () => {
      const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const db = await request(indexedDB.open('framemind-studio-projects-v2', 1));
      try {
        const snapshot = await request(db.transaction('metadata').objectStore('metadata').get('crm'));
        const h = snapshot.workspace.history, photo = h.present.state[0];
        const assets = db.transaction('assets').objectStore('assets');
        const [file, original] = await Promise.all([request(assets.get(photo.fileKey)), request(assets.get(photo.originalKey))]);
        const digest = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
        return { hash: await digest(file.blob), original: await digest(original.blob), past: h.past.length, type: file.type };
      } finally { db.close(); }
    });
    const waitForHistory = async (depth, timeout = 60000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if ((await inspect()).past === depth) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`History did not reach ${depth} entries.`);
    };
    const baseline = await inspect();
    const checkbox = page.getByRole('checkbox', { name: 'Porovnat varianty před použitím', exact: true });
    assert.equal(await checkbox.isChecked(), false);
    await checkbox.check();
    const draw = async (wide = true) => {
      const bounds = await page.locator('main canvas').first().boundingBox();
      assert.ok(bounds);
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      if (!wide) { await page.mouse.click(x, y); return; }
      await page.mouse.move(x - 60, y); await page.mouse.down();
      await page.mouse.move(x + 60, y, { steps: 10 }); await page.mouse.up();
    };
    await draw();
    const dialog = page.getByRole('dialog', { name: 'Vybrat výsledek retuše' });
    await dialog.waitFor();
    console.log('Editor context preview opened.');
    assert.deepEqual(await inspect(), baseline);
    report.variantCount = await dialog.getByRole('radio').count();
    assert.ok(report.variantCount >= 2, 'Large mask must offer genuinely different contexts');
    await dialog.getByRole('button', { name: 'Před retuší', exact: true }).click();
    await dialog.getByRole('button', { name: '100 %', exact: true }).click();
    const scaling = await dialog.locator('canvas').evaluate(c => ({ physical: c.getBoundingClientRect().width * devicePixelRatio, pixels: c.width }));
    assert.ok(Math.abs(scaling.physical - scaling.pixels) < 1);
    await page.screenshot({ path: fileURLToPath(new URL(cdp ? 'native-variants.png' : 'variants.png', output)) });
    await dialog.getByRole('button', { name: 'Zrušit', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await inspect(), baseline);
    await draw(); await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await inspect(), baseline);
    await draw(); await dialog.waitFor();
    await dialog.getByRole('radio', { name: 'Jemný detail', exact: true }).click();
    await dialog.getByRole('button', { name: 'Použít variantu', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByText('Uloženo lokálně', { exact: true }).waitFor();
    {
      await waitForHistory(baseline.past + 1);
      const applied = await inspect();
      assert.equal(applied.original, baseline.original);
      assert.notEqual(applied.hash, baseline.hash);
      assert.equal(applied.past, baseline.past + 1);
      await page.getByRole('button', { name: 'Vrátit poslední krok (Ctrl+Z)', exact: true }).click();
      await waitForHistory(baseline.past);
      assert.equal((await inspect()).hash, baseline.hash);
      await page.getByRole('button', { name: 'Ctrl+Shift+Z', exact: true }).click();
      await waitForHistory(baseline.past + 1);
      assert.equal((await inspect()).hash, applied.hash);
      report.history = { cancelUnchanged: true, escapeUnchanged: true, applyOneStep: true, undoExact: true, redoExact: true, originalHashUnchanged: true };
      console.log('Cancel, Escape, Apply, exact Undo/Redo and original hash passed.');
    }
    const afterApplied = await inspect();
    await page.getByRole('slider').first().focus();
    await page.keyboard.press('Home');
    await draw(false); await dialog.waitFor();
    assert.equal(await dialog.getByRole('radio').count(), 1);
    await dialog.getByRole('button', { name: 'Zrušit', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await inspect(), afterApplied);
    report.duplicateCropsCollapsed = true;
    if (includeHd) {
      await checkbox.uncheck();
      await page.getByRole('radio', { name: /^Detailní/ }).click();
      const hd = page.getByRole('radio', { name: /Vyšší detail/ });
      await hd.waitFor();
      await hd.click();
      await page.getByRole('slider').first().focus(); await page.keyboard.press('End');
      await page.evaluate(() => {
        window.__retouchSizes = [];
        const original = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function(message, ...args) {
          if (message?.type === 'run') window.__retouchSizes.push({ size: message.size, model: message.model });
          return original.call(this, message, ...args);
        };
      });
      await draw(false);
      console.log('Editor HD inference started.');
      await waitForHistory(afterApplied.past + 1, 180000);
      report.hdRuns = await page.evaluate(() => window.__retouchSizes);
      assert.ok(report.hdRuns.some(run => run.model === 'quality' && run.size === 1024));
      assert.equal((await inspect()).original, baseline.original);
      assert.equal(await page.evaluate(() => localStorage.getItem('fm_inpaint_resolution')), '1024');
      await page.screenshot({ path: fileURLToPath(new URL(cdp ? 'native-hd.png' : 'hd.png', output)) });
    }
    report.cancelAndApply = true;
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.external, []);
    report.passed = true;
  })(), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Adaptive retouch smoke exceeded its time limit.')), includeHd ? 480000 : 240000); })]);
} catch (error) {
  report.failure = error.stack || String(error);
  if (!page.isClosed()) {
    try { report.visibleText = (await page.locator('body').innerText({ timeout: 3000 })).slice(0, 12000); } catch {}
    try { await page.screenshot({ path: fileURLToPath(new URL(cdp ? 'native-failure.png' : 'failure.png', output)), timeout: 5000 }); } catch {}
  }
  throw error;
} finally {
  clearTimeout(deadline);
  await writeFile(new URL(cdp ? 'native-report.json' : 'report.json', output), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
