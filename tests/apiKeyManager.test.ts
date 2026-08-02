// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { apiKeyManager } from '../services/apiKeyManager';

const KEY = 'fotograf_user_api_key_v1';
const MODE = 'fotograf_api_key_storage_mode_v1';
const LEGACY = 'fotograf_api_key_session_only_v1';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('apiKeyManager', () => {
  it('výchozí režim je session-only', () => {
    expect(apiKeyManager.getMode()).toBe('session');
    expect(apiKeyManager.isSessionOnly()).toBe(true);
  });

  it('session-only režim nepoužívá localStorage', () => {
    apiKeyManager.save('AIza-test-123');
    expect(sessionStorage.getItem(KEY)).toBe('AIza-test-123');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(apiKeyManager.get()).toBe('AIza-test-123');
  });

  it('persistent režim ukládá do localStorage', () => {
    apiKeyManager.setMode('persistent');
    apiKeyManager.save('AIza-persist');
    expect(localStorage.getItem(KEY)).toBe('AIza-persist');
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(apiKeyManager.get()).toBe('AIza-persist');
  });

  it('přepnutí persistent → session přesune klíč a odstraní ho z localStorage', () => {
    apiKeyManager.setMode('persistent');
    apiKeyManager.save('AIza-move');
    apiKeyManager.setMode('session');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBe('AIza-move');
    expect(apiKeyManager.get()).toBe('AIza-move');
  });

  it('přepnutí session → persistent přesune klíč bez duplikátu', () => {
    apiKeyManager.save('AIza-up');
    apiKeyManager.setMode('persistent');
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('AIza-up');
  });

  it('clear odstraní klíč z obou úložišť', () => {
    sessionStorage.setItem(KEY, 'a');
    localStorage.setItem(KEY, 'b');
    apiKeyManager.clear();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(apiKeyManager.get()).toBeNull();
  });

  it('get čte podle aktivního režimu', () => {
    sessionStorage.setItem(KEY, 'session-key');
    localStorage.setItem(KEY, 'local-key');
    expect(apiKeyManager.get()).toBe('session-key');
    localStorage.setItem(MODE, 'persistent');
    expect(apiKeyManager.get()).toBe('local-key');
  });

  it('init migruje klíč ze staré verze (localStorage) do sessionStorage', () => {
    localStorage.setItem(KEY, 'legacy-key');
    apiKeyManager.init();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBe('legacy-key');
    expect(localStorage.getItem(MODE)).toBe('session');
  });

  it('legacy flag "0" (dřívější explicitní persistent) se migruje na persistent', () => {
    localStorage.setItem(LEGACY, '0');
    localStorage.setItem(KEY, 'legacy-persist');
    apiKeyManager.init();
    expect(apiKeyManager.getMode()).toBe('persistent');
    expect(localStorage.getItem(KEY)).toBe('legacy-persist');
    expect(localStorage.getItem(LEGACY)).toBeNull();
  });

  it('prázdný klíč se neukládá', () => {
    apiKeyManager.save('   ');
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(apiKeyManager.exists()).toBe(false);
  });
});
