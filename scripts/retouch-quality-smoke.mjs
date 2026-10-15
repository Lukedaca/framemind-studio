// Synthetic images only. Never opens a normal browser profile or user photographs.
// Place the configured model files in output/playwright/retouch-quality/{fast,quality}.onnx.
import { chromium } from 'playwright';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const base = process.env.EDITOR_SMOKE_URL || 'http://127.0.0.1:3101';
const output = new URL('../output/playwright/retouch-quality/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [], external = [];
const editorOnly = process.env.RETOUCH_SMOKE_EDITOR_ONLY === '1';
const report = { syntheticOnly: true, passed: false, mode: editorOnly ? 'editor-only' : 'full' };
report.runtimeMessages = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (['error', 'warning'].includes(message.type())) { report.runtimeMessages.push(message.text().slice(0, 1600)); console.log(message.text().slice(0, 700)); }
});
page.on('requestfailed', request => report.runtimeMessages.push(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
page.on('response', response => { if (response.status() >= 400) report.runtimeMessages.push(`HTTP ${response.status()}: ${response.url()}`); });
await context.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin) { external.push(url); return route.abort(); }
  return route.continue();
});
const saveDataUrl = async (name, data) => writeFile(new URL(name, output), Buffer.from(data.split(',')[1], 'base64'));
let deadline;
try {
  await Promise.race([
    (async () => {
      await page.goto(base, { waitUntil: 'networkidle' });
      external.length = 0;
      report.geometry = await page.evaluate(async () => {
        const { fitInpaintViewport } = await import('/utils/inpaintMath.ts');
        const { drawInpaintInput } = await import('/utils/inpaintCanvas.ts');
        const cases = [];
        for (const [width, height] of [[1024, 256], [256, 1024], [512, 512]]) {
          const source = document.createElement('canvas'); source.width = width; source.height = height;
          const ctx = source.getContext('2d'); ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(width / 2, height / 2, 60, 0, Math.PI * 2); ctx.fill();
          const viewport = fitInpaintViewport(width, height);
          const input = drawInpaintInput(source, { x: 0, y: 0, width, height }, viewport);
          const pixels = input.getContext('2d').getImageData(viewport.x, viewport.y, viewport.width, viewport.height).data;
          let minX = viewport.width, minY = viewport.height, maxX = -1, maxY = -1;
          for (let y = 0; y < viewport.height; y++) for (let x = 0; x < viewport.width; x++) if (pixels[(y * viewport.width + x) * 4] > 200) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
          cases.push({ source: [width, height], circle: [maxX - minX + 1, maxY - minY + 1], viewport });
        }
        return cases;
      });
      for (const test of report.geometry) assert.ok(Math.abs(test.circle[0] - test.circle[1]) <= 1, 'Model input stretched a circle');

      const saveResult = await page.evaluate(async () => {
        const { encodeCanvas, outputType } = await import('/services/localInpaint.ts');
        const source = document.createElement('canvas'); source.width = 640; source.height = 480;
        const ctx = source.getContext('2d'); const image = ctx.createImageData(640, 480);
        for (let i = 0; i < 640 * 480; i++) image.data.set([(i * 13) % 256, (i * 31) % 256, (i * 7) % 256, 255], i * 4);
        ctx.putImageData(image, 0, 0);
        const original = new Uint8ClampedArray(image.data);
        const decode = async file => { const bitmap = await createImageBitmap(file); ctx.clearRect(0, 0, 640, 480); ctx.drawImage(bitmap, 0, 0); bitmap.close(); };
        const old = document.createElement('canvas'); old.width = 640; old.height = 480; old.getContext('2d').drawImage(source, 0, 0);
        const jpeg = await new Promise(resolve => old.toBlob(resolve, 'image/jpeg', 0.96));
        const oldBitmap = await createImageBitmap(jpeg); old.getContext('2d').drawImage(oldBitmap, 0, 0); oldBitmap.close();
        const oldPixels = old.getContext('2d').getImageData(0, 0, 640, 480).data;
        let oldChanged = 0; for (let i = 0; i < oldPixels.length; i += 4) if (oldPixels[i] !== original[i] || oldPixels[i + 1] !== original[i + 1] || oldPixels[i + 2] !== original[i + 2]) oldChanged++;
        let file;
        for (let pass = 0; pass < 4; pass++) { file = await encodeCanvas(source, 'SYNTHETIC.jpg', 'image/jpeg'); await decode(file); }
        const after = ctx.getImageData(0, 0, 640, 480).data;
        return { name: file.name, type: file.type, outputType: outputType(new File([], 'SYNTHETIC.jpg', { type: 'image/jpeg' })), changedChannelsAfterFourSaves: original.reduce((count, value, i) => count + (value !== after[i] ? 1 : 0), 0), jpegChangedPixelsAfterOneSave: oldChanged, dimensions: [source.width, source.height] };
      });
      report.losslessWorkingCopies = saveResult;
      assert.equal(saveResult.type, 'image/png');
      assert.equal(saveResult.outputType, 'image/png');
      assert.equal(saveResult.name, 'SYNTHETIC.png');
      assert.equal(saveResult.changedChannelsAfterFourSaves, 0);
      assert.ok(saveResult.jpegChangedPixelsAfterOneSave > 0);
      console.log('Geometry and lossless working-copy checks passed.');

      const models = await page.evaluate(async () => (await import('/utils/inpaintModels.ts')).INPAINT_MODELS);
      report.inference = [];
      for (const model of editorOnly ? ['fast'] : ['fast', 'quality']) {
        assert.equal((await stat(new URL(`${model}.onnx`, output))).size, models[model].bytes, `Missing configured ${model} model`);
        await page.evaluate(async ({ model, url }) => {
          const response = await fetch(`/output/playwright/retouch-quality/${model}.onnx`);
          if (!response.ok) throw new Error(`Local model HTTP ${response.status}`);
          await (await caches.open('fm-inpaint-models-v1')).put(url, response);
        }, { model, url: models[model].url });
        if (editorOnly) continue;
        console.log(`${models[model].name}: model cached; running local inference.`);
        const result = await page.evaluate(async model => {
          const { inpaintRegion, encodeCanvas } = await import('/services/localInpaint.ts');
          const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
          const truth = canvas(768, 512); const g = truth.getContext('2d');
          const gradient = g.createLinearGradient(0, 0, 768, 512); gradient.addColorStop(0, '#506f52'); gradient.addColorStop(1, '#b5a87c');
          g.fillStyle = gradient; g.fillRect(0, 0, 768, 512);
          // Deterministic low-contrast texture, so grain matching is exercised too.
          for (let y = 0; y < 512; y += 8) for (let x = 0; x < 768; x += 8) { g.fillStyle = (x / 8 + y / 8) % 2 ? '#ffffff06' : '#00000006'; g.fillRect(x, y, 8, 8); }
          const source = canvas(768, 512); const s = source.getContext('2d'); s.drawImage(truth, 0, 0);
          s.fillStyle = '#ef2040'; s.fillRect(330, 206, 88, 100);
          const before = s.getImageData(0, 0, 768, 512).data;
          const reference = g.getImageData(0, 0, 768, 512).data;
          const mask = canvas(768, 512); const m = mask.getContext('2d'); m.fillStyle = '#fff'; m.fillRect(324, 200, 100, 112);
          const started = performance.now();
          const patch = await inpaintRegion(source, mask, model, undefined, { hardness: 1, strength: 1 });
          const sourceAfterInference = s.getImageData(0, 0, 768, 512).data;
          const sourceUntouched = before.every((value, i) => value === sourceAfterInference[i]);
          const result = canvas(768, 512); const r = result.getContext('2d'); r.drawImage(source, 0, 0); r.drawImage(patch.layer, patch.x, patch.y);
          const fullAlpha = canvas(768, 512); fullAlpha.getContext('2d').drawImage(patch.layer, patch.x, patch.y);
          const alpha = fullAlpha.getContext('2d').getImageData(0, 0, 768, 512).data;
          const after = r.getImageData(0, 0, 768, 512).data;
          let outsideChanged = 0, insideChanged = 0, beforeError = 0, afterError = 0, samples = 0;
          for (let y = 0; y < 512; y++) for (let x = 0; x < 768; x++) {
            const i = (y * 768 + x) * 4;
            const changed = before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2];
            if (alpha[i + 3] === 0 && changed) outsideChanged++;
            if (alpha[i + 3] > 0 && changed) insideChanged++;
            if (x >= 338 && x < 410 && y >= 214 && y < 298) for (let c = 0; c < 3; c++) { beforeError += (before[i + c] - reference[i + c]) ** 2; afterError += (after[i + c] - reference[i + c]) ** 2; samples++; }
          }
          const workingFile = await encodeCanvas(result, 'SYNTHETIC.jpg');
          const decoded = await createImageBitmap(workingFile); const roundtrip = canvas(768, 512); roundtrip.getContext('2d').drawImage(decoded, 0, 0); decoded.close();
          const saved = roundtrip.getContext('2d').getImageData(0, 0, 768, 512).data;
          let roundtripChanges = 0; for (let i = 0; i < saved.length; i++) if (saved[i] !== after[i]) roundtripChanges++;
          return { model: patch.model, backend: patch.backend, inferenceMs: patch.ms, totalMs: Math.round(performance.now() - started), sourceUntouched, outsideChanged, insideChanged, roundtripChanges, beforeMse: Math.round(beforeError / samples), afterMse: Math.round(afterError / samples), before: source.toDataURL('image/png'), after: result.toDataURL('image/png'), truth: truth.toDataURL('image/png') };
        }, model);
        const { before, after, truth, ...metrics } = result;
        await saveDataUrl(`${model}-before.png`, before); await saveDataUrl(`${model}-after.png`, after); await saveDataUrl(`${model}-truth.png`, truth);
        report.inference.push(metrics);
        console.log(JSON.stringify(metrics));
        assert.equal(metrics.model, model);
        assert.equal(metrics.sourceUntouched, true);
        assert.equal(metrics.outsideChanged, 0);
        assert.equal(metrics.roundtripChanges, 0);
        assert.ok(metrics.insideChanged > 0, 'Model did not fill the hole');
        assert.ok(metrics.afterMse < metrics.beforeMse, 'Synthetic object was not improved');
      }

      // Exercise the actual brush, background save, shared history and persistence.
      await page.evaluate(() => {
        localStorage.setItem('fm_inpaint_model', 'fast');
        localStorage.setItem('fm_retouch_brush', JSON.stringify({ size: 80, hardness: 100, strength: 100 }));
      });
      const fixture = Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 768; c.height = 512;
        const ctx = c.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 768, 512);
        g.addColorStop(0, '#506f52'); g.addColorStop(1, '#b5a87c');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 768, 512);
        ctx.fillStyle = '#ef2040'; ctx.beginPath(); ctx.arc(384, 256, 16, 0, Math.PI * 2); ctx.fill();
        return c.toDataURL('image/jpeg', 0.96).split(',')[1];
      }), 'base64');
      const originalHash = createHash('sha256').update(fixture).digest('hex');
      await page.getByRole('button', { name: 'Import 01', exact: true }).click();
      await page.locator('input[type=file]').setInputFiles({ name: 'RETOUCH_UI.jpg', mimeType: 'image/jpeg', buffer: fixture });
      // A single import opens adjustments directly; sets open culling first.
      await page.getByRole('slider').first().waitFor();
      await page.getByText('Uloženo lokálně', { exact: true }).waitFor();
      report.editorImport = await page.evaluate(async () => {
        const data = await (await import('/services/projectStorage.ts')).projectStorage.load();
        const photo = data.workspace.history.present.state[0];
        return { name: photo.file.name, type: photo.file.type, bytes: Array.from(new Uint8Array(await photo.file.arrayBuffer()).slice(0, 4)) };
      });
      await page.getByRole('button', { name: 'Retuš 04', exact: true }).click();
      await page.getByText('Model připraven', { exact: false }).waitFor({ timeout: 90000 });
      const viewport = page.locator('canvas').first();
      const bounds = await viewport.boundingBox();
      assert.ok(bounds && bounds.width > 0 && bounds.height > 0);
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      const waitForType = async type => {
        const until = Date.now() + 60000;
        while (Date.now() < until) {
          const current = await page.evaluate(async () => {
            const data = await (await import('/services/projectStorage.ts')).projectStorage.load();
            return data.workspace?.history.present.state[0]?.file.type;
          });
          if (current === type) return;
          await page.waitForTimeout(250);
        }
        throw new Error(`Stored retouch did not reach ${type}.`);
      };
      const inspect = () => page.evaluate(async () => {
        const data = await (await import('/services/projectStorage.ts')).projectStorage.load();
        const photo = data.workspace.history.present.state[0];
        const digest = async file => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
        const pixels = async file => {
          const image = await createImageBitmap(file); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
          const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0); image.close();
          return { size: [c.width, c.height], corner: Array.from(ctx.getImageData(20, 20, 1, 1).data), center: Array.from(ctx.getImageData(384, 256, 1, 1).data) };
        };
        return { name: photo.file.name, type: photo.file.type, originalHash: await digest(photo.originalFile), workingHash: await digest(photo.file), original: await pixels(photo.originalFile), working: await pixels(photo.file) };
      });
      await waitForType('image/png');
      const retouched = await inspect();
      report.editorSaved = retouched;
      assert.equal(retouched.name, 'RETOUCH_UI.png');
      assert.equal(retouched.originalHash, originalHash);
      assert.deepEqual(retouched.working.size, [768, 512]);
      assert.deepEqual(retouched.working.corner, retouched.original.corner);
      assert.notDeepEqual(retouched.working.center, retouched.original.center);
      await page.getByRole('button', { name: 'Vrátit poslední krok (Ctrl+Z)', exact: true }).click();
      await waitForType('image/jpeg');
      assert.equal((await inspect()).workingHash, originalHash);
      await page.getByRole('button', { name: 'Ctrl+Shift+Z', exact: true }).click();
      await waitForType('image/png');
      assert.equal((await inspect()).workingHash, retouched.workingHash);
      const externalBeforeReload = external.length;
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByText('Uloženo lokálně', { exact: true }).waitFor();
      const restored = await inspect();
      assert.equal(restored.workingHash, retouched.workingHash);
      assert.equal(restored.originalHash, originalHash);
      report.editor = { ...restored, brushSaved: true, undoRestoredOriginal: true, redoRestoredRetouch: true, reloadPreservedRetouch: true };
      await page.screenshot({ path: fileURLToPath(new URL('editor.png', output)), fullPage: true });
      console.log('Editor brush, lossless save, Undo/Redo, reload and original hash checks passed.');
      report.externalRequestsDuringRetouch = externalBeforeReload;
      report.pageErrors = errors;
      assert.equal(report.externalRequestsDuringRetouch, 0);
      assert.deepEqual(errors, []);
      report.passed = true;
    })(),
    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Retouch smoke exceeded 240 seconds.')), 240000); }),
  ]);
} catch (error) {
  report.failure = error.message;
  throw error;
} finally {
  clearTimeout(deadline);
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  await browser.close();
}
