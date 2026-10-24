// Bounded synthetic 24 MP check. Never opens the normal app profile or private photos.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import assert from 'node:assert/strict';

const output = new URL('../output/playwright/retouch-performance/', import.meta.url);
await mkdir(output, { recursive: true });
const oldSource = execFileSync('git', ['show', 'a7cd48d:components/editor/CanvasViewport.tsx'], { encoding: 'utf8', windowsHide: true });
const baseline = ts.transpileModule(oldSource, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
await writeFile(new URL('before.jsx', output), baseline);
const base = 'http://127.0.0.1:3197';
const server = spawn(process.execPath, ['--max-old-space-size=1536', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3197', '--strictPort'], { stdio: 'ignore', windowsHide: true });
let browser, timer;
try {
  await Promise.race([(async () => {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(ready, 'Local performance server did not start');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url === `${base}/__fast.onnx`) return route.fulfill({ path: fileURLToPath(new URL('../output/playwright/retouch-quality/fast.onnx', import.meta.url)), contentType: 'application/octet-stream' });
      if (/^https?:/.test(url) && new URL(url).origin !== base) { external.push(url); return route.abort(); }
      return route.continue();
    });
    await page.addInitScript(() => {
      window.modelRequests = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          const post = this.postMessage.bind(this);
          this.postMessage = (message, ...rest) => {
            if (String(url).includes('inpaint.worker')) window.modelRequests.push({ type: message.type, model: message.model });
            return post(message, ...rest);
          };
        }
      };
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    external.length = 0;
    await page.evaluate(async () => {
      const reactModule = await import('/node_modules/.vite/deps/react.js');
      const domModule = await import('/node_modules/.vite/deps/react-dom_client.js');
      const React = reactModule.default ?? reactModule;
      const createRoot = domModule.createRoot ?? domModule.default.createRoot;
      const host = document.createElement('div'); host.id = 'performance-fixture';
      Object.assign(host.style, { position: 'fixed', inset: '0', width: '1440px', height: '1000px', zIndex: '99999', background: '#111' });
      document.body.append(host);
      const image = document.createElement('canvas'); image.width = 6000; image.height = 4000;
      const ctx = image.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, 6000, 4000);
      gradient.addColorStop(0, '#24715c'); gradient.addColorStop(1, '#e0c48b'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 6000, 4000);
      window.fixtureImage = URL.createObjectURL(await new Promise(resolve => image.toBlob(resolve, 'image/jpeg', .9)));
      image.width = image.height = 1;
      const original = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(...args) {
        const source = args[0];
        if (source instanceof HTMLImageElement && source.naturalWidth === 6000) window.paintStats.fullPhotoDraws++;
        if (this.filter !== 'none') window.paintStats.blurredPixels += args.length === 9 ? args[3] * args[4] : source.width * source.height;
        return original.apply(this, args);
      };
      window.mountViewport = async path => {
        window.fixtureRoot?.unmount();
        window.fixtureRoot = createRoot(host); window.fixtureRef = React.createRef();
        const Viewport = (await import(path)).default;
        window.renderFixture = processing => window.fixtureRoot.render(React.createElement(Viewport, { ref: window.fixtureRef, imageSrc: window.fixtureImage, activeTool: 'brush', brushSize: 48, brushHardness: .85, processing }));
        window.paintStats = { fullPhotoDraws: 0, blurredPixels: 0 };
        window.renderFixture(false);
      };
    });
    const report = { syntheticOnly: true, dimensions: [6000, 4000], viewport: {} };
    for (const [name, path] of [['before', '/output/playwright/retouch-performance/before.jsx'], ['after', '/components/editor/CanvasViewport.tsx']]) {
      await page.evaluate(path => window.mountViewport(path), path);
      await page.waitForFunction(() => window.fixtureRef?.current?.getImageSize()?.width === 6000);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overlay = page.locator('#performance-fixture canvas').last();
      await page.mouse.move(580, 480); await page.mouse.down();
      const painted = await page.evaluate(() => {
        window.paintStats = { fullPhotoDraws: 0, blurredPixels: 0 };
        const canvas = document.querySelector('#performance-fixture canvas:last-of-type');
        const started = performance.now();
        for (let i = 1; i <= 48; i++) canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: -1, buttons: 1, clientX: 580 + i * 5, clientY: 480 + Math.sin(i / 8) * 24 }));
        return { dispatchMs: performance.now() - started };
      });
      await page.mouse.up();
      const mask = await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const mask = window.fixtureRef.current.getMaskCanvas();
        const bytes = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
        return { ...window.paintStats, hash: digest, width: mask.width, height: mask.height };
      });
      const processing = await page.evaluate(async () => {
        window.paintStats = { fullPhotoDraws: 0, blurredPixels: 0 }; window.renderFixture(true);
        await new Promise(resolve => setTimeout(resolve, 500)); return { ...window.paintStats };
      });
      report.viewport[name] = { ...painted, mask, processing };
    }
    assert.equal(report.viewport.after.mask.hash, report.viewport.before.mask.hash, 'Soft brush pixels changed');
    assert.ok(report.viewport.after.mask.blurredPixels < report.viewport.before.mask.blurredPixels / 4, 'Blur work was not reduced');
    assert.equal(report.viewport.after.processing.fullPhotoDraws, 0, 'Processing redraws the original');
    report.models = await page.evaluate(async () => {
      window.fixtureRoot.unmount();
      const { INPAINT_MODELS } = await import('/utils/inpaintModels.ts');
      await (await caches.open('fm-inpaint-models-v1')).put(INPAINT_MODELS.fast.url, await fetch('/__fast.onnx'));
      const api = await import('/services/localInpaint.ts'); const progress = [];
      const started = performance.now();
      await Promise.all([api.preloadInpaintModel('fast', p => progress.push(p)), api.preloadInpaintModel('fast')]);
      const coldMs = performance.now() - started;
      const warmStart = performance.now();
      for (let i = 0; i < 5; i++) await api.preloadInpaintModel('fast');
      const warmMs = performance.now() - warmStart;
      const source = document.createElement('canvas'); source.width = source.height = 512;
      source.getContext('2d').fillStyle = '#638d91'; source.getContext('2d').fillRect(0, 0, 512, 512);
      const mask = document.createElement('canvas'); mask.width = mask.height = 512;
      mask.getContext('2d').fillRect(230, 230, 32, 32);
      const patch = await api.inpaintRegion(source, mask, 'fast');
      const output = { coldMs, warmMs, inferenceMs: patch.ms, backend: patch.backend, loadRequests: window.modelRequests.filter(m => m.type === 'load').length, networkDownloads: progress.filter(p => p.phase === 'download' && !p.cached).length };
      patch.layer.width = patch.layer.height = 1;
      return output;
    });
    assert.equal(report.models.loadRequests, 1); assert.equal(report.models.networkDownloads, 0);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    report.passed = true;
    await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Performance check exceeded 150 seconds')), 150000); })]);
} finally {
  clearTimeout(timer); await browser?.close(); server.kill();
}
