// Stažení modelu s průběhem a uložením do Cache Storage — sdílí ho workery
// retuše i chytrého lasa. Druhé spuštění appky čte model z disku, i offline.

export type DownloadProgress = (loaded: number, total: number, cached: boolean) => void;

export const fetchCachedModel = async (
  cacheName: string,
  url: string,
  expected: number,
  onProgress: DownloadProgress,
): Promise<Uint8Array> => {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (hit) {
      onProgress(expected, expected, true);
      return new Uint8Array(await hit.arrayBuffer());
    }
  } catch {
    // Cache Storage nemusí být dostupná (soukromé okno) — stáhne se pokaždé.
    cache = null;
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`MODEL_DOWNLOAD_FAILED: HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length')) || expected;
  const buffer = new Uint8Array(total);
  const reader = response.body.getReader();
  let loaded = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > buffer.length) {
      throw new Error('MODEL_DOWNLOAD_FAILED: unexpected size');
    }
    buffer.set(value, loaded);
    loaded += value.length;
    if (loaded - lastReport > total / 100) {
      lastReport = loaded;
      onProgress(loaded, total, false);
    }
  }
  if (loaded !== total) throw new Error('MODEL_DOWNLOAD_FAILED: incomplete');

  if (cache) {
    try {
      await cache.put(url, new Response(buffer, { headers: { 'content-type': 'application/octet-stream' } }));
    } catch {
      // Plná kvóta — model poběží, jen se příště stáhne znovu.
    }
  }
  return buffer;
};
