import type { UploadedFile, CullingGenre, CullingResult } from '../types';
import type { PhotoAnalysis, SimilarityInput, SimilarityAssignment } from '../utils/cullingEngine';
import type { CullingRequest, CullingResponse } from '../utils/cullingProtocol';
import type { CullingInspection, InspectionPoint } from '../utils/cullingInspection';

type RequestBody = CullingRequest extends infer R ? R extends { id: number } ? Omit<R, 'id'> : never : never;
interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

export function cullingInput(file: UploadedFile) {
  const source = file.cullingSource ?? 'image';
  const original = file.originalFile instanceof Blob ? file.originalFile : file.file;
  return { source, file: source === 'image' ? original : file.baseFile ?? file.file, metadataFile: original };
}

// Exact Blob identity, never filename/size guesses. No decoded pixels are cached.
// Rehydrated files in a new application session deliberately need new measurement.
const measurements = new WeakMap<Blob, { metadata: Blob; source: string; focus: string; analysis: PhotoAnalysis }>();
const duplicateProofs = new WeakMap<Blob, WeakMap<Blob, boolean>>();

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

  async analyze(file: UploadedFile, force = false, focusRegion: CullingResult['focusRegion'] | null = file.culling?.focusRegion): Promise<PhotoAnalysis> {
    if (this.closed) throw this.failure;
    const input = cullingInput(file), cached = measurements.get(input.file);
    const focus = JSON.stringify(focusRegion ?? null);
    if (!force && cached?.metadata === input.metadataFile && cached.source === input.source && cached.focus === focus) return cached.analysis;
    const analysis = await this.request<PhotoAnalysis>({ kind: 'analyze', ...input, focusRegion: focusRegion ?? undefined });
    measurements.set(input.file, { metadata: input.metadataFile, source: input.source, focus, analysis });
    return analysis;
  }
  inspect(file: UploadedFile, point: InspectionPoint): Promise<CullingInspection> {
    return this.request({ kind: 'inspect', file: cullingInput(file).file, point });
  }
  async verifyDuplicate(file: UploadedFile, reference: UploadedFile): Promise<boolean> {
    const input = cullingInput(file), ref = cullingInput(reference);
    const bytesOnly = input.source !== 'image' || ref.source !== 'image';
    const a = bytesOnly ? input.metadataFile : input.file, b = bytesOnly ? ref.metadataFile : ref.file;
    if (a === b) return true;
    const cached = duplicateProofs.get(a)?.get(b);
    if (cached !== undefined) return cached;
    const identical = await this.request<boolean>({ kind: 'verify-duplicate', file: a, reference: b, bytesOnly });
    const map = duplicateProofs.get(a) ?? new WeakMap<Blob, boolean>();
    map.set(b, identical); duplicateProofs.set(a, map);
    const reverse = duplicateProofs.get(b) ?? new WeakMap<Blob, boolean>();
    reverse.set(a, identical); duplicateProofs.set(b, reverse);
    return identical;
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
