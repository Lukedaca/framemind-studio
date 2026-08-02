// Správa uživatelského Gemini API klíče v prohlížeči (BYOK).
//
// Režimy:
// - 'session' (výchozí): klíč žije JEN v sessionStorage — zavřením záložky/okna
//   zmizí sám, bez závislosti na beforeunload.
// - 'persistent': klíč v localStorage, pouze po explicitním souhlasu uživatele
//   (potvrzení řeší UI vrstva před voláním setMode('persistent')).
//
// Klíč se nikdy neloguje. Browser storage není ekvivalent serverového
// zabezpečení — pro veřejný SaaS provoz bude nutný serverový proxy endpoint.

const API_KEY_STORAGE_KEY = 'fotograf_user_api_key_v1';
const STORAGE_MODE_KEY = 'fotograf_api_key_storage_mode_v1';
const LEGACY_SESSION_ONLY_KEY = 'fotograf_api_key_session_only_v1';

export type ApiKeyStorageMode = 'session' | 'persistent';

const activeStorage = (mode: ApiKeyStorageMode): Storage =>
  mode === 'session' ? sessionStorage : localStorage;

export const apiKeyManager = {
  getMode(): ApiKeyStorageMode {
    const stored = localStorage.getItem(STORAGE_MODE_KEY);
    if (stored === 'session' || stored === 'persistent') return stored;
    // Migrace ze starého flagu: '0' = uživatel dřív explicitně zvolil persistent.
    // Vše ostatní (missing, '1') → bezpečný default session-only.
    return localStorage.getItem(LEGACY_SESSION_ONLY_KEY) === '0' ? 'persistent' : 'session';
  },

  setMode(mode: ApiKeyStorageMode): void {
    const previous = this.getMode();
    if (previous !== mode) {
      // Přenést klíč do nového úložiště, ze starého odstranit — žádný duplikát.
      const key = activeStorage(previous).getItem(API_KEY_STORAGE_KEY);
      activeStorage(previous).removeItem(API_KEY_STORAGE_KEY);
      if (key) activeStorage(mode).setItem(API_KEY_STORAGE_KEY, key);
    }
    localStorage.setItem(STORAGE_MODE_KEY, mode);
  },

  isSessionOnly(): boolean {
    return this.getMode() === 'session';
  },

  /**
   * Jednorázová migrace při startu aplikace: zafixuje režim a přesune klíč
   * uložený starou verzí do správného úložiště (session-only klíč nesmí
   * zůstat v localStorage).
   */
  init(): void {
    const mode = this.getMode();
    localStorage.setItem(STORAGE_MODE_KEY, mode);
    localStorage.removeItem(LEGACY_SESSION_ONLY_KEY);
    if (mode === 'session') {
      const leftover = localStorage.getItem(API_KEY_STORAGE_KEY);
      if (leftover) {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
        if (!sessionStorage.getItem(API_KEY_STORAGE_KEY)) {
          sessionStorage.setItem(API_KEY_STORAGE_KEY, leftover);
        }
      }
    }
  },

  save(key: string): void {
    const trimmed = key.trim();
    if (!trimmed) return;
    const mode = this.getMode();
    activeStorage(mode).setItem(API_KEY_STORAGE_KEY, trimmed);
    // Druhé úložiště vyčistit — klíč smí existovat jen v aktivním režimu.
    activeStorage(mode === 'session' ? 'persistent' : 'session').removeItem(API_KEY_STORAGE_KEY);
  },

  get(): string | null {
    const stored = activeStorage(this.getMode()).getItem(API_KEY_STORAGE_KEY);
    if (!stored) return null;
    return stored.trim() || null;
  },

  clear(): void {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    sessionStorage.removeItem(API_KEY_STORAGE_KEY);
  },

  exists(): boolean {
    return !!this.get();
  },

  clearLegacyKeys(): void {
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('artifex_user_api_key');
  },
};
