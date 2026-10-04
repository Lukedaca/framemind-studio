// Windows-only optional check of the installed Tauri app; see docs/desktop.md.
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

assert.ok(process.env.DESKTOP_SMOKE_CDP && process.env.DESKTOP_SMOKE_PID, 'Set DESKTOP_SMOKE_CDP and DESKTOP_SMOKE_PID');
const output = new URL(`../output/playwright/export-${Date.now()}/`, import.meta.url);
const batch = new URL('batch/', output);
await mkdir(batch, { recursive: true });
const reply = (action, path = '') => promisify(execFile)('pwsh', [
  '-NoProfile', '-File', fileURLToPath(new URL('windows-dialog-smoke.ps1', import.meta.url)),
  '-AppProcessId', process.env.DESKTOP_SMOKE_PID, '-Action', action, '-FilePath', path,
], { windowsHide: true, timeout: 25000 });
const browser = await chromium.connectOverCDP(process.env.DESKTOP_SMOKE_CDP);
const context = browser.contexts()[0];
const page = context.pages().find(page => page.url().startsWith('https://tauri.localhost'));
assert.ok(page, 'No FrameMind Studio WebView found');
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && message.text().includes('Export failed:')) errors.push(message.text()); });
const report = {};
const waitFile = async path => {
  await page.waitForFunction(() => !document.body.innerText.includes('Exportuji dávku...'));
  for (let i = 0; i < 100; i++) {
    try { const bytes = await readFile(path); if (bytes.length) return bytes; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Export missing: ${path}`);
};
try {
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 96;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#568967'; ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = '#dfa354'; ctx.fillRect(20, 10, 60, 70);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  const originalPaths = ['IMG_9001.jpg', 'IMG_9002.jpg'].map(name => new URL(name, output));
  for (const path of originalPaths) await writeFile(path, Buffer.from(jpeg, 'base64'));
  const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
  const hashes = await Promise.all(originalPaths.map(hash));
  await page.locator('input[type=file]').setInputFiles(originalPaths.map(fileURLToPath));
  await page.getByRole('button', { name: 'Export 05', exact: true }).click();
  const saveAs = page.getByRole('button', { name: 'Uložit jako...', exact: true });
  await saveAs.waitFor();
  const dismiss = reply('dismiss'); await saveAs.click(); await dismiss;
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Uložit jako...' && !button.disabled));
  assert.deepEqual((await readdir(output)).sort(), ['IMG_9001.jpg', 'IMG_9002.jpg', 'batch']);
  report.cancelledSave = true;

  const jpegPath = fileURLToPath(new URL('saved.jpg', output));
  const saveJpeg = reply('save', jpegPath); await saveAs.click(); await saveJpeg;
  const jpegBytes = await waitFile(jpegPath);
  assert.deepEqual([...jpegBytes.subarray(0, 3)], [255, 216, 255]);
  report.jpegBytes = jpegBytes.length;

  await page.getByRole('radio', { name: 'PNG', exact: true }).click();
  const pngPath = fileURLToPath(new URL('saved.png', output));
  const savePng = reply('save', pngPath);
  await page.getByRole('button', { name: 'Stáhnout obrázek', exact: true }).click(); await savePng;
  const pngBytes = await waitFile(pngPath);
  assert.deepEqual([...pngBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(pngBytes.readUInt32BE(16), 128); assert.equal(pngBytes.readUInt32BE(20), 96);
  report.pngDimensions = [128, 96];

  const saveBatch = reply('directory', fileURLToPath(batch));
  await page.getByRole('button', { name: 'Uložit vše do složky (2)', exact: true }).click(); await saveBatch;
  await waitFile(fileURLToPath(new URL('edited_IMG_9001.png', batch)));
  await waitFile(fileURLToPath(new URL('edited_IMG_9002.png', batch)));
  report.batchFiles = await readdir(batch);
  assert.deepEqual(await Promise.all(originalPaths.map(hash)), hashes);
  report.originalsUnchanged = true;
  assert.deepEqual(errors, []);
  report.pageErrors = errors;
  await writeFile(new URL('../desktop-export-smoke.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ errors, output: fileURLToPath(output) }));
  await writeFile(new URL('failure.txt', output), await page.locator('body').ariaSnapshot());
  throw error;
} finally { await browser.close(); }
