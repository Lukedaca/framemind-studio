import { isDesktopApp, pickDesktopDirectory, saveDesktopBlob, writeDesktopBlob } from './desktopFiles';
import type { DesktopDirectory } from './desktopFiles';

export type SupportedExportFormat = 'jpeg' | 'png';

const MIME_BY_FORMAT: Record<SupportedExportFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const EXTENSION_BY_FORMAT: Record<SupportedExportFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
};

type SaveFilePicker = (options?: {
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

type BrowserDirectoryHandle = {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

export type NativeDirectoryHandle = BrowserDirectoryHandle | DesktopDirectory;

type DirectoryPicker = (options?: {
  mode?: 'read' | 'readwrite';
}) => Promise<BrowserDirectoryHandle>;

const getSaveFilePicker = (): SaveFilePicker | null => {
  if (typeof window === 'undefined') return null;

  const pickerWindow = window as Window & {
    showSaveFilePicker?: SaveFilePicker;
  };

  return pickerWindow.showSaveFilePicker ?? null;
};

const getDirectoryPicker = (): DirectoryPicker | null => {
  if (typeof window === 'undefined') return null;

  const pickerWindow = window as Window & {
    showDirectoryPicker?: DirectoryPicker;
  };

  return pickerWindow.showDirectoryPicker ?? null;
};

export const supportsNativeSavePicker = (): boolean => isDesktopApp() || getSaveFilePicker() !== null;
export const supportsNativeDirectoryPicker = (): boolean => isDesktopApp() || getDirectoryPicker() !== null;

export const buildEditedFileName = (originalName: string, format: SupportedExportFormat): string => {
  const baseName = originalName.replace(/\.[^/.]+$/, '');
  return `edited_${baseName}.${EXTENSION_BY_FORMAT[format]}`;
};

export const downloadBlob = async (blob: Blob, fileName: string): Promise<void> => {
  if (isDesktopApp()) {
    await saveDesktopBlob(blob, fileName, blob.type === 'image/png' ? 'png' : 'jpeg');
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const saveBlobWithPicker = async (
  blob: Blob,
  fileName: string,
  format: SupportedExportFormat
) => {
  if (isDesktopApp()) {
    await saveDesktopBlob(blob, fileName, format);
    return;
  }
  const savePicker = getSaveFilePicker();
  if (!savePicker) {
    throw new Error('SAVE_PICKER_UNSUPPORTED');
  }

  const handle = await savePicker({
    suggestedName: fileName,
    types: [
      {
        description: format.toUpperCase(),
        accept: {
          [MIME_BY_FORMAT[format]]: [`.${EXTENSION_BY_FORMAT[format]}`],
        },
      },
    ],
  });

  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
};

export const pickDirectoryForSave = async (): Promise<NativeDirectoryHandle> => {
  if (isDesktopApp()) return pickDesktopDirectory();
  const directoryPicker = getDirectoryPicker();
  if (!directoryPicker) {
    throw new Error('DIRECTORY_PICKER_UNSUPPORTED');
  }

  return directoryPicker({ mode: 'readwrite' });
};

export const saveBlobToDirectory = async (
  directoryHandle: NativeDirectoryHandle,
  blob: Blob,
  fileName: string
) => {
  if ('desktopPath' in directoryHandle) {
    await writeDesktopBlob(directoryHandle, blob, fileName);
    return;
  }
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
};
