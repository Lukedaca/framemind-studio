// @vitest-environment node
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

describe('culling dependency boundary', () => {
  it('culling permits only a bundled hash-pinned local model, never external AI or image upload', () => {
    const root = resolve(import.meta.dirname, '..');
    const visited = new Set<string>();
    const walk = (relative: string) => {
      const file = resolve(root, relative);
      if (visited.has(file)) return;
      visited.add(file);
      const source = readFileSync(file, 'utf8');
      // An SVG namespace is an identifier, not a request to an external host.
      const code = source.replaceAll('http://www.w3.org/2000/svg', '');
      const forbidden = code.match(/geminiService|@google\/genai|subjectDetection|faceDetection|tasteEngine|aiUsage|apiKey|mediapipe|https?:\/\/|XMLHttpRequest|WebSocket|sendBeacon/);
      expect(forbidden?.[0], relative).toBeUndefined();
      if (file.endsWith('cullingSubject.ts')) {
        expect(code.match(/\bfetch\s*\(/g)).toHaveLength(1);
        expect(code).toContain('new URL(modelUrl, self.location.origin)');
        expect(code).toContain('url.origin !== self.location.origin');
        expect(code).toContain("fetch(url, { method: 'GET', credentials: 'omit' })");
        expect(code).toContain("crypto.subtle.digest('SHA-256', bytes)");
      } else expect(code.match(/\bfetch\s*\(/)?.[0], relative).toBeUndefined();
      for (const match of source.matchAll(/(?:from\s+|import\s*\(|new URL\s*\()\s*['"]([^'"]+)['"]/g)) {
        if (!match[1].startsWith('.')) {
          // Desktop confirmation uses in-process IPC to a native dialog.
          const allowed = ['react', 'exifr', '@tauri-apps/api/core', '@tauri-apps/plugin-dialog'];
          if (file.endsWith('cullingSubject.ts')) allowed.push('onnxruntime-web/wasm',
            'onnxruntime-web/ort-wasm-simd-threaded.wasm?url', 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url');
          expect(allowed).toContain(match[1]); continue;
        }
        const base = resolve(dirname(file), match[1].split('?')[0]);
        if (base.endsWith('.onnx')) {
          const model = readFileSync(base);
          expect(model.byteLength).toBe(4574861);
          expect(createHash('sha256').update(model).digest('hex')).toBe('309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8');
          continue;
        }
        const dependency = [base, base + '.ts', base + '.tsx'].find(p => existsSync(p));
        expect(dependency, match[1]).toBeDefined();
        walk(dependency!);
      }
    };
    walk('components/CullingView.tsx'); walk('workers/culling.worker.ts');
    expect(visited.size).toBeGreaterThan(8);
  });
});
