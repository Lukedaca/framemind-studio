import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CullingSession } from '../services/cullingSession';
import type { UploadedFile } from '../types';
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
const image = (): UploadedFile => ({ id: 'a', file: new File(['image'], 'a.jpg'), previewUrl: '', originalPreviewUrl: '' });

describe('owned local culling worker', () => {
  beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('cancel terminates decoding and rejects all pending work immediately', async () => {
    const session = new CullingSession();
    const pending = session.analyze(image());
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    session.close(); await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    await expect(session.analyze(image())).rejects.toMatchObject({ name: 'AbortError' });
    session.close(); expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  });
  it('worker faults reject waiting callers and timeout terminates a stalled decode', async () => {
    const session = new CullingSession();
    const pending = session.analyze(image());
    const rejected = expect(pending).rejects.toThrow('decoder crashed');
    FakeWorker.instances[0].onerror!({ message: 'decoder crashed' }); await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
    vi.useFakeTimers(); const stalled = new CullingSession();
    const timedOut = expect(stalled.analyze(image())).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(60_000); await timedOut;
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalled();
  });
  it('keeps RAW pixel preview separate from original metadata input', async () => {
    const original = new File(['raw'], 'a.CR2'), preview = image();
    const session = new CullingSession();
    const pending = session.analyze({ ...preview, originalFile: original, cullingSource: 'embedded-jpeg-preview' });
    const request = FakeWorker.instances[0].postMessage.mock.calls[0][0];
    expect(request.file).toBe(preview.file); expect(request.metadataFile).toBe(original);
    FakeWorker.instances[0].onmessage!({ data: { id: request.id, value: { source: 'embedded-jpeg-preview' } } });
    await expect(pending).resolves.toMatchObject({ source: 'embedded-jpeg-preview' }); session.close();
  });
});
