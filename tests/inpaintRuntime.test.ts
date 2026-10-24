import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class TestWorker {
  static instances: TestWorker[] = [];
  messages: Record<string, any>[] = [];
  terminated = false;
  onmessage: ((event: { data: Record<string, any> }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor() { TestWorker.instances.push(this); }
  postMessage(message: Record<string, any>) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(id: number, response: Record<string, any>) { this.onmessage?.({ data: { id, ...response } }); }
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const ready = (worker: TestWorker) => {
  for (const message of worker.messages) worker.reply(message.id, { type: 'ready', backend: 'wasm' });
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('local retouch runtime recovery', () => {
  it('retries a GPU timeout in a new CPU worker, never the initializing runtime', async () => {
    const { preloadInpaintModel } = await import('../services/localInpaint');
    const pending = preloadInpaintModel('fast');
    const original = TestWorker.instances[0];
    original.reply(original.messages[0].id, { type: 'error', error: 'INPAINT_GPU_TIMEOUT' });
    await flush();
    expect(original.terminated).toBe(true);
    expect(TestWorker.instances).toHaveLength(2);
    const replacement = TestWorker.instances[1];
    expect(replacement.messages[0]).toMatchObject({ type: 'config', disableGpu: true });
    expect(replacement.messages[0].numThreads).toBeUndefined();
    expect(replacement.messages[1]).toMatchObject({ type: 'load', model: 'fast' });
    ready(replacement);
    await expect(pending).resolves.toBe('wasm');
  });

  it('shares one replacement worker when a GPU timeout invalidates concurrent callers', async () => {
    const { preloadInpaintModel } = await import('../services/localInpaint');
    const first = preloadInpaintModel('fast');
    const second = preloadInpaintModel('quality');
    const original = TestWorker.instances[0];
    original.reply(original.messages[0].id, { type: 'error', error: 'INPAINT_GPU_TIMEOUT' });
    await flush();
    expect(TestWorker.instances).toHaveLength(2);
    const replacement = TestWorker.instances[1];
    expect(replacement.terminated).toBe(false);
    expect(replacement.messages.filter(m => m.type === 'config')).toHaveLength(1);
    expect(replacement.messages.filter(m => m.type === 'load').map(m => m.model)).toEqual(['fast', 'quality']);
    ready(replacement);
    await expect(Promise.all([first, second])).resolves.toEqual(['wasm', 'wasm']);
  });

  it('restarts a stuck initialization with GPU disabled and one CPU thread', async () => {
    const { preloadInpaintModel } = await import('../services/localInpaint');
    const pending = preloadInpaintModel('fast');
    const original = TestWorker.instances[0];
    original.reply(original.messages[0].id, { type: 'progress', phase: 'init' });
    await vi.advanceTimersByTimeAsync(150001);
    expect(original.terminated).toBe(true);
    const replacement = TestWorker.instances[1];
    expect(replacement.messages[0]).toMatchObject({ type: 'config', disableGpu: true, numThreads: 1 });
    ready(replacement);
    await expect(pending).resolves.toBe('wasm');
  });

  it('does not keep restarting a CPU retry that also fails', async () => {
    const { preloadInpaintModel } = await import('../services/localInpaint');
    const pending = preloadInpaintModel('fast');
    const rejected = expect(pending).rejects.toThrow('CPU_INIT_FAILED');
    const original = TestWorker.instances[0];
    original.reply(original.messages[0].id, { type: 'error', error: 'INPAINT_GPU_TIMEOUT' });
    await flush();
    const replacement = TestWorker.instances[1];
    const load = replacement.messages.find(m => m.type === 'load')!;
    replacement.reply(load.id, { type: 'error', error: 'CPU_INIT_FAILED' });
    await rejected;
    expect(TestWorker.instances).toHaveLength(2);
  });

  it('gives computation its own timeout instead of restarting it as initialization', async () => {
    const { preloadInpaintModel } = await import('../services/localInpaint');
    const pending = preloadInpaintModel('quality');
    const rejected = expect(pending).rejects.toThrow('INPAINT_COMPUTE_TIMEOUT');
    const worker = TestWorker.instances[0];
    const id = worker.messages[0].id;
    worker.reply(id, { type: 'progress', phase: 'init' });
    await vi.advanceTimersByTimeAsync(100000);
    worker.reply(id, { type: 'progress', phase: 'compute', backend: 'wasm' });
    await vi.advanceTimersByTimeAsync(150000);
    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(150001);
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(TestWorker.instances).toHaveLength(1);
  });
});
