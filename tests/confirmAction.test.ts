import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmAction } from '../utils/confirmAction';

const dialog = vi.hoisted(() => ({ isTauri: vi.fn(), confirm: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: dialog.isTauri }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: dialog.confirm }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('confirmation across desktop and browser', () => {
  it('waits for a native cancellation instead of treating its Promise as approval', async () => {
    dialog.isTauri.mockReturnValue(true);
    let respond: (value: boolean) => void;
    dialog.confirm.mockReturnValue(new Promise<boolean>(resolve => { respond = resolve; }));
    const result = confirmAction('Remove from set?');
    await vi.waitFor(() => expect(dialog.confirm).toHaveBeenCalled());
    respond!(false);
    expect(await result).toBe(false);
  });
  it('propagates native approval', async () => {
    dialog.isTauri.mockReturnValue(true); dialog.confirm.mockResolvedValue(true);
    expect(await confirmAction('Remove from set?')).toBe(true);
  });
  it('preserves browser confirmation', async () => {
    dialog.isTauri.mockReturnValue(false);
    const confirm = vi.fn(() => false); vi.stubGlobal('window', { confirm });
    expect(await confirmAction('Remove from set?')).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Remove from set?');
    expect(dialog.confirm).not.toHaveBeenCalled();
  });
});
