import { isTauri } from '@tauri-apps/api/core';

export type DesktopDirectory = { desktopPath: string };

export const isDesktopApp = (): boolean => typeof window !== 'undefined' && isTauri();

const assertFileName = (fileName: string) => {
  if (!fileName || fileName === '.' || fileName === '..' ||
      /[<>:"/\\|?*\x00-\x1f]/.test(fileName) || /[. ]$/.test(fileName) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(fileName)) {
    throw new Error('INVALID_EXPORT_FILE_NAME');
  }
};

const cancelled = () => new DOMException('Save cancelled', 'AbortError');

export const saveDesktopBlob = async (
  blob: Blob,
  fileName: string,
  format: 'jpeg' | 'png',
): Promise<void> => {
  assertFileName(fileName);
  const { save } = await import('@tauri-apps/plugin-dialog');
  const filePath = await save({
    defaultPath: fileName,
    filters: [{ name: format.toUpperCase(), extensions: [format === 'jpeg' ? 'jpg' : 'png'] }],
  });
  if (!filePath) throw cancelled();
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
};

export const pickDesktopDirectory = async (): Promise<DesktopDirectory> => {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const directory = await open({ directory: true, multiple: false, recursive: true });
  if (!directory) throw cancelled();
  return { desktopPath: directory };
};

export const writeDesktopBlob = async (
  directory: DesktopDirectory,
  blob: Blob,
  fileName: string,
): Promise<void> => {
  assertFileName(fileName);
  const [{ join }, { writeFile }] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs'),
  ]);
  await writeFile(await join(directory.desktopPath, fileName), new Uint8Array(await blob.arrayBuffer()));
};
