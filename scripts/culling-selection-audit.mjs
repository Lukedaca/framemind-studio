// Read-only comparison with one photographer's exports, never universal bad-photo labels.
// Private photos, filenames and reports stay outside versioned fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const [sourceFolder, exportFolder, label = 'selection'] = process.argv.slice(2);
assert.ok(sourceFolder && exportFolder, 'Usage: node scripts/culling-selection-audit.mjs <originals> <exports> [label] [source filenames...]');
assert.match(label, /^[a-z0-9-]+$/i);
const extensions = /\.(jpe?g|png|cr2|cr3|nef|arw|dng|orf|rw2|raf|pef)$/i;
const identity = name => basename(name, extname(name)).replace(/^(?:edited_|autopilot_)+/i, '').toLowerCase();
const allPaths = (await readdir(sourceFolder)).filter(name => extensions.test(name)).sort().map(name => resolve(sourceFolder, name));
const requestedNames = new Set(process.argv.slice(5));
const paths = requestedNames.size ? allPaths.filter(path => requestedNames.has(basename(path))) : allPaths;
assert.ok(!requestedNames.size || paths.length === requestedNames.size, 'A requested source file was not found');
const exported = (await readdir(exportFolder)).filter(name => extensions.test(name));
const selectedIds = new Set(exported.map(identity));
const sourceIds = new Set(allPaths.map(identity));
assert.ok(paths.length && exported.length, 'Both folders must contain supported photos');
assert.equal(sourceIds.size, allPaths.length, 'Ambiguous source basenames; compare one original format at a time');
assert.ok(allPaths.some(path => selectedIds.has(identity(path))), 'No matching source/export basenames');
const hash = async path => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
};
const output = fileURLToPath(new URL('../output/playwright/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CULLING_SMOKE_BROWSER ? { executablePath: process.env.CULLING_SMOKE_BROWSER } : {}) });
const base = process.env.CULLING_SMOKE_URL ?? 'http://127.0.0.1:3100';
const page = await browser.newPage();
page.setDefaultTimeout(60_000);
const errors = [], external = [], hashes = [];
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
    const input = document.createElement('input'); input.type = 'file'; input.id = 'selection-file';
    document.body.append(input);
    window.selectionAudit = { session: new CullingSession(), rows: [], thumbs: [] };
  });
  external.length = 0;
  const started = Date.now();
  for (const [index, path] of paths.entries()) {
    hashes.push(await hash(path));
    await page.locator('#selection-file').setInputFiles(path);
    const diagnosticPreview = await page.evaluate(async ({ selected, savePreview }) => {
      const original = document.querySelector('#selection-file').files[0];
      const { isRawFile, processRawFile } = await import('/utils/rawProcessor.ts');
      const raw = isRawFile(original);
      const file = raw ? await processRawFile(original) : original;
      const input = { id: original.name, file, originalFile: original,
        ...(raw ? { baseFile: file, cullingSource: 'embedded-jpeg-preview' } : {}) };
      const analysis = await window.selectionAudit.session.analyze(input);
      const result = await window.selectionAudit.session.score(analysis, 'sport');
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 280; canvas.height = 180;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 280, 180);
        const scale = Math.min(280 / bitmap.width, 180 / bitmap.height);
        ctx.drawImage(bitmap, (280 - bitmap.width * scale) / 2, (180 - bitmap.height * scale) / 2,
          bitmap.width * scale, bitmap.height * scale);
        window.selectionAudit.thumbs.push(canvas.toDataURL('image/jpeg', 0.85));
        window.selectionAudit.rows.push({ filename: original.name, selected,
          originalWidth: bitmap.width, originalHeight: bitmap.height, result });
      } finally { bitmap.close(); }
      if (!savePreview) return null;
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
      });
      return { data, type: file.type };
    }, { selected: selectedIds.has(identity(path)), savePreview: requestedNames.size > 0 });
    if (diagnosticPreview) await writeFile(join(output, `${label}-${basename(path, extname(path))}.${diagnosticPreview.type === 'image/png' ? 'png' : 'jpg'}`),
      Buffer.from(diagnosticPreview.data.split(',')[1], 'base64'));
    if ((index + 1) % 20 === 0) console.log(`Measured ${index + 1}/${paths.length}`);
  }
  const rows = await page.evaluate(async () => {
    const { rescoreCullingResult } = await import('/utils/cullingEngine.ts');
    const rows = window.selectionAudit.rows;
    const groups = await window.selectionAudit.session.group(rows.map(({ filename, result: r }) => ({
      id: filename, filename, signature: r.metrics.signature, aspectRatio: r.aspectRatio,
      finalScore: r.finalScore, sharpness: r.metrics.technical.laplacianVariance,
      detailConfidence: r.metrics.technical.detailConfidence, exif: r.exif, native: r.metrics.native,
    })));
    for (const row of rows) row.result = rescoreCullingResult({ ...row.result, ...groups.get(row.filename) }, 'sport');
    window.selectionAudit.session.close();
    return rows;
  });
  for (let offset = 0; offset < rows.length; offset += 24) {
    const png = await page.evaluate(async ({ offset, rows }) => {
      const canvas = document.createElement('canvas'); canvas.width = 1120; canvas.height = 1320;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = offset; i < Math.min(offset + 24, rows.length); i++) {
        const image = new Image(); image.src = window.selectionAudit.thumbs[i]; await image.decode();
        const x = ((i - offset) % 4) * 280, y = Math.floor((i - offset) / 4) * 220;
        ctx.drawImage(image, x, y);
        ctx.fillStyle = rows[i].selected ? '#76e6ad' : '#ddd'; ctx.font = '13px sans-serif';
        ctx.fillText(`${rows[i].filename} ${rows[i].selected ? '[exported]' : '[not exported]'}`, x + 4, y + 196);
        ctx.fillStyle = rows[i].result.decision === 'reject' ? '#ff9999' : '#ddd';
        ctx.fillText(`${rows[i].result.finalScore} ${rows[i].result.decision}`, x + 4, y + 213);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, { offset, rows });
    await writeFile(join(output, `${label}-sheet-${1 + offset / 24}.png`), Buffer.from(png, 'base64'));
  }
  for (const [index, path] of paths.entries()) assert.equal(await hash(path), hashes[index], 'Original changed: ' + basename(path));
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const counts = subset => Object.fromEntries(['keep', 'review', 'reject'].map(d => [d, subset.filter(r => r.result.decision === d).length]));
  const summary = { label, engineVersion: rows[0].result.engineVersion, count: rows.length, subset: requestedNames.size > 0,
    counts: counts(rows), exported: counts(rows.filter(r => r.selected)),
    notExported: counts(rows.filter(r => !r.selected)),
    unmatchedExports: exported.filter(name => !sourceIds.has(identity(name))),
    selectedRejects: rows.filter(r => r.selected && r.result.decision === 'reject').map(r => r.filename),
    interpretation: 'Exports are examples of one photographer\'s selection. Unexported photos are not labelled bad.',
    originalHashesUnchanged: true, externalRequests: external.length, pageErrors: errors,
    elapsedSeconds: (Date.now() - started) / 1000 };
  await writeFile(join(output, `${label}-audit.json`), JSON.stringify({ ...summary, rows,
    originals: paths.map((path, i) => ({ filename: basename(path), sha256: hashes[i] })) }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally { await browser.close(); }
