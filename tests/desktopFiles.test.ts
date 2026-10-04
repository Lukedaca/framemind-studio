import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, pickDirectoryForSave, saveBlobToDirectory, saveBlobWithPicker, supportsNativeDirectoryPicker, supportsNativeSavePicker } from '../utils/fileSave';

const native = vi.hoisted(() => ({
  isTauri: vi.fn(), save: vi.fn(), open: vi.fn(), writeFile: vi.fn(),
  join: vi.fn(async (directory: string, name: string) => `${directory}\\${name}`),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }));
vi.mock('@tauri-apps/api/path', () => ({ join: native.join }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: native.save, open: native.open }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: native.writeFile }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', {});
  native.isTauri.mockReturnValue(true);
  native.save.mockResolvedValue('C:\\Exports\\edited_photo.png');
  native.open.mockResolvedValue('C:\\Exports');
  native.writeFile.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('desktop export', () => {
  it('uses native save dialogs and writes the exact bytes to the selected file', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    expect(supportsNativeSavePicker()).toBe(true);
    expect(supportsNativeDirectoryPicker()).toBe(true);
    await downloadBlob(blob, 'edited_photo.png');
    expect(native.save).toHaveBeenCalledWith({
      defaultPath: 'edited_photo.png', filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    expect(native.writeFile).toHaveBeenCalledWith('C:\\Exports\\edited_photo.png', new Uint8Array([137, 80, 78, 71]));
  });

  it('does not write anything after cancelling the save dialog', async () => {
    native.save.mockResolvedValue(null);
    await expect(saveBlobWithPicker(new Blob(['photo']), 'edited_photo.jpg', 'jpeg')).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.writeFile).not.toHaveBeenCalled();
  });

  it('writes a batch into the directory selected by the user', async () => {
    const directory = await pickDirectoryForSave();
    await saveBlobToDirectory(directory, new Blob(['photo']), 'edited_photo.jpg');
    expect(native.open).toHaveBeenCalledWith({ directory: true, multiple: false, recursive: true });
    expect(native.writeFile).toHaveBeenCalledWith('C:\\Exports\\edited_photo.jpg', new Uint8Array([112, 104, 111, 116, 111]));
  });

  it('cancels the whole batch when no directory is selected', async () => {
    native.open.mockResolvedValue(null);
    await expect(pickDirectoryForSave()).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.writeFile).not.toHaveBeenCalled();
  });

  it.each(['../photo.jpg', '..\\photo.jpg', 'C:\\photo.jpg', 'photo:stream.jpg', 'NUL.jpg', 'photo.jpg ', ''])('rejects an unsafe batch filename: %s', async (name) => {
    await expect(saveBlobToDirectory({ desktopPath: 'C:\\Exports' }, new Blob(['photo']), name)).rejects.toThrow('INVALID_EXPORT_FILE_NAME');
    expect(native.join).not.toHaveBeenCalled();
    expect(native.writeFile).not.toHaveBeenCalled();
  });

  it('keeps browser saving available outside Tauri', async () => {
    native.isTauri.mockReturnValue(false);
    const write = vi.fn();
    const close = vi.fn();
    const showSaveFilePicker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
    vi.stubGlobal('window', { showSaveFilePicker });
    const blob = new Blob(['photo']);
    await saveBlobWithPicker(blob, 'edited_photo.jpg', 'jpeg');
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalled();
    expect(native.save).not.toHaveBeenCalled();
  });
});
