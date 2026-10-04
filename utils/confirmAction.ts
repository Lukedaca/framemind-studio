import { isTauri } from '@tauri-apps/api/core';

export const confirmAction = async (message: string): Promise<boolean> => {
  if (isTauri()) {
    // The public API uses the message command; the injected window.confirm
    // alias in plugin 2.8.1 still calls a legacy command.
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    return confirm(message, { title: 'FrameMind Studio', kind: 'warning' });
  }
  return window.confirm(message);
};
