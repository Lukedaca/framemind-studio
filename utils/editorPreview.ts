import type { ManualEdits } from '../types';
import { renderEdits } from './imageRenderer';
import { EDITOR_PREVIEW_MAX_SIZE, type PreviewRequest, type PreviewResponse } from './editorPreviewProtocol';
type Job = PreviewRequest & { resolve: (blob: Blob) => void; reject: (error: unknown) => void };
const aborted = () => new DOMException('Preview superseded or disposed.', 'AbortError');

/** One active render and one replaceable pending render. No slider-event backlog. */
export class EditorPreviewRenderer {
  private worker: Worker | null = null;
  private workerFailed = false;
  private cancelWorker: (() => void) | null = null;
  private current: Job | null = null;
  private pending: Job | null = null;
  private sequence = 0;
  private disposed = false;
  private imageKey: string | null = null;
  private image: Promise<HTMLImageElement> | null = null;

  render(file: File, sourceKey: string, edits: ManualEdits): Promise<Blob> {
    if (this.disposed) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      this.pending?.reject(aborted());
      this.pending = { id: ++this.sequence, file, sourceKey, edits, resolve, reject };
      void this.drain();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.current?.reject(aborted());
    this.pending?.reject(aborted());
    this.pending = null;
    this.cancelWorker?.();
    this.worker?.terminate();
    this.worker = null;
    this.image = null;
  }

  private async drain(): Promise<void> {
    if (this.current || !this.pending || this.disposed) return;
    const job = this.pending;
    this.pending = null;
    this.current = job;
    try {
      const blob = await this.execute(job);
      if (this.disposed || job.id !== this.sequence) job.reject(aborted());
      else job.resolve(blob);
    } catch (error) {
      job.reject(error);
    } finally {
      this.current = null;
      void this.drain();
    }
  }

  private async execute(job: PreviewRequest): Promise<Blob> {
    if (!this.workerFailed && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        this.worker ??= new Worker(new URL('../workers/editorPreview.worker.ts', import.meta.url), { type: 'module' });
        return await this.inWorker(job);
      } catch (error) {
        if (this.disposed) throw error;
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = null;
      }
    }
    if (this.disposed || job.id !== this.sequence) throw aborted();
    return this.fallback(job);
  }

  private inWorker(job: PreviewRequest): Promise<Blob> {
    const worker = this.worker!;
    return new Promise((resolve, reject) => {
      const finish = (blob?: Blob, error?: Error) => {
        clearTimeout(timeout);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        this.cancelWorker = null;
        if (error) reject(error);
        else if (blob) resolve(blob);
        else reject(new Error('Preview worker returned no image.'));
      };
      const timeout = setTimeout(() => finish(undefined, new Error('Preview worker timed out.')), 15000);
      this.cancelWorker = () => finish(undefined, aborted());
      worker.onmessage = ({ data }: MessageEvent<PreviewResponse>) => {
        if (data.id !== job.id) return;
        finish(data.blob, data.error ? new Error(data.error) : undefined);
      };
      worker.onerror = event => { event.preventDefault(); finish(undefined, new Error(event.message || 'Preview worker failed.')); };
      worker.onmessageerror = () => finish(undefined, new Error('Preview worker message failed.'));
      try {
        // Send only the protocol fields, never the callbacks on the internal job.
        worker.postMessage({ id: job.id, sourceKey: job.sourceKey, file: job.file, edits: job.edits } satisfies PreviewRequest);
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async fallback(job: PreviewRequest): Promise<Blob> {
    if (this.imageKey !== job.sourceKey || !this.image) {
      this.imageKey = job.sourceKey;
      this.image = new Promise((resolve, reject) => {
        const url = URL.createObjectURL(job.file);
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to decode editor preview.')); };
        image.src = url;
      });
      // A failed decode must be retryable on the next request.
      this.image.catch(() => { if (this.imageKey === job.sourceKey) this.image = null; });
    }
    const image = await this.image;
    if (this.disposed || job.id !== this.sequence) throw aborted();
    const canvas = renderEdits(
      { image, width: image.naturalWidth, height: image.naturalHeight }, job.edits,
      { scale: 1, maxSize: EDITOR_PREVIEW_MAX_SIZE }, () => document.createElement('canvas'),
    );
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Preview encoding failed.')), 'image/png');
    });
  }
}
