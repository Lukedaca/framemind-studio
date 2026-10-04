import type { UploadedFile, CullingGenre, CullingResult } from '../types';
import type { PhotoAnalysis, SimilarityInput, SimilarityAssignment } from '../utils/cullingEngine';
import type { CullingRequest, CullingResponse } from '../utils/cullingProtocol';

type RequestBody = CullingRequest extends infer R ? R extends { id: number } ? Omit<R, 'id'> : never : never;
interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

// One owned worker per run. Cancellation rejects every waiter immediately.
export class CullingSession {
  private worker: Worker;
  private nextId = 0;
  private closed = false;
  private failure: Error = new DOMException('Culling cancelled', 'AbortError');
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('../workers/culling.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<CullingResponse>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id); clearTimeout(pending.timer);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.value);
    };
    this.worker.onerror = (event) => this.close(new Error(event.message || 'Culling worker failed'));
    this.worker.onmessageerror = () => this.close(new Error('Unreadable culling worker response'));
  }

  private request<T>(body: RequestBody): Promise<T> {
    if (this.closed) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('Culling worker timed out')), body.kind === 'group' ? 120_000 : 60_000);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try { this.worker.postMessage({ ...body, id }); }
      catch (error) { this.close(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  analyze(file: UploadedFile): Promise<PhotoAnalysis> {
    const source = file.cullingSource ?? 'image';
    const original = file.originalFile instanceof Blob ? file.originalFile : file.file;
    return this.request({ kind: 'analyze', file: source === 'image' ? original : file.file, metadataFile: original, source });
  }
  score(analysis: PhotoAnalysis, genre: CullingGenre | null): Promise<CullingResult> { return this.request({ kind: 'score', analysis, genre }); }
  async group(items: SimilarityInput[]): Promise<Map<string, SimilarityAssignment>> {
    return new Map(await this.request<[string, SimilarityAssignment][]>({ kind: 'group', items }));
  }
  close(error: Error = new DOMException('Culling cancelled', 'AbortError')): void {
    if (this.closed) return;
    this.closed = true; this.failure = error; this.worker.terminate();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}
