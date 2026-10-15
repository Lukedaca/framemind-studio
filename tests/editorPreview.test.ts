import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorPreviewRenderer } from '../utils/editorPreview';
import type { ManualEdits } from '../types';
import type { PreviewRequest } from '../utils/editorPreviewProtocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: PreviewRequest[] = [];
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: PreviewRequest) { this.messages.push(message); }
  complete(id: number, blob: Blob) { this.onmessage?.({ data: { id, blob } }); }
}

const edits: ManualEdits = { brightness: 0, contrast: 0, saturation: 0, vibrance: 0, shadows: 0, highlights: 0, clarity: 0, sharpness: 0, noiseReduction: 0 };
const file = new File(['photo'], 'photo.png', { type: 'image/png' });

describe('editor preview scheduling', () => {
  let renderer: EditorPreviewRenderer;
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('OffscreenCanvas', class {});
    renderer = new EditorPreviewRenderer();
  });
  afterEach(() => { renderer.dispose(); vi.unstubAllGlobals(); });

  it('drops intermediate slider requests and never publishes an outdated render', async () => {
    const first = renderer.render(file, 'photo', edits).catch(error => error.name);
    const second = renderer.render(file, 'photo', { ...edits, brightness: 20 }).catch(error => error.name);
    const final = renderer.render(file, 'photo', { ...edits, brightness: 40 });
    const worker = FakeWorker.instances[0];
    expect(worker.messages).toHaveLength(1);
    expect(Object.keys(worker.messages[0]).sort()).toEqual(['edits', 'file', 'id', 'sourceKey']);
    expect(await second).toBe('AbortError');
    worker.complete(1, new Blob(['old']));
    expect(await first).toBe('AbortError');
    expect(worker.messages.map(message => message.edits.brightness)).toEqual([0, 40]);
    const latest = new Blob(['latest'], { type: 'image/png' });
    worker.complete(3, latest);
    expect(await final).toBe(latest);
  });

  it('discards a previous photo response after switching photos', async () => {
    const first = renderer.render(file, 'photo-A', edits).catch(error => error.name);
    const second = renderer.render(file, 'photo-B', edits);
    const worker = FakeWorker.instances[0];
    worker.complete(1, new Blob(['A']));
    expect(await first).toBe('AbortError');
    expect(worker.messages[1].sourceKey).toBe('photo-B');
    worker.complete(1, new Blob(['delayed A']));
    const expected = new Blob(['B']);
    worker.complete(2, expected);
    expect(await second).toBe(expected);
  });

  it('settles active and pending promises and releases the worker on disposal', async () => {
    const active = renderer.render(file, 'photo', edits).catch(error => error.name);
    const pending = renderer.render(file, 'other', edits).catch(error => error.name);
    const worker = FakeWorker.instances[0];
    renderer.dispose();
    expect(await active).toBe('AbortError');
    expect(await pending).toBe('AbortError');
    expect(worker.terminate).toHaveBeenCalled();
    await expect(renderer.render(file, 'photo', edits)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
