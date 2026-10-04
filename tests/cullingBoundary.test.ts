// @vitest-environment node
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('culling dependency boundary', () => {
  it('UI and worker cannot reach AI, models, network calls, keys or telemetry', () => {
    const root = resolve(import.meta.dirname, '..');
    const visited = new Set<string>();
    const walk = (relative: string) => {
      const file = resolve(root, relative);
      if (visited.has(file)) return;
      visited.add(file);
      const source = readFileSync(file, 'utf8');
      // An SVG namespace is an identifier, not a request to an external host.
      const code = source.replaceAll('http://www.w3.org/2000/svg', '');
      const forbidden = code.match(/geminiService|@google\/genai|subjectDetection|faceDetection|tasteEngine|aiUsage|apiKey|onnxruntime|mediapipe|https?:\/\/|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
      expect(forbidden?.[0], relative).toBeUndefined();
      for (const match of source.matchAll(/(?:from\s+|import\s*\(|new URL\s*\()\s*['"]([^'"]+)['"]/g)) {
        if (!match[1].startsWith('.')) {
          expect(['react', 'exifr']).toContain(match[1]); continue;
        }
        const base = resolve(dirname(file), match[1]);
        const dependency = [base, base + '.ts', base + '.tsx'].find(p => existsSync(p));
        expect(dependency, match[1]).toBeDefined();
        walk(dependency!);
      }
    };
    walk('components/CullingView.tsx'); walk('workers/culling.worker.ts');
    expect(visited.size).toBeGreaterThan(8);
  });
});
