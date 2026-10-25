// Synthetic photos and a fresh isolated profile only; never point this at a normal workspace.
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const native = Boolean(process.env.DESKTOP_SMOKE_CDP);
if (native) assert.equal(process.env.DESKTOP_SMOKE_ISOLATED, '1', 'Native checks require an explicitly isolated profile');
const base = native ? 'https://tauri.localhost' : process.env.EDITOR_SMOKE_URL || 'http://127.0.0.1:3106';
const root = new URL('../output/playwright/', import.meta.url);
await mkdir(root, { recursive: true });
const output = await mkdtemp(fileURLToPath(new URL(`workspace-clear-${native ? 'native' : 'browser'}-`, root)));
const profile = native ? null : `${output}/profile`;
const report = { native, syntheticOnly: true, output };
const errors = [];
let browser, context, page;
const launch = async () => {
  if (native) {
    browser = await chromium.connectOverCDP(process.env.DESKTOP_SMOKE_CDP);
    context = browser.contexts()[0];
    page = context.pages().find(item => item.url().startsWith(base));
    assert.ok(page, 'Studio WebView was not found');
  } else {
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => /^https?:/.test(route.request().url()) && new URL(route.request().url()).origin !== new URL(base).origin ? route.abort() : route.continue());
    page = context.pages()[0] || await context.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
  }
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
};
const saved = () => page.getByText('Uloženo lokálně', { exact: true }).waitFor();
const snapshot = () => page.evaluate(async () => {
  const request = indexedDB.open('framemind-studio-projects-v2', 1);
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    const tx = db.transaction(['metadata', 'assets']);
    const get = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [metadata, keys, values] = await Promise.all([get(tx.objectStore('metadata').get('crm')), get(tx.objectStore('assets').getAllKeys()), get(tx.objectStore('assets').getAll())]);
    const assets = await Promise.all(values.map(async (asset, i) => ({ key: keys[i], name: asset.name, hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await asset.blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('') })));
    return { metadata, assets };
  } finally { db.close(); }
});
const assertEmpty = data => {
  assert.equal(data.metadata.workspace.projectId, null);
  assert.equal(data.metadata.workspace.activeFileId, null);
  assert.deepEqual(data.metadata.workspace.history.past, []);
  assert.deepEqual(data.metadata.workspace.history.present.state, []);
  assert.deepEqual(data.metadata.workspace.history.future, []);
};
const clear = async accept => {
  const dialog = native
    ? promisify(execFile)('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('windows-dialog-smoke.ps1', import.meta.url)), '-AppProcessId', process.env.DESKTOP_SMOKE_PID, '-Action', accept ? 'accept' : 'dismiss'], { windowsHide: true, timeout: 25000 })
    : page.waitForEvent('dialog').then(dialog => accept ? dialog.accept() : dialog.dismiss());
  await page.getByRole('button', { name: 'Vyprázdnit sadu', exact: true }).click();
  await dialog;
};
const importPhotos = async paths => {
  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(paths);
  await saved();
};

try {
  await launch();
  await saved();
  const initial = await snapshot();
  assert.deepEqual(initial.metadata.projects, [], 'Refusing to change an existing profile');
  assert.deepEqual(initial.metadata.clients, [], 'Refusing to change an existing profile');
  assertEmpty(initial);
  assert.equal(await page.getByRole('button', { name: 'Vyprázdnit sadu', exact: true }).isDisabled(), true);

  const images = await page.evaluate(() => ['A', 'B', 'C'].map((letter, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = ['#183124', '#123858', '#623146'][i]; ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = '#efb777'; ctx.font = '100px sans-serif'; ctx.fillText(letter, 100, 160);
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  }));
  const paths = images.map((_, i) => `${output}/CLEAR_${String.fromCharCode(65 + i)}.jpg`);
  for (let i = 0; i < paths.length; i++) await writeFile(paths[i], Buffer.from(images[i], 'base64'));
  const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
  const originalHashes = await Promise.all(paths.map(hash));
  await importPhotos(paths.slice(0, 2));
  await page.getByRole('button', { name: 'Úpravy 03', exact: true }).click();
  await page.getByRole('slider').first().fill('25');
  await saved();
  const beforeCancel = await snapshot();
  await clear(false);
  assert.deepEqual((await snapshot()).metadata.workspace, beforeCancel.metadata.workspace);
  assert.deepEqual((await snapshot()).assets, beforeCancel.assets);
  report.cancelPreservesPhotosAndHistory = true;

  // Hold a real non-JPEG import open while clearing the previous set.
  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  const latePng = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function(file) {
      if (file.name === 'LATE.png') window.__releaseLateImport = () => read.call(this, file);
      else read.call(this, file);
    };
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    URL.createObjectURL = file => { const url = create.call(URL, file); if (file.name === 'LATE.jpeg') window.__lateUrl = url; return url; };
    URL.revokeObjectURL = url => { if (url === window.__lateUrl) window.__lateDiscarded = true; return revoke.call(URL, url); };
    window.__restoreImportHooks = () => { FileReader.prototype.readAsDataURL = read; URL.createObjectURL = create; URL.revokeObjectURL = revoke; };
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'LATE.png', mimeType: 'image/png', buffer: Buffer.from(latePng, 'base64') });
  await page.waitForFunction(() => typeof window.__releaseLateImport === 'function');
  await clear(true);
  await saved();
  assertEmpty(await snapshot());
  await page.evaluate(() => window.__releaseLateImport());
  await page.waitForFunction(() => window.__lateDiscarded === true);
  await page.evaluate(() => window.__restoreImportHooks());
  assertEmpty(await snapshot());
  assert.deepEqual((await snapshot()).assets, []);
  report.pendingImportCannotRestoreClearedPhotos = true;

  await importPhotos(paths.slice(0, 2));
  await saved();
  // A saved project references its current photo plus separate past/future image assets.
  await page.evaluate(async () => {
    const request = indexedDB.open('framemind-studio-projects-v2', 1);
    const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['metadata', 'assets'], 'readwrite');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    const metadata = tx.objectStore('metadata'), assets = tx.objectStore('assets');
    const get = metadata.get('crm');
    get.onsuccess = () => {
      const data = get.result, photo = data.workspace.history.present.state[0];
      const asset = assets.get(photo.fileKey);
      asset.onsuccess = () => {
        const historyPhoto = suffix => {
          const key = `kept-${suffix}`; assets.put({ ...asset.result, name: `${suffix}.jpg` }, key);
          return { ...photo, id: suffix, fileKey: key, originalKey: key, baseKey: key };
        };
        const past = historyPhoto('past'), future = historyPhoto('future');
        assets.put({ ...asset.result, name: 'unreferenced.jpg' }, 'old-orphan');
        const now = new Date().toISOString();
        data.clients = [{ id: 'kept-client', name: 'Synthetic client', email: '', createdAt: now }];
        data.projects = [{ id: 'kept-project', clientId: 'kept-client', name: 'Synthetic saved project', type: 'portrait', status: 'editing', date: '2026-10-25', files: [photo], editorHistory: { past: [{ state: [past], actionName: 'Past' }], present: { state: [photo], actionName: 'Saved' }, future: [{ state: [future], actionName: 'Future' }] }, editorActiveFileId: photo.id, gallery: { published: false, selectedFileIds: [], allowDownload: true }, activity: [], createdAt: now, updatedAt: now }];
        metadata.put(data, 'crm');
      };
    };
    await done; db.close();
  });
  await page.goto(`${base}/projects/kept-project`, { waitUntil: 'networkidle' });
  await saved();
  const beforeFailure = await snapshot();
  assert.equal(beforeFailure.metadata.workspace.projectId, 'kept-project');
  assert.equal(beforeFailure.assets.length, 5);

  // Abort after the cleanup cursor has visited every asset: deletions and metadata must roll back.
  await page.evaluate(() => {
    const open = IDBObjectStore.prototype.openKeyCursor;
    IDBObjectStore.prototype.openKeyCursor = function(...args) {
      const request = open.apply(this, args), tx = this.transaction;
      if (this.name === 'assets') request.addEventListener('success', () => { if (!request.result) tx.abort(); });
      return request;
    };
    window.__restoreCursor = () => { IDBObjectStore.prototype.openKeyCursor = open; };
  });
  await clear(true);
  await page.getByText('Uložení selhalo — práce zatím zůstává v této relaci.', { exact: false }).waitFor();
  const failed = await snapshot();
  assert.deepEqual(failed.assets, beforeFailure.assets);
  assert.deepEqual(failed.metadata, beforeFailure.metadata);
  report.failedClearIsAtomic = true;
  await page.evaluate(() => window.__restoreCursor());
  await page.getByRole('button', { name: 'Zkusit znovu', exact: true }).click();
  await saved();
  const cleared = await snapshot();
  assertEmpty(cleared);
  assert.equal(new URL(page.url()).pathname, '/');
  assert.deepEqual(cleared.metadata.projects, beforeFailure.metadata.projects);
  assert.deepEqual(cleared.metadata.clients, beforeFailure.metadata.clients);
  assert.equal(cleared.assets.length, 3);
  for (const asset of cleared.assets) assert.deepEqual(asset, beforeFailure.assets.find(item => item.key === asset.key));
  report.retryClearsWorkspaceAndOrphans = true;
  report.savedProjectAndUndoRedoAssetsPreserved = true;

  if (!native) { await context.close(); await launch(); } else await page.reload({ waitUntil: 'networkidle' });
  await saved();
  assertEmpty(await snapshot());
  report.emptySetSurvivesRestart = !native;
  report.emptySetSurvivesReload = true;
  await importPhotos([paths[2]]);
  await page.getByText('CLEAR_C.jpg', { exact: true }).waitFor();
  const fresh = await snapshot();
  assert.equal(fresh.metadata.workspace.history.present.state.length, 1);
  assert.equal(fresh.assets.length, 4);
  await page.getByRole('button', { name: 'Vrátit poslední krok (Ctrl+Z)', exact: true }).click();
  await saved();
  assert.equal((await snapshot()).metadata.workspace.history.present.state.length, 0);
  assert.equal((await snapshot()).metadata.workspace.history.future.length, 1);
  await clear(true);
  await saved();
  assertEmpty(await snapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await saved();
  assertEmpty(await snapshot());
  assert.equal((await snapshot()).assets.length, 3);
  report.redoOnlyWorkspaceCanBeCleared = true;
  report.newImportStartsFresh = true;
  assert.deepEqual(await Promise.all(paths.map(hash)), originalHashes);
  report.originalDiskFilesUnchanged = true;
  assert.deepEqual(errors, []);
  report.pageErrors = errors;
  await page.screenshot({ path: `${output}/cleared.png`, fullPage: true });
  await writeFile(`${output}/snapshot.txt`, await page.locator('body').ariaSnapshot());
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error);
  if (page) await writeFile(`${output}/failure.txt`, await page.locator('body').ariaSnapshot()).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  if (native) await browser?.close(); else await context?.close();
}
