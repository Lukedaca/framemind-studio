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
  it('resumes across workers only for the exact pixel and metadata Blobs', async () => {
    const source = image(), session = new CullingSession();
    const first = session.analyze(source);
    const worker = FakeWorker.instances[0], request = worker.postMessage.mock.calls[0][0];
    worker.onmessage!({ data: { id: request.id, value: { source: 'image', aspectRatio: 1.5 } } });
    await first; session.close();
    const resumed = new CullingSession();
    await expect(resumed.analyze(source)).resolves.toMatchObject({ aspectRatio: 1.5 });
    expect(FakeWorker.instances[1].postMessage).not.toHaveBeenCalled();
    // Same name, size and timestamp do not establish content identity.
    const replacement = { ...source, file: new File(['other'], source.file.name, { lastModified: source.file.lastModified }) };
    const fresh = resumed.analyze(replacement);
    const next = FakeWorker.instances[1].postMessage.mock.calls[0][0];
    FakeWorker.instances[1].onmessage!({ data: { id: next.id, value: { source: 'image', aspectRatio: 2 } } });
    await expect(fresh).resolves.toMatchObject({ aspectRatio: 2 });
    resumed.close();
    await expect(resumed.analyze(source)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('forced remeasurement bypasses completed measurements', async () => {
    const source = image(), session = new CullingSession(), worker = FakeWorker.instances[0];
    const pending = session.analyze(source);
    worker.onmessage!({ data: { id: worker.postMessage.mock.calls[0][0].id, value: { source: 'image' } } });
    await pending;
    const forced = session.analyze(source, true);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    worker.onmessage!({ data: { id: worker.postMessage.mock.calls[1][0].id, value: { source: 'image' } } });
    await forced; session.close();
  });
  it('inspection and analysis use the immutable RAW import preview after edits', async () => {
    const baseFile = new File(['preview'], 'base.jpg'), edited = image();
    const original = new File(['raw'], 'source.CR2');
    const source: UploadedFile = { ...edited, baseFile, originalFile: original, cullingSource: 'embedded-jpeg-preview' };
    const session = new CullingSession(), worker = FakeWorker.instances[0];
    const pending = session.inspect(source, { x: 0.1, y: 0.9 });
    const request = worker.postMessage.mock.calls[0][0];
    expect(request.file).toBe(baseFile); expect(request.point).toEqual({ x: 0.1, y: 0.9 });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    session.close(); await rejected;
    const analysis = new CullingSession(), pendingAnalysis = analysis.analyze(source);
    expect(FakeWorker.instances[1].postMessage.mock.calls[0][0]).toMatchObject({ file: baseFile, metadataFile: original });
    const cancelled = expect(pendingAnalysis).rejects.toMatchObject({ name: 'AbortError' });
    analysis.close(); await cancelled;
  });
});
