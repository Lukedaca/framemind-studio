import type { EditorWorkspace, History, HistoryEntry, Project, UploadedFile } from '../types';
import type { ProjectStorage, StoredData } from './projectStorage';
import { HISTORY_LIMIT } from '../utils/editorHistory';

type StoredPhoto = Omit<UploadedFile, 'file' | 'originalFile' | 'baseFile' | 'previewUrl' | 'originalPreviewUrl'> & {
  fileKey: string; originalKey: string; baseKey: string;
};
type StoredEntry = Omit<HistoryEntry, 'state'> & { state: StoredPhoto[] };
type StoredHistory = { past: StoredEntry[]; present: StoredEntry; future: StoredEntry[] };
type StoredProject = Omit<Project, 'files' | 'editorHistory'> & { files: StoredPhoto[]; editorHistory?: StoredHistory };
type Snapshot = {
  version: 2; clients: StoredData['clients']; projects: StoredProject[];
  workspace?: Omit<EditorWorkspace, 'history'> & { history: StoredHistory };
};
type Asset = { blob: Blob; name: string; type: string; lastModified: number };

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local storage request failed.'));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('Local storage transaction aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('Local storage transaction failed.'));
  });
}

/** Files stay in their own store. Slider commits write metadata, not photo bytes again. */
export class IndexedDbProjectStorage implements ProjectStorage {
  private database: Promise<IDBDatabase> | null = null;
  private assetKeys = new WeakMap<Blob, string>();
  private restored = new Map<string, { file: File; url: string }>();
  private storedAssetKeys = new Set<string>();
  private saves: Promise<void> = Promise.resolve();

  constructor(private readonly databaseName = 'framemind-studio-projects-v2') {}

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(this.databaseName, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('metadata');
          request.result.createObjectStore('assets');
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); this.database = null; };
          resolve(db);
        };
        request.onerror = () => reject(request.error || new Error('Local project storage is unavailable.'));
        request.onblocked = () => reject(new Error('Close the other Studio window and retry opening local storage.'));
      }).catch(error => { this.database = null; throw error; });
    }
    return this.database;
  }

  async load(): Promise<StoredData | null> {
    await this.saves;
    const db = await this.open();
    const snapshot = await result(db.transaction('metadata', 'readonly').objectStore('metadata').get('crm')) as Snapshot | undefined;
    if (!snapshot) return this.loadLegacy();
    if (snapshot.version !== 2 || !Array.isArray(snapshot.clients) || !Array.isArray(snapshot.projects)) {
      throw new Error('Local project data has an unsupported or damaged format.');
    }
    const keys = new Set<string>();
    const collect = (files: StoredPhoto[]) => files.forEach(file => { keys.add(file.fileKey); keys.add(file.originalKey); keys.add(file.baseKey); });
    const collectHistory = (history?: StoredHistory) => {
      if (history) [history.present, ...history.past, ...history.future].forEach(entry => collect(entry.state));
    };
    snapshot.projects.forEach(project => { collect(project.files); collectHistory(project.editorHistory); });
    collectHistory(snapshot.workspace?.history);
    this.storedAssetKeys = keys;
    const missing = [...keys].filter(key => !this.restored.has(key));
    if (missing.length) {
      const transaction = db.transaction('assets', 'readonly');
      const assets = transaction.objectStore('assets');
      const requests = missing.map(key => result(assets.get(key)).then((asset: Asset | undefined) => ({ key, asset })));
      const loaded = await Promise.all(requests);
      for (const { key, asset } of loaded) {
        if (!asset || !(asset.blob instanceof Blob)) throw new Error('A stored project image is unavailable. Original disk files were not changed.');
        const file = new File([asset.blob], asset.name, { type: asset.type, lastModified: asset.lastModified });
        this.assetKeys.set(file, key);
        this.restored.set(key, { file, url: URL.createObjectURL(file) });
      }
    }
    const photos = new WeakMap<StoredPhoto, UploadedFile>();
    const unpack = (photo: StoredPhoto): UploadedFile => {
      const existing = photos.get(photo);
      if (existing) return existing;
      const { fileKey, originalKey, baseKey, ...metadata } = photo;
      const current = this.restored.get(fileKey)!;
      const original = this.restored.get(originalKey)!;
      const base = this.restored.get(baseKey)!;
      const file = { ...metadata, file: current.file, originalFile: original.file, baseFile: base.file, previewUrl: current.url, originalPreviewUrl: base.url };
      photos.set(photo, file);
      return file;
    };
    const unpackEntry = (entry: StoredEntry): HistoryEntry => ({ ...entry, state: entry.state.map(unpack) });
    const unpackHistory = (history: StoredHistory): History => ({ past: history.past.slice(-HISTORY_LIMIT).map(unpackEntry), present: unpackEntry(history.present), future: history.future.slice(0, HISTORY_LIMIT).map(unpackEntry) });
    return {
      clients: snapshot.clients,
      projects: snapshot.projects.map(project => ({ ...project, files: project.files.map(unpack), editorHistory: project.editorHistory ? unpackHistory(project.editorHistory) : undefined })),
      workspace: snapshot.workspace ? { ...snapshot.workspace, history: unpackHistory(snapshot.workspace.history) } : null,
    };
  }

  save(data: StoredData, options?: { discardUnusedPhotos?: boolean }): Promise<void> {
    const next = this.saves.catch(() => {}).then(() => this.write(data, options?.discardUnusedPhotos === true));
    this.saves = next;
    return next;
  }

  private async write(data: StoredData, discardUnusedPhotos: boolean): Promise<void> {
    const db = await this.open();
    const newAssets = new Map<Blob, { key: string; asset: Asset }>();
    const usedKeys = new Set<string>();
    const assetKey = (file: File): string => {
      if (!(file instanceof Blob)) throw new Error('Cannot save an unavailable photo.');
      const previous = this.assetKeys.get(file);
      const known = (previous && this.storedAssetKeys.has(previous) ? previous : undefined) || newAssets.get(file)?.key;
      if (known) { usedKeys.add(known); return known; }
      const key = crypto.randomUUID();
      newAssets.set(file, { key, asset: { blob: file, name: file.name, type: file.type, lastModified: file.lastModified } });
      usedKeys.add(key);
      return key;
    };
    const photos = new WeakMap<UploadedFile, StoredPhoto>();
    const pack = (photo: UploadedFile): StoredPhoto => {
      const existing = photos.get(photo);
      if (existing) return existing;
      const { file, originalFile, baseFile, previewUrl, originalPreviewUrl, ...metadata } = photo;
      // Legacy in-memory imports had no baseFile. A matching original URL identifies an unretouched source.
      const base = baseFile || (originalPreviewUrl === previewUrl ? file : undefined);
      if (!base) throw new Error('The original renderable import is unavailable. Reimport it before saving.');
      const stored = { ...metadata, fileKey: assetKey(file), originalKey: assetKey(originalFile || base), baseKey: assetKey(base) };
      photos.set(photo, stored);
      return stored;
    };
    const packEntry = (entry: HistoryEntry): StoredEntry => ({ ...entry, state: entry.state.map(pack) });
    const packHistory = (history: History): StoredHistory => ({ past: history.past.slice(-HISTORY_LIMIT).map(packEntry), present: packEntry(history.present), future: history.future.slice(0, HISTORY_LIMIT).map(packEntry) });
    const snapshot: Snapshot = {
      version: 2, clients: data.clients,
      projects: data.projects.map(project => ({ ...project, files: project.files.map(pack), editorHistory: project.editorHistory ? packHistory(project.editorHistory) : undefined })),
      workspace: data.workspace ? { ...data.workspace, history: packHistory(data.workspace.history) } : undefined,
    };
    const transaction = db.transaction(['assets', 'metadata'], 'readwrite');
    const done = completed(transaction);
    try {
      for (const { key, asset } of newAssets.values()) transaction.objectStore('assets').put(asset, key);
      transaction.objectStore('metadata').put(snapshot, 'crm');
      if (discardUnusedPhotos) {
        // Delete only copies unreachable from every saved project and all Undo/Redo entries.
        // Metadata and cleanup commit together, so a failed clear preserves the previous set.
        const assets = transaction.objectStore('assets');
        const request = assets.openKeyCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (!usedKeys.has(cursor.key as string)) assets.delete(cursor.key);
          cursor.continue();
        };
      }
    } catch (error) {
      transaction.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
    if (discardUnusedPhotos) {
      this.storedAssetKeys = usedKeys;
      for (const key of this.restored.keys()) if (!usedKeys.has(key)) this.restored.delete(key);
    } else {
      for (const key of usedKeys) this.storedAssetKeys.add(key);
    }
    // Cache keys only after a successful atomic commit. Failed saves remain retryable.
    for (const [file, { key }] of newAssets) this.assetKeys.set(file, key);
  }

  private loadLegacy(): StoredData | null {
    const stored = localStorage.getItem('fotograf_crm_v1');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || !Array.isArray(parsed.clients) || !Array.isArray(parsed.projects)) throw new Error('Legacy project data could not be read.');
    // JSON never contained the File bytes. Keep the old record untouched and make missing attachments explicit.
    return { clients: parsed.clients, projects: parsed.projects.map((project: Project) => ({
      ...project, files: [], editorHistory: undefined,
      unavailableFileCount: (project.unavailableFileCount || 0) + (Array.isArray(project.files) ? project.files.length : 0),
    })) };
  }
}
