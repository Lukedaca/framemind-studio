// Synthetic images only. The browser profile is isolated inside ignored output/playwright/.
import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.EDITOR_SMOKE_URL || 'http://127.0.0.1:3101';
const output = new URL('../output/playwright/', import.meta.url);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(fileURLToPath(new URL('history-profile-', output)));
const errors = [];
const report = { syntheticOnly: true, isolatedProfile: profile };
let context;
async function launch() {
  context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => /^https?:/.test(route.request().url()) && new URL(route.request().url()).origin !== new URL(base).origin ? route.abort() : route.continue());
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  return page;
}
const workspace = page => page.evaluate(async () => (await (await import('/services/projectStorage.ts')).projectStorage.load()).workspace);
const saved = async page => { await page.getByText('Uloženo lokálně', { exact: true }).waitFor(); return workspace(page); };
const value = page => page.getByRole('slider').first().inputValue();
const undo = page => page.getByRole('button', { name: 'Vrátit poslední krok (Ctrl+Z)', exact: true }).click();
const redo = page => page.getByRole('button', { name: 'Ctrl+Shift+Z', exact: true }).click();

try {
  let page = await launch();
  const fixtures = await page.evaluate(() => ['A', 'B'].map((name, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 640;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 960, 640);
    gradient.addColorStop(0, index ? '#122b48' : '#183124'); gradient.addColorStop(1, '#d6ad79');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 960, 640);
    ctx.fillStyle = '#e2aa51'; ctx.fillRect(150, 100, 300, 440);
    ctx.fillStyle = '#fff'; ctx.font = '90px sans-serif'; ctx.fillText(name, 550, 300);
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  }));
  const buffers = fixtures.map(data => Buffer.from(data, 'base64'));
  const hashes = buffers.map(buffer => createHash('sha256').update(buffer).digest('hex'));
  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(buffers.map((buffer, i) => ({ name: `HISTORY_${i ? 'B' : 'A'}.jpg`, mimeType: 'image/jpeg', buffer })));
  await page.getByRole('heading', { name: 'Lokální culling', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Úpravy 03', exact: true }).click();
  let state = await saved(page);
  const beforeDrag = state.history.past.length;
  const slider = page.getByRole('slider').first();
  const bounds = await slider.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height / 2, { steps: 14 });
  await page.mouse.up();
  const dragged = await value(page);
  assert.notEqual(dragged, '0');
  state = await saved(page);
  assert.equal(state.history.past.length, beforeDrag + 1, 'A drag created more than one history entry');
  await slider.focus();
  await page.keyboard.press('Control+z');
  assert.equal(await value(page), '0');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await value(page), dragged);
  report.dragIsOneStep = true;
  report.undoWhileSliderFocused = true;

  const beforeNoop = (await saved(page)).history.past.length;
  await slider.dispatchEvent('pointerdown', { pointerId: 7 });
  await slider.fill('75');
  await slider.fill(dragged);
  await slider.dispatchEvent('pointerup', { pointerId: 7 });
  assert.equal((await saved(page)).history.past.length, beforeNoop, 'A no-op gesture consumed history');
  report.noopGesture = true;

  await slider.fill('35');
  await page.getByRole('button', { name: 'HISTORY_B.jpg', exact: true }).click();
  assert.equal(await value(page), '0');
  await page.getByRole('slider').first().fill('-20');
  await page.getByRole('button', { name: 'HISTORY_A.jpg', exact: true }).click();
  assert.equal(await value(page), '35');
  const cropBefore = (await saved(page)).history.past.length;
  await page.getByRole('radio', { name: '1:1', exact: true }).click();
  assert.equal((await saved(page)).history.past.length, cropBefore + 1);
  await undo(page);
  assert.equal(await page.getByRole('radio', { name: 'Původní', exact: true }).getAttribute('aria-checked'), 'true');
  await redo(page);
  assert.equal(await page.getByRole('radio', { name: '1:1', exact: true }).getAttribute('aria-checked'), 'true');
  await page.getByRole('button', { name: 'Automaticky', exact: true }).click();
  await saved(page);
  await undo(page);
  assert.equal(await value(page), '35', 'Auto adjustment did not undo in one step');
  report.cropAndAutoUndo = true;

  await page.getByRole('button', { name: 'Obnovit originál', exact: true }).click();
  assert.equal(await value(page), '0');
  assert.equal(await page.getByRole('radio', { name: 'Původní', exact: true }).getAttribute('aria-checked'), 'true');
  await undo(page);
  assert.equal(await value(page), '35');
  assert.equal(await page.getByRole('radio', { name: '1:1', exact: true }).getAttribute('aria-checked'), 'true');
  report.restoreIsUndoable = true;
  await page.getByRole('button', { name: 'Přehled', exact: true }).click();
  await page.getByRole('button', { name: 'Úpravy 03', exact: true }).click();
  assert.equal(await value(page), '35', 'View navigation discarded adjustments');
  await saved(page);

  const inspect = async page => page.evaluate(async () => {
    const { projectStorage } = await import('/services/projectStorage.ts');
    const data = await projectStorage.load();
    const hashes = await Promise.all(data.workspace.history.present.state.map(async photo => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await photo.originalFile.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('')));
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('framemind-studio-projects-v2', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const assetCount = await new Promise((resolve, reject) => { const r = db.transaction('assets').objectStore('assets').count(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close();
    return { hashes, assetCount, future: data.workspace.history.future.length };
  });
  let inspected = await inspect(page);
  assert.deepEqual(inspected.hashes, hashes);
  assert.equal(inspected.assetCount, 2, 'Slider edits duplicated photo assets');
  assert.equal(inspected.future, 1);
  await context.close();
  page = await launch();
  await page.getByRole('slider').first().waitFor();
  assert.equal(await value(page), '35', 'Browser restart discarded adjustments');
  assert.equal(await page.getByRole('radio', { name: '1:1', exact: true }).getAttribute('aria-checked'), 'true');
  await redo(page);
  assert.equal(await value(page), '0', 'Redo did not survive restart');
  await undo(page);
  assert.equal(await value(page), '35');
  inspected = await inspect(page);
  assert.deepEqual(inspected.hashes, hashes);
  assert.equal(inspected.assetCount, 2);
  report.fullBrowserRestart = true;
  report.originalHashesUnchanged = true;
  report.uniqueAssetsAfterEditsAndRestart = inspected.assetCount;

  report.storage = await page.evaluate(async () => {
    const { IndexedDbProjectStorage } = await import('/services/indexedDbProjectStorage.ts');
    const { createHistory, INITIAL_EDITS, applyFileEdits } = await import('/utils/editorHistory.ts');
    const file = new File(['synthetic original'], 'synthetic.jpg', { type: 'image/jpeg' });
    const photo = { id: 'storage-photo', file, baseFile: file, originalFile: file, previewUrl: 'blob:synthetic', originalPreviewUrl: 'blob:synthetic' };
    const name = `history-atomic-test-${Date.now()}`;
    const storage = new IndexedDbProjectStorage(name);
    const data = { clients: [], projects: [], workspace: { projectId: null, activeFileId: photo.id, history: createHistory([photo]) } };
    await storage.save(data);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'metadata') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return put.apply(this, args);
    };
    const nextFile = new File(['synthetic retouch'], 'synthetic.jpg');
    const next = { ...data, workspace: { ...data.workspace, history: createHistory([{ ...photo, file: nextFile, previewUrl: 'blob:retouch', edits: { ...INITIAL_EDITS, brightness: 45 } }]) } };
    let rejected = false;
    try { await storage.save(next); } catch { rejected = true; }
    finally { IDBObjectStore.prototype.put = put; }
    const preserved = await new IndexedDbProjectStorage(name).load();
    const rollback = await preserved.workspace.history.present.state[0].file.text() === 'synthetic original';
    await storage.save(next);
    const retry = await new IndexedDbProjectStorage(name).load();
    const retried = retry.workspace.history.present.state[0].edits.brightness === 45 && await retry.workspace.history.present.state[0].file.text() === 'synthetic retouch';
    const legacy = JSON.stringify({ clients: [{ id: 'legacy-client', name: 'Synthetic client' }], projects: [{ id: 'legacy-project', name: 'Synthetic legacy project', files: [{ id: 'missing', file: {} }], gallery: { selectedFileIds: [] }, activity: [] }] });
    localStorage.setItem('fotograf_crm_v1', legacy);
    const migrated = new IndexedDbProjectStorage(`history-legacy-test-${Date.now()}`);
    const loaded = await migrated.load();
    await migrated.save(loaded);
    const legacyPreserved = localStorage.getItem('fotograf_crm_v1') === legacy && loaded.projects[0].unavailableFileCount === 1 && loaded.projects[0].files.length === 0;
    return { failedSaveRejected: rejected, atomicRollback: rollback, retryAfterFailure: retried, legacyRecordPreserved: legacyPreserved };
  });
  assert.ok(Object.values(report.storage).every(Boolean));

  // Surface a save failure in the actual editor, then retry the same session safely.
  await page.evaluate(() => {
    window.__normalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'metadata') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return window.__normalPut.apply(this, args);
    };
  });
  await page.getByRole('slider').first().fill('40');
  await page.getByText('Uložení selhalo — práce zatím zůstává v této relaci.', { exact: false }).waitFor();
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__normalPut; });
  await page.getByRole('button', { name: 'Zkusit znovu', exact: true }).click();
  await saved(page);
  assert.equal(await value(page), '40');
  report.saveFailureVisibleAndRetryable = true;

  // Seed two synthetic projects to verify route restoration and isolated histories.
  await page.evaluate(async () => {
    const { projectStorage } = await import('/services/projectStorage.ts');
    const { createHistory } = await import('/utils/editorHistory.ts');
    const data = await projectStorage.load();
    const make = (id, history) => ({ id, name: id, clientId: 'history-client', type: 'portrait', status: 'editing', date: '2026-10-15', files: history.present.state, editorHistory: history, gallery: { published: false, selectedFileIds: [], allowDownload: true }, activity: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const other = { ...data.workspace.history.present.state[1], id: 'other-project-photo', edits: undefined };
    await projectStorage.save({ ...data, clients: [{ id: 'history-client', name: 'Synthetic test', email: '', createdAt: new Date().toISOString() }], projects: [make('history-project-A', data.workspace.history), make('history-project-B', createHistory([other]))], workspace: { ...data.workspace, projectId: 'history-project-A' } });
  });
  await page.goto(`${base}/projects/history-project-B`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Úpravy 03', exact: true }).click();
  assert.equal(await value(page), '0');
  assert.equal(await page.getByRole('button', { name: 'Vrátit poslední krok (Ctrl+Z)', exact: true }).isDisabled(), true, 'Another project leaked into Undo');
  await page.getByRole('slider').first().fill('60');
  await saved(page);
  await page.goto(`${base}/projects/history-project-A`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Úpravy 03', exact: true }).click();
  assert.equal(await value(page), '40', 'Project switching discarded project A settings');
  await saved(page);
  report.projectHistoriesIsolated = true;
  assert.deepEqual((await inspect(page)).hashes, hashes);
  await page.evaluate(async () => {
    const { projectStorage } = await import('/services/projectStorage.ts');
    const data = await projectStorage.load();
    await projectStorage.save({ ...data, workspace: { projectId: null, activeFileId: null, history: { past: [], present: { state: [], actionName: 'Initial state' }, future: [data.workspace.history.present] } } });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Znovu', exact: true }).click();
  await page.getByRole('slider').first().waitFor();
  await saved(page);
  assert.deepEqual((await inspect(page)).hashes, hashes);
  report.redoFromEmptyWorkspaceAfterReload = true;
  await page.screenshot({ path: fileURLToPath(new URL('editor-history.png', output)), fullPage: true });
  await writeFile(new URL('editor-history-snapshot.txt', output), await page.locator('body').ariaSnapshot());
  assert.deepEqual(errors, []);
  report.pageErrors = errors;
  await writeFile(new URL('editor-history-smoke.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(new URL('editor-history-smoke.json', output), JSON.stringify(report, null, 2));
  await context?.close();
}
