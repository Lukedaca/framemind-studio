import { describe, expect, it } from 'vitest';
import { applyFileEdits, createHistory, historyReducer, HISTORY_LIMIT, INITIAL_EDITS } from '../utils/editorHistory';
import type { UploadedFile } from '../types';

const original = new File([new Uint8Array([12, 34, 56])], 'photo.jpg', { type: 'image/jpeg' });
const photo: UploadedFile = { id: 'photo', file: original, baseFile: original, originalFile: original, previewUrl: 'blob:original', originalPreviewUrl: 'blob:original' };

describe('nondestructive editor history', () => {
  it('undoes and redoes adjustments without changing image bytes or the imported snapshot', async () => {
    const initial = createHistory([photo]);
    const edited = historyReducer(initial, { type: 'SET', payload: { state: applyFileEdits(initial.present.state, { photo: { ...INITIAL_EDITS, brightness: 35 } }), actionName: 'Brightness' } });
    expect(edited.present.state[0].edits.brightness).toBe(35);
    expect(photo.edits).toBeUndefined();
    expect(edited.present.state[0].file).toBe(original);
    const undone = historyReducer(edited, { type: 'UNDO' });
    expect(undone.present.state).toBe(initial.present.state);
    expect(historyReducer(undone, { type: 'REDO' }).present.state[0].edits.brightness).toBe(35);
    expect([...new Uint8Array(await original.arrayBuffer())]).toEqual([12, 34, 56]);
  });
  it('keeps redo for no-op gestures, and clears it for a real new edit', () => {
    const edited = historyReducer(createHistory([photo]), { type: 'SET', payload: { state: applyFileEdits([photo], { photo: { ...INITIAL_EDITS, brightness: 25 } }), actionName: 'Brightness' } });
    const undone = historyReducer(edited, { type: 'UNDO' });
    expect(historyReducer(undone, { type: 'SET', payload: { state: applyFileEdits(undone.present.state, { photo: INITIAL_EDITS }), actionName: 'No change' } })).toBe(undone);
    const changed = historyReducer(undone, { type: 'SET', payload: { state: applyFileEdits(undone.present.state, { photo: { ...INITIAL_EDITS, saturation: 10 } }), actionName: 'Saturation' } });
    expect(changed.future).toHaveLength(0);
  });
  it('keeps crop, reset and retouch in one ordered history', () => {
    let history = createHistory([photo]);
    const commit = (state: UploadedFile[], actionName: string) => { history = historyReducer(history, { type: 'SET', payload: { state, actionName } }); };
    commit(applyFileEdits(history.present.state, { photo: { ...INITIAL_EDITS, aspectRatio: 1 } }), 'Crop');
    const retouched = new File(['retouched'], 'photo.jpg');
    commit(history.present.state.map(file => ({ ...file, file: retouched, previewUrl: 'blob:retouched' })), 'Retouch');
    commit([{ ...photo, edits: INITIAL_EDITS }], 'Restore original');
    history = historyReducer(history, { type: 'UNDO' });
    expect(history.present.state[0].file).toBe(retouched);
    expect(history.present.state[0].edits.aspectRatio).toBe(1);
    history = historyReducer(history, { type: 'UNDO' });
    expect(history.present.state[0].file).toBe(original);
    expect(history.present.state[0].edits.aspectRatio).toBe(1);
  });
  it('does not carry another project into Undo and bounds retained snapshots', () => {
    let history = createHistory([photo]);
    for (let i = 1; i < 80; i++) history = historyReducer(history, { type: 'SET', payload: { state: applyFileEdits(history.present.state, { photo: { ...INITIAL_EDITS, brightness: i } }), actionName: 'Adjust' } });
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    history = historyReducer(history, { type: 'REPLACE', payload: createHistory([]) });
    expect(history.past).toHaveLength(0);
    expect(historyReducer(history, { type: 'UNDO' }).present.state).toEqual([]);
  });
});
