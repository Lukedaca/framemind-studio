// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageProjectStorage, type StoredData } from '../services/projectStorage';

const STORAGE_KEY = 'fotograf_crm_v1';

const sample: StoredData = {
  clients: [
    { id: 'c-1', name: 'Test Klient', email: 'klient@example.com', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  projects: [],
};

beforeEach(() => {
  localStorage.clear();
});

describe('LocalStorageProjectStorage', () => {
  it('load vrací null, když nic není uloženo', async () => {
    const storage = new LocalStorageProjectStorage();
    expect(await storage.load()).toBeNull();
  });

  it('save + load roundtrip', async () => {
    const storage = new LocalStorageProjectStorage();
    await storage.save(sample);
    const loaded = await storage.load();
    expect(loaded).toEqual(sample);
  });

  it('nevalidní schéma se odstraní a vrátí null', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ clients: [{ id: 42 }], projects: [] }));
    const storage = new LocalStorageProjectStorage();
    expect(await storage.load()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('rozbitý JSON se odstraní a vrátí null', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const storage = new LocalStorageProjectStorage();
    expect(await storage.load()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
