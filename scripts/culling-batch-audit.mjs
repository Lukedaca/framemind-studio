// Read-only calibration on a local photo folder. Reports stay in ignored output/.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const folder = process.argv[2];
assert.ok(folder, 'Usage: node scripts/culling-batch-audit.mjs <folder> [label]');
const label = process.argv[3] ?? 'batch';
assert.match(label, /^[a-z0-9-]+$/i);
const output = fileURLToPath(new URL('../output/playwright/', import.meta.url));
await mkdir(output, { recursive: true });
const paths = (await readdir(folder)).filter(name => /\.(jpe?g|png)$/i.test(name)).sort().map(name => resolve(folder, name));
assert.ok(paths.length, 'No supported images');
const hash = async path => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
};
const hashes = [];
for (const path of paths) hashes.push(await hash(path));
const browser = await chromium.launch({ headless: true,
  ...(process.env.CULLING_SMOKE_BROWSER ? { executablePath: process.env.CULLING_SMOKE_BROWSER } : {}) });
const base = process.env.CULLING_SMOKE_URL ?? 'http://127.0.0.1:3100';
const page = await browser.newPage();
const external = [], errors = [];
await page.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin) {
    external.push(url); return route.abort();
  }
  return route.continue();
});
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const { CullingSession } = await import('/services/cullingSession.ts');
    const input = document.createElement('input'); input.type = 'file'; input.id = 'audit-file';
    document.body.append(input);
    window.audit = { session: new CullingSession(), rows: [], thumbs: [] };
  });
  external.length = 0;
  const started = Date.now();
  for (let index = 0; index < paths.length; index++) {
    await page.locator('#audit-file').setInputFiles(paths[index]);
    await page.evaluate(async () => {
      const file = document.querySelector('#audit-file').files[0];
      const analysis = await window.audit.session.analyze({ id: file.name, file, originalFile: file });
      const result = await window.audit.session.score(analysis, 'sport');
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 280; canvas.height = Math.round(280 * bitmap.height / bitmap.width);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        window.audit.thumbs.push(canvas.toDataURL('image/jpeg', 0.85));
        window.audit.rows.push({ filename: file.name, originalWidth: bitmap.width, originalHeight: bitmap.height, result });
      } finally { bitmap.close(); }
    });
    if ((index + 1) % 20 === 0) console.log(`Measured ${index + 1}/${paths.length}`);
  }
  const report = await page.evaluate(async () => {
    const { rescoreCullingResult } = await import('/utils/cullingEngine.ts');
    const { compareSignatures } = await import('/utils/cullingSimilarity.ts');
    const rows = window.audit.rows;
    const groups = await window.audit.session.group(rows.map(({ filename, result }) => ({
      id: filename, filename, signature: result.metrics.signature, aspectRatio: result.aspectRatio,
      finalScore: result.finalScore, sharpness: result.metrics.technical.laplacianVariance,
      detailConfidence: result.metrics.technical.detailConfidence, exif: result.exif,
      native: result.metrics.native,
    })));
    for (const row of rows) row.result = rescoreCullingResult({ ...row.result, ...groups.get(row.filename) }, 'sport');
    const pairs = [];
    for (let i = 0; i < rows.length; i++) for (let j = Math.max(0, i - 2); j < i; j++) {
      pairs.push({ a: rows[j].filename, b: rows[i].filename,
        comparison: compareSignatures(rows[j].result.metrics.signature, rows[i].result.metrics.signature) });
    }
    window.audit.session.close();
    return { rows, pairs };
  });
  for (let offset = 0; offset < paths.length; offset += 24) {
    const png = await page.evaluate(async ({ offset, rows }) => {
      const canvas = document.createElement('canvas'); canvas.width = 1120; canvas.height = 1320;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = offset; i < Math.min(offset + 24, rows.length); i++) {
        const image = new Image(); image.src = window.audit.thumbs[i]; await image.decode();
        const x = ((i - offset) % 4) * 280, y = Math.floor((i - offset) / 4) * 220;
        ctx.drawImage(image, x, y, 280, Math.min(185, image.height));
        ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
        ctx.fillText(`${rows[i].filename}: ${rows[i].result.finalScore} ${rows[i].result.decision}`, x + 5, y + 202);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, { offset, rows: report.rows });
    await writeFile(join(output, `${label}-sheet-${1 + offset / 24}.png`), Buffer.from(png, 'base64'));
  }
  for (const [index, path] of paths.entries()) assert.equal(await hash(path), hashes[index], 'Original photo bytes changed: ' + basename(path));
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const counts = { keep: 0, review: 0, reject: 0 };
  for (const row of report.rows) counts[row.result.decision]++;
  const summary = { label, count: paths.length, engineVersion: report.rows[0].result.engineVersion,
    counts, groupedPhotos: report.rows.filter(row => row.result.duplicateGroupId).length,
    originalHashesUnchanged: true, externalRequests: external.length, pageErrors: errors,
    elapsedSeconds: (Date.now() - started) / 1000 };
  await writeFile(join(output, `${label}-audit.json`), JSON.stringify({ ...summary, ...report,
    originals: paths.map((path, i) => ({ filename: basename(path), sha256: hashes[i] })) }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(report.rows.slice().sort((a, b) => a.result.finalScore - b.result.finalScore).slice(0, 16)
    .map(({ filename, result: r }) => ({ filename, score: r.finalScore, decision: r.decision,
      sharpness: r.metrics.sharpnessScore, laplacian: r.metrics.technical.laplacianVariance,
      confidence: r.metrics.technical.detailConfidence, risks: r.risks, group: r.duplicateGroupId })), null, 2));
} finally { await browser.close(); }
