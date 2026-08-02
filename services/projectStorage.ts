// Storage abstrakce pro CRM (projekty + klienti). Aktuální implementace je
// čistě lokální (localStorage): data nejsou synchronizovaná mezi zařízeními
// a smazání dat prohlížeče je odstraní — UI i README to musí říkat.
//
// Budoucí cloudová synchronizace implementuje stejné rozhraní ProjectStorage
// a vymění se v ProjectContext — UI ani business logika se nemění.

import type { Client, Project } from '../types';

export interface StoredData {
  clients: Client[];
  projects: Project[];
}

export interface ProjectStorage {
  /** Vrací null, když nic není uloženo nebo data neprošla validací. */
  load(): Promise<StoredData | null>;
  save(data: StoredData): Promise<void>;
}

const STORAGE_KEY = 'fotograf_crm_v1';

function isValidStoredData(data: unknown): data is StoredData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.clients)) return false;
  if (!Array.isArray(obj.projects)) return false;
  for (const client of obj.clients) {
    if (!client || typeof client !== 'object') return false;
    if (typeof (client as Client).id !== 'string') return false;
    if (typeof (client as Client).name !== 'string') return false;
  }
  return true;
}

export class LocalStorageProjectStorage implements ProjectStorage {
  async load(): Promise<StoredData | null> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (isValidStoredData(parsed)) {
        return { clients: parsed.clients, projects: parsed.projects };
      }
      console.warn('Invalid CRM data schema, resetting to defaults');
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to parse CRM storage.', error);
      localStorage.removeItem(STORAGE_KEY);
    }
    return null;
  }

  async save(data: StoredData): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

export const projectStorage: ProjectStorage = new LocalStorageProjectStorage();
