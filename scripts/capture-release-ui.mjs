// Release screenshots use an isolated browser profile and already-public demo assets.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = new URL('../output/playwright/release-ui/', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const prefix = `studio-v${version.replaceAll('.', '')}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
await mkdir(output, { recursive: true });
const base = 'http://127.0.0.1:3101';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '3101', '--strictPort'], { stdio: 'ignore', windowsHide: true });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'Screenshot server did not start');
  browser = await chromium.launch({ headless: true, ...(process.env.STUDIO_CAPTURE_BROWSER ? { executablePath: process.env.STUDIO_CAPTURE_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  const capture = async name => {
    await page.waitForTimeout(120);
    const png = await page.screenshot({ fullPage: false });
    const webp = await page.evaluate(async encoded => {
      const img = new Image(); img.src = `data:image/png;base64,${encoded}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', 0.92).split(',')[1];
    }, png.toString('base64'));
    await writeFile(new URL(`${prefix}-${name}.webp`, output), Buffer.from(webp, 'base64'));
  };
  await page.getByRole('button', { name: 'Import 01', exact: true }).waitFor();
  const headline = await page.locator('h1').first().innerText();
  assert.ok(headline.includes('Vyberte Upravte'));
  assert.ok(!headline.includes('.'), 'Main slogan must have no full stops');
  await capture('home');
  await page.getByRole('button', { name: 'Projekty', exact: true }).click();
  await page.getByRole('heading', { name: 'Projekty', exact: true }).first().waitFor(); await capture('projects');
  await page.getByRole('button', { name: 'Klienti', exact: true }).click();
  await page.getByRole('heading', { name: 'Klienti', exact: true }).first().waitFor(); await capture('clients');
  await page.getByRole('button', { name: 'Import 01', exact: true }).click(); await capture('import');
  const files = await Promise.all(['landscape','portrait','wedding'].map(async name => {
    const response = await fetch(`https://framemind.cz/assets/${name}.png`, { signal: AbortSignal.timeout(20000) });
    assert.ok(response.ok, `Public demo image ${name} is unavailable`);
    return { name: `UKAZKA_${name.toUpperCase()}.png`, mimeType: 'image/png', buffer: Buffer.from(await response.arrayBuffer()) };
  }));
  await page.locator('input[type=file]').setInputFiles(files);
  await page.getByRole('heading', { name: 'Lokální culling', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Spustit lokální culling', exact: true }).click();
  await page.getByRole('button', { name: 'Spustit znovu', exact: true }).waitFor({ timeout: 30000 }); await capture('culling');
  const comparisonChoices = page.getByRole('button', { name: /^Vybrat k porovnání / });
  await comparisonChoices.nth(0).click();
  await comparisonChoices.nth(1).click();
  await page.getByRole('button', { name: 'Porovnat výběr (2/4)', exact: true }).click();
  const comparison = page.getByRole('dialog', { name: 'Porovnání detailu', exact: true });
  await comparison.waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="culling-native-crop"] img').length === 2);
  await capture('compare');
  await comparison.getByRole('button', { name: 'Zavřít detail', exact: true }).click();
  await page.getByRole('button', { name: 'Úpravy 03', exact: true }).click();
  await page.getByRole('slider').first().waitFor();
  await page.getByText('Uloženo lokálně', { exact: true }).waitFor(); await capture('edit');
  await page.getByRole('button', { name: 'Retuš 04', exact: true }).click();
  await page.getByRole('heading', { name: 'Retuš štětcem', exact: true }).waitFor(); await capture('retouch');
  await page.getByRole('button', { name: 'Export 05', exact: true }).click();
  await page.getByRole('radio', { name: 'PNG', exact: true }).waitFor(); await capture('export');
  assert.deepEqual(errors, []);
  await writeFile(new URL('report.json', output), JSON.stringify({ version, prefix, screenshots: 9, isolatedProfile: true, publicDemoImages: true, mainSloganWithoutFullStops: true, pageErrors: errors }, null, 2));
  console.log('Nine current-interface screenshots captured, including original-resolution comparison; slogan and page-error checks passed.');
} finally {
  await browser?.close();
  server.kill();
}
