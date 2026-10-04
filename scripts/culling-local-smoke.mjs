// Optional local verification. Install Playwright separately; see CONTRIBUTING.md.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const desktopCdp = process.env.DESKTOP_SMOKE_CDP;
const replyNativeDialog = (action) => promisify(execFile)('pwsh', [
  '-NoProfile', '-File', fileURLToPath(new URL('windows-dialog-smoke.ps1', import.meta.url)),
  '-AppProcessId', process.env.DESKTOP_SMOKE_PID, '-Action', action,
], { windowsHide: true, timeout: 25000 });
if (desktopCdp) assert.ok(process.env.DESKTOP_SMOKE_PID, 'Set DESKTOP_SMOKE_PID to the FrameMind Studio process ID');
const base = desktopCdp ? 'https://tauri.localhost' : (process.env.CULLING_SMOKE_URL ?? 'http://127.0.0.1:3100');
const output = new URL('../output/playwright/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = desktopCdp ? await chromium.connectOverCDP(desktopCdp) : await chromium.launch({ headless: true,
  ...(process.env.CULLING_SMOKE_BROWSER ? { executablePath: process.env.CULLING_SMOKE_BROWSER } : {}) });
const context = desktopCdp ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const external = [], errors = [], report = {};
await context.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin && !/^https?:\/\/ipc\.localhost\//.test(url)) { external.push(url); return route.abort(); }
  return route.continue();
});
const page = desktopCdp ? context.pages().find(page => page.url().startsWith(base)) : await context.newPage();
assert.ok(page, 'No FrameMind Studio WebView found');
page.on('pageerror', error => errors.push(error.message));
const ready = () => page.waitForFunction(() => {
  const profile = document.querySelector('#culling-genre'); return profile && !profile.disabled;
});
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (desktopCdp) {
    report.desktop = await page.evaluate(() => ({
      tauri: !!window.__TAURI_INTERNALS__, origin: location.origin,
      secureContext: isSecureContext, crossOriginIsolated,
      offscreenCanvas: typeof OffscreenCanvas === 'function',
    }));
    assert.equal(report.desktop.tauri, true);
    assert.equal(report.desktop.secureContext, true);
  }
  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  const images = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1280;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#6b8260'; ctx.fillRect(0, 0, 1920, 1280);
    for (let y = 0; y < 1280; y += 32) for (let x = 0; x < 1920; x += 32) {
      ctx.fillStyle = ((x / 32 + y / 32) % 2) ? '#9bb89a' : '#384a36'; ctx.fillRect(x, y, 30, 30);
    }
    ctx.fillStyle = '#d09851'; ctx.fillRect(700, 350, 420, 650);
    const image = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1280);
    return { image, black: canvas.toDataURL('image/jpeg').split(',')[1] };
  });
  const file = (name, data = images.image) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64') });
  await page.locator('input[type=file]').setInputFiles([file('IMG_0001.jpg'), file('IMG_0002.jpg'), file('IMG_0003.jpg', images.black)]);
  await page.getByRole('heading', { name: 'Lokální culling', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Gemini API/ }).count(), 0);
  external.length = 0;
  await page.getByRole('button', { name: 'Spustit lokální culling', exact: true }).click();
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByText('Chyba čtení / obnov import', { exact: true }).count(), 0);
  await page.getByRole('checkbox', { name: 'Sbalit série (jeden reprezentant)' }).uncheck();
  assert.equal(await page.locator('.fm-grid-photos > div').count(), 3);
  const namedCard = name => page.locator('.fm-grid-photos > div').filter({ has: page.getByText(name, { exact: true }) });
  assert.match(await namedCard('IMG_0002.jpg').innerText(), /Nadbytečný téměř totožný záběr/);
  assert.match(await namedCard('IMG_0003.jpg').innerText(), /Téměř celý náhled bez jasových dat/);
  report.automaticRejectSuggestions = 2;
  await namedCard('IMG_0002.jpg').click({ position: { x: 10, y: 80 } });
  await page.keyboard.press('k');
  await namedCard('IMG_0003.jpg').click({ position: { x: 10, y: 80 } });
  await page.keyboard.press('r');
  const card = () => page.locator('.fm-grid-photos > div').filter({ has: page.getByText('IMG_0001.jpg', { exact: true }) });
  await card().click({ position: { x: 10, y: 80 } }); await page.getByTestId('culling-detail').waitFor();
  assert.match(await page.getByTestId('culling-detail').innerText(), /768 × 512/);
  await page.keyboard.press('x');
  assert.equal(await card().getByText('Ručně', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).click();
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await card().getByText('Ručně', { exact: true }).count(), 1, 'Manual choice lost on rerun');
  assert.equal(await namedCard('IMG_0002.jpg').getByText('Ručně', { exact: true }).count(), 1, 'Manual keep override lost on rerun');
  assert.equal(await namedCard('IMG_0003.jpg').getByText('Ručně', { exact: true }).count(), 1, 'Manual review override lost on rerun');
  await page.locator('#culling-genre').selectOption('product'); await ready();
  assert.equal(await card().getByText('Ručně', { exact: true }).count(), 1, 'Manual choice lost on profile change');
  const remove = page.getByRole('button', { name: 'Odebrat vyřazené ze sady (1)', exact: true });
  const dismiss = desktopCdp ? replyNativeDialog('dismiss') : null;
  if (!desktopCdp) page.once('dialog', dialog => dialog.dismiss());
  await remove.click();
  if (dismiss) await dismiss;
  assert.equal(await card().count(), 1);
  const accept = desktopCdp ? replyNativeDialog('accept') : null;
  if (!desktopCdp) page.once('dialog', dialog => dialog.accept());
  await remove.click();
  if (accept) await accept;
  await page.getByText('IMG_0001.jpg', { exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.locator('.fm-grid-photos > div').count(), 2);
  report.importAndMeasurements = true; report.manualRerunAndProfile = true; report.confirmedRemoval = true;
  await page.screenshot({ path: fileURLToPath(new URL('culling-local-desktop.png', output)), fullPage: true });
  await writeFile(new URL('culling-local-snapshot.txt', output), await page.locator('body').ariaSnapshot());
  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(Array.from({ length: 60 }, (_, i) => file('BURST_' + (i + 10) + '.jpg')));
  await page.getByRole('heading', { name: 'Lokální culling', exact: true }).waitFor();
  await page.getByRole('button', { name: /Spustit (znovu|lokální culling)/ }).click();
  await page.getByRole('button', { name: 'Zastavit', exact: true }).click();
  await ready();
  await page.getByText('Běh zastaven. Dokončená měření zůstávají.', { exact: true }).waitFor();
  report.cancelledUiRun = true;
  if (!desktopCdp) report.worker = await page.evaluate(async data => {
    const { CullingSession } = await import('/services/cullingSession.ts');
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const file = new File([bytes], 'worker.jpg', { type: 'image/jpeg' });
    const hash = async () => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].join(',');
    const before = await hash(), session = new CullingSession();
    try {
      const analysis = await session.analyze({ id: 'test', file, originalFile: file, previewUrl: '', originalPreviewUrl: '' });
      const result = await session.score(analysis, 'sport');
      return { width: analysis.metrics.technical.width, height: analysis.metrics.technical.height,
        version: result.engineVersion, score: result.finalScore, originalUnchanged: before === await hash(),
        aiPresent: 'ai' in result, signatureLength: analysis.metrics.signature.luma.length };
    } finally { session.close(); }
  }, images.image);
  if (!desktopCdp) {
    assert.equal(report.worker.version, 'local-1.1'); assert.equal(report.worker.originalUnchanged, true);
    assert.equal(report.worker.aiPresent, false); assert.equal(report.worker.signatureLength, 1024);
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  report.externalRequests = external.length; report.pageErrors = errors;
  await writeFile(new URL(desktopCdp ? 'desktop-culling-smoke.json' : 'culling-local-smoke.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ pageErrors: errors, externalRequests: external, desktop: report.desktop }));
  await writeFile(new URL('culling-local-failure.txt', output), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: fileURLToPath(new URL('culling-local-failure.png', output)), fullPage: true });
  throw error;
} finally {
  await context.unrouteAll({ behavior: 'wait' });
  await browser.close();
}
