// Behavioral coverage for the photo-by-photo workflow in an isolated profile.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const desktop = process.env.DESKTOP_SMOKE_CDP, pid = process.env.DESKTOP_SMOKE_PID;
assert.ok(!desktop || pid, 'Native QA requires its owned process ID');
const base = desktop ? 'https://tauri.localhost' : process.env.CULLING_SMOKE_URL ?? 'http://127.0.0.1:3100';
const browser = desktop ? await chromium.connectOverCDP(desktop, { timeout: 15000 }) : await chromium.launch({ headless: true });
const context = desktop ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = desktop ? context.pages().find(p => p.url().startsWith(base)) : await context.newPage();
assert.ok(page, 'No QA window');
const reply = action => promisify(execFile)('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('windows-dialog-smoke.ps1', import.meta.url)),
  '-AppProcessId', pid, '-Action', action], { windowsHide: true, timeout: 25000 });
page.setDefaultTimeout(30000);
const errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin && !/^https?:\/\/ipc\.localhost\//.test(url)) {
    external.push(url); return route.abort();
  }
  return route.continue();
});
const queue = () => page.getByRole('navigation', { name: 'Fronta fotek' });
const current = () => queue().locator('button[aria-current="true"]');
const choices = () => page.getByRole('group', { name: 'Tvoje rozhodnutí' });
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (desktop) assert.equal(await page.evaluate(() => !!window.__TAURI_INTERNALS__), true);
  await page.getByRole('button', { name: 'Import 01', exact: true }).click();
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < 256; y += 4) for (let x = 0; x < 384; x += 4) {
      ctx.fillStyle = (x + y) % 8 ? '#ddd' : '#333'; ctx.fillRect(x, y, 4, 4);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles([1, 2, 3].map(n => ({
    name: `REVIEW_000${n}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64'),
  })));
  external.length = 0;
  await page.getByRole('button', { name: 'Spustit lokální culling', exact: true }).click();
  await queue().waitFor();
  assert.match(await current().getAttribute('aria-label'), /REVIEW_0001/);
  await page.keyboard.press('ArrowRight');
  assert.match(await current().getAttribute('aria-label'), /REVIEW_0002/);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('k');
  assert.match(await current().getAttribute('aria-label'), /REVIEW_0002/);
  await page.getByRole('button', { name: 'O krok zpět', exact: true }).click();
  assert.equal(await choices().getByRole('button', { name: /Ponechat/ }).getAttribute('aria-pressed'), 'true');
  await choices().getByRole('button', { name: /Ponechat/ }).click();
  await page.getByRole('button', { name: 'O krok zpět', exact: true }).click();
  assert.equal(await choices().getByRole('button', { name: /Ponechat/ }).getAttribute('aria-pressed'), 'true', 'Repeated choice must remain set');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('r');
  await page.getByRole('button', { name: 'Detail 1:1', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: '100%', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('x');
  await page.getByRole('heading', { name: 'Výběr máš za sebou', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Projít znovu', exact: true }).click();
  assert.match(await current().getAttribute('aria-label'), /REVIEW_0001/);
  await page.getByRole('button', { name: 'Celá sada', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Sbalit série (jeden reprezentant)' }).uncheck();
  const cards = page.locator('.fm-grid-photos > div');
  assert.equal(await cards.count(), 3);
  for (const card of await cards.all()) assert.equal(await card.getByText('Ručně', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Fotka po fotce', exact: true }).click();
  await queue().locator('button').last().click();
  await page.keyboard.press('x');
  const dismissed = desktop ? reply('dismiss') : null;
  if (!desktop) page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Použít výběr a otevřít editor', exact: true }).click();
  if (dismissed) await dismissed;
  await page.getByRole('heading', { name: 'Výběr máš za sebou', exact: true }).waitFor();
  const accepted = desktop ? reply('accept') : null;
  if (!desktop) page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Použít výběr a otevřít editor', exact: true }).click();
  if (accepted) await accepted;
  await page.locator('button[title$="(Ctrl+Z)"]').waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const output = new URL('../output/playwright/', import.meta.url);
  await mkdir(output, { recursive: true });
  const report = { native: !!desktop, keyboardAdvance: true, repeatedChoiceStaysSet: true, allFilesNavigable: true,
    detailDialog: true, manualChoicesInGrid: true, restart: true, summaryAndConfirmedHandoff: true,
    pageErrors: errors, externalRequests: external.length };
  await writeFile(new URL(desktop ? 'native-culling-focus-smoke.json' : 'culling-focus-smoke.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await context.unrouteAll({ behavior: 'wait' }); await browser.close(); }
