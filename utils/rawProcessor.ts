
import exifr from 'exifr';

export const RAW_EXTENSIONS = [".cr2", ".cr3", ".nef", ".arw", ".orf", ".raf", ".dng", ".pef", ".rw2"];
export const RAW_EXTENSIONS_STRING = RAW_EXTENSIONS.join(',');

export interface RawConvertOptions {
    quality: number;       // 1-100, JPEG quality
    maxResolution: number; // 0 = original, otherwise max long edge in px
}

const DEFAULT_OPTIONS: RawConvertOptions = { quality: 92, maxResolution: 0 };

/**
 * Load image from blob and return an HTMLImageElement.
 */
const loadImage = (blob: Blob): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Image decode failed'));
        };
        img.src = url;
    });
};

/**
 * Check if blob is a valid image with reasonable dimensions.
 */
const isValidImage = async (blob: Blob): Promise<{ valid: boolean; width: number; height: number }> => {
    try {
        const img = await loadImage(blob);
        if (img.width < 100 || img.height < 100) {
            return { valid: false, width: 0, height: 0 };
        }
        return { valid: true, width: img.width, height: img.height };
    } catch {
        return { valid: false, width: 0, height: 0 };
    }
};

/**
 * Scan binary data for embedded JPEG images (FF D8 FF ... FF D9).
 * Returns up to 3 largest candidates > 50KB.
 */
const extractEmbeddedJpegs = async (file: File): Promise<Blob[]> => {
    try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const found: { start: number; end: number }[] = [];

        for (let i = 0; i < bytes.length - 3; i++) {
            // JPEG SOI marker: FF D8 FF
            if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
                const start = i;
                // Search for EOI marker: FF D9
                const limit = Math.min(bytes.length - 1, i + 30_000_000);
                for (let j = i + 3; j < limit; j++) {
                    if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
                        const size = j + 2 - start;
                        if (size > 50_000) { // > 50KB
                            found.push({ start, end: j + 2 });
                        }
                        i = j + 1; // skip past this JPEG
                        break;
                    }
                }
            }
        }

        // Sort by size descending, take top 3
        found.sort((a, b) => (b.end - b.start) - (a.end - a.start));
        return found.slice(0, 3).map(f =>
            new Blob([bytes.slice(f.start, f.end)], { type: 'image/jpeg' })
        );
    } catch (e) {
        console.error('[RAW] Binary scan failed:', e);
        return [];
    }
};

/**
 * Re-encode image through Canvas with quality and resize control.
 */
const reEncode = (img: HTMLImageElement, options: RawConvertOptions): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        let { width, height } = img;

        if (options.maxResolution > 0 && (width > options.maxResolution || height > options.maxResolution)) {
            if (width > height) {
                height = Math.round((height * options.maxResolution) / width);
                width = options.maxResolution;
            } else {
                width = Math.round((width * options.maxResolution) / height);
                height = options.maxResolution;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context failed'));

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
            (blob) => {
                if (blob && blob.size > 0) {
                    resolve(blob);
                } else {
                    reject(new Error('JPEG encoding produced empty result'));
                }
            },
            'image/jpeg',
            Math.max(0.01, Math.min(1, options.quality / 100))
        );
    });
};

/**
 * Main: extract best image from RAW file, re-encode as JPEG.
 */
export const processRawFile = async (file: File, options: RawConvertOptions = DEFAULT_OPTIONS): Promise<File> => {
    console.log(`[RAW] Processing: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

    type Candidate = { blob: Blob; w: number; h: number; source: string };
    const candidates: Candidate[] = [];

    // --- Method 1: exifr preview (full-size embedded JPEG) ---
    // exifr full build má preview() za runtime, ale typové definice ho nedeklarují
    try {
        const previewData = await (exifr as unknown as { preview(input: File): Promise<Uint8Array | undefined> }).preview(file);
        if (previewData && previewData.length > 1000) {
            const blob = new Blob([previewData], { type: 'image/jpeg' });
            const { valid, width, height } = await isValidImage(blob);
            if (valid) {
                console.log(`[RAW] exifr.preview: ${width}x${height} (${(blob.size / 1024).toFixed(0)} KB)`);
                candidates.push({ blob, w: width, h: height, source: 'exifr.preview' });
            }
        }
    } catch (e) {
        console.warn('[RAW] exifr.preview failed:', e);
    }

    // --- Method 2: exifr thumbnail (smaller) ---
    try {
        const thumbData = await exifr.thumbnail(file);
        if (thumbData && thumbData.length > 1000) {
            const blob = new Blob([thumbData], { type: 'image/jpeg' });
            const { valid, width, height } = await isValidImage(blob);
            if (valid) {
                console.log(`[RAW] exifr.thumbnail: ${width}x${height} (${(blob.size / 1024).toFixed(0)} KB)`);
                candidates.push({ blob, w: width, h: height, source: 'exifr.thumbnail' });
            }
        }
    } catch (e) {
        console.warn('[RAW] exifr.thumbnail failed:', e);
    }

    // --- Method 3: Binary scan for embedded JPEGs (fallback) ---
    const bestSoFar = candidates.reduce((max, c) => Math.max(max, c.w * c.h), 0);
    if (bestSoFar < 4_000_000) { // < 4MP, try harder
        console.log('[RAW] No high-res preview found, running binary scanner...');
        const blobs = await extractEmbeddedJpegs(file);
        console.log(`[RAW] Binary scanner found ${blobs.length} candidates`);
        for (const blob of blobs) {
            const { valid, width, height } = await isValidImage(blob);
            if (valid) {
                console.log(`[RAW] Binary scan candidate: ${width}x${height} (${(blob.size / 1024).toFixed(0)} KB)`);
                candidates.push({ blob, w: width, h: height, source: 'binary-scan' });
            }
        }
    }

    // --- Method 4: Try reading file directly as image (DNG files are sometimes readable) ---
    if (candidates.length === 0) {
        console.log('[RAW] Trying direct image decode...');
        try {
            const directBlob = new Blob([await file.arrayBuffer()], { type: 'image/jpeg' });
            const { valid, width, height } = await isValidImage(directBlob);
            if (valid) {
                console.log(`[RAW] Direct decode: ${width}x${height}`);
                candidates.push({ blob: directBlob, w: width, h: height, source: 'direct' });
            }
        } catch {
            // ignore
        }
    }

    if (candidates.length === 0) {
        throw new Error(`Nepodařilo se extrahovat obrázek ze souboru ${file.name}. Formát nemusí obsahovat embedded JPEG.`);
    }

    // Pick highest resolution
    candidates.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const best = candidates[0];
    console.log(`[RAW] Using: ${best.source} ${best.w}x${best.h}`);

    // Re-encode
    const img = await loadImage(best.blob);
    const outputBlob = await reEncode(img, options);
    const outputName = file.name.replace(/\.[^/.]+$/, '.jpg');
    console.log(`[RAW] Output: ${outputName} (${(outputBlob.size / 1024 / 1024).toFixed(2)} MB)`);

    return new File([outputBlob], outputName, { type: 'image/jpeg' });
};

export const isRawFile = (file: File): boolean => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return RAW_EXTENSIONS.includes(ext);
};
