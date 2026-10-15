import type { History, HistoryEntry, ManualEdits, UploadedFile } from '../types';

export const HISTORY_LIMIT = 60;
export const INITIAL_EDITS: ManualEdits = {
  brightness: 0, contrast: 0, saturation: 0, vibrance: 0, shadows: 0,
  highlights: 0, clarity: 0, sharpness: 0, noiseReduction: 0,
  aspectRatio: undefined, cropRect: undefined,
  watermark: { enabled: false, text: '', opacity: 50, size: 20, position: 'bottom-right', color: '#ffffff' },
};

export function editsEqual(a: ManualEdits = INITIAL_EDITS, b: ManualEdits = INITIAL_EDITS): boolean {
  const numeric: (keyof ManualEdits)[] = ['brightness', 'contrast', 'saturation', 'vibrance', 'shadows', 'highlights', 'clarity', 'sharpness', 'noiseReduction', 'aspectRatio'];
  return numeric.every(key => a[key] === b[key])
    && JSON.stringify(a.cropRect ?? null) === JSON.stringify(b.cropRect ?? null)
    && JSON.stringify(a.watermark ?? INITIAL_EDITS.watermark) === JSON.stringify(b.watermark ?? INITIAL_EDITS.watermark);
}

/** Commit a complete gesture once; never modify the imported File. */
export function applyFileEdits(files: UploadedFile[], updates: Record<string, ManualEdits>): UploadedFile[] {
  let changed = false;
  const next = files.map(file => {
    const edits = updates[file.id];
    if (!edits || editsEqual(file.edits, edits)) return file;
    changed = true;
    return { ...file, edits };
  });
  return changed ? next : files;
}

export function createHistory(files: UploadedFile[] = []): History {
  return { past: [], present: { state: files, actionName: 'Initial state' }, future: [] };
}

export type HistoryAction = { type: 'SET'; payload: HistoryEntry } | { type: 'REPLACE'; payload: History } | { type: 'UNDO' } | { type: 'REDO' };

export function historyReducer(state: History, action: HistoryAction): History {
  const { past, present, future } = state;
  switch (action.type) {
    case 'REPLACE': return { ...action.payload, past: action.payload.past.slice(-HISTORY_LIMIT), future: action.payload.future.slice(0, HISTORY_LIMIT) };
    case 'SET':
      if (action.payload.state === present.state) return state;
      return { past: [...past, present].slice(-HISTORY_LIMIT), present: action.payload, future: [] };
    case 'UNDO':
      return past.length ? { past: past.slice(0, -1), present: past[past.length - 1], future: [present, ...future].slice(0, HISTORY_LIMIT) } : state;
    case 'REDO':
      return future.length ? { past: [...past, present].slice(-HISTORY_LIMIT), present: future[0], future: future.slice(1) } : state;
  }
}
