// End-to-end automatic suggestions and one-action handoff; isolated browser/native QA profile only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const [sharpPath, blurredPath] = process.argv.slice(2);
assert.ok(sharpPath && blurredPath, 'Usage: node scripts/culling-automatic-smoke.mjs <sharp fixture> <known blurred fixture>');
const desktop = process.env.DESKTOP_SMOKE_CDP, pid = process.env.DESKTOP_SMOKE_PID;
assert.ok(!desktop || pid, 'Native QA requires its owned process ID');
const base = desktop ? 'https://tauri.localhost' : process.env.CULLING_SMOKE_URL ?? 'http://127.0.0.1:3100';
const browser = desktop ? await chromium.connectOverCDP(desktop, { timeout: 15000 }) : await chromium.launch({ headless: true });
const context = desktop ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = desktop ? context.pages().find(p => p.url().startsWith(base)) : await context.newPage();
assert.ok(page, 'No QA window'); page.setDefaultTimeout(60000);
const errors = [], external = [], label = desktop ? 'native-culling-automatic' : 'culling-automatic';
const diagnostics = [];
page.on('console', message => { if (['error', 'warning'].includes(message.type())) diagnostics.push({ type: message.type(), text: message.text() }); });
page.on('requestfailed', request => diagnostics.push({ type: 'requestfailed', url: request.url(), error: request.failure()?.errorText }));
page.on('worker', worker => worker.on('close', () => diagnostics.push({ type: 'workerclosed', url: worker.url() })));
const output = new URL('../output/playwright/', import.meta.url); await mkdir(output, { recursive: true });
const fixtureBytes = await Promise.all([sharpPath, blurredPath].map(path => readFile(path)));
const hashes = fixtureBytes.map(bytes => createHash('sha256').update(bytes).digest('hex'));
const reply = action => promisify(execFile)('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('windows-dialog-smoke.ps1', import.meta.url)),
  '-AppProcessId', pid, '-Action', action], { windowsHide: true, timeout: 25000 });
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/.test(url) && new URL(url).origin !== base && !/^https?:\/\/ipc\.localhost\//.test(url)) {
    external.push(url); return route.abort();
  }
  return route.continue();
});
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (desktop) assert.equal(await page.evaluate(() => !!window.__TAURI_INTERNALS__), true);
  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles([
    { name: 'PUBLIC_0001.png', mimeType: 'image/png', buffer: fixtureBytes[0] },
    { name: 'PUBLIC_0002.png', mimeType: 'image/png', buffer: fixtureBytes[0] },
    { name: 'PUBLIC_0003.png', mimeType: 'image/png', buffer: fixtureBytes[1] },
  ]);
  await page.getByRole('heading', { name: 'Lokální culling', exact: true }).waitFor();
  external.length = 0;
  await page.getByRole('button', { name: 'Spustit lokální culling', exact: true }).click();
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Sbalit série (jeden reprezentant)' }).uncheck();
  const cards = page.locator('.fm-grid-photos > div');
  assert.equal(await cards.count(), 3);
  const text = await cards.allTextContents();
  assert.ok(text.some(value => value.includes('Automaticky nalezené objekty obsahují měřitelný detail')));
  assert.ok(text.some(value => value.includes('Silné rozmazání v automaticky nalezených oblastech objektů')));
  assert.ok(text.some(value => value.includes('Ověřená totožná kopie')));
  assert.ok(!text.some(value => value.includes('není dostupná')));
  const apply = page.getByRole('button', { name: 'Použít výběr a otevřít editor', exact: true });
  const dismissed = desktop ? reply('dismiss') : null;
  if (!desktop) page.once('dialog', dialog => dialog.dismiss());
  await apply.click(); if (dismissed) await dismissed;
  assert.equal(await cards.count(), 3);
  const accepted = desktop ? reply('accept') : null;
  if (!desktop) page.once('dialog', dialog => dialog.accept());
  await apply.click(); if (accepted) await accepted;
  const editorUndo = page.locator('button[title$="(Ctrl+Z)"]');
  await editorUndo.waitFor();
  await page.getByRole('button', { name: 'Výběr 02', exact: true }).click();
  assert.equal(await cards.count(), 1, 'Rejected frames must be absent after the editor handoff');
  assert.equal(await page.getByText('PUBLIC_0001.jpeg', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Úpravy 03', exact: true }).click();
  await editorUndo.click();
  await page.getByRole('button', { name: 'Výběr 02', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Sbalit série (jeden reprezentant)' }).uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.fm-grid-photos > div').length === 3);
  const reopened = page.getByRole('button', { name: 'Použít výběr a otevřít editor', exact: true });
  await reopened.waitFor();
  assert.equal(await cards.count(), 3, 'Undo must restore all frames and culling metadata');
  assert.deepEqual(await cards.allTextContents(), text, 'Undo must restore scores, decisions and culling explanations');
  for (let i = 0; i < 2; i++) assert.equal(createHash('sha256').update(await readFile([sharpPath, blurredPath][i])).digest('hex'), hashes[i]);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { native: !!desktop, automaticObjects: true, automaticBlurReject: true, automaticIdenticalCopyReject: true,
    cancelledApplyPreservesSet: true, appliedSelectionContinuesToEditor: true, undoRestoresSet: true,
    fixtureHashesUnchanged: true, externalRequests: 0, pageErrors: errors };
  await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, output)), fullPage: true });
  await writeFile(new URL(`${label}.json`, output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(new URL(`${label}-failure.json`, output), JSON.stringify({ errors, external, diagnostics }, null, 2));
  await writeFile(new URL(`${label}-failure.txt`, output), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: fileURLToPath(new URL(`${label}-failure.png`, output)), fullPage: true }); throw error;
} finally { await context.unrouteAll({ behavior: 'wait' }); await browser.close(); }
