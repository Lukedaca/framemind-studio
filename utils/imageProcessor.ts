import { renderEdits } from './imageRenderer';

/**
 * Converts a File object to a base64 encoded string, without the data URL prefix.
 */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to read file as base64 string.'));
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

/**
 * Converts a base64 encoded string to a File object.
 */
export const base64ToFile = async (base64: string, filename: string, mimeType: string): Promise<File> => {
  const res = await fetch(`data:${mimeType};base64,${base64}`);
  const blob = await res.blob();
  return new File([blob], filename, { type: mimeType });
};

/**
 * Normalizes an image file: ensures it's a JPEG and resizes it only if absolutely necessary.
 * Falls back to original file if processing fails.
 */
export const isJpegFile = (file: File): boolean =>
    /^(?:image\/(?:jpeg|jpg|pjpeg))$/i.test(file.type) || /\.jpe?g$/i.test(file.name);

export const normalizeImageFile = (
    file: File,
    maxSize = 6000, 
    quality = 0.98 
): Promise<File> => {
    // JPEG je už cílový formát. Zachováme původní soubor bajt po bajtu a
    // vyhneme se nákladnému dekódování + opětovné ztrátové kompresi při importu.
    if (isJpegFile(file)) {
        return Promise.resolve(file);
    }

    return new Promise((resolve) => {
        // Fallback mechanism: if anything fails, resolve with original file
        const safeResolve = () => {
            console.warn('Image normalization failed, using original file:', file.name);
            resolve(file);
        };

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                try {
                    let { width, height } = img;
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    if (!ctx) return safeResolve();

                    if (width > maxSize || height > maxSize) {
                         if (width > height) {
                            height = Math.round((height * maxSize) / width);
                            width = maxSize;
                        } else {
                            width = Math.round((width * maxSize) / height);
                            height = maxSize;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob(
                        (blob) => {
                            if (blob) {
                                const newFileName = file.name.replace(/\.[^/.]+$/, '.jpeg');
                                const normalizedFile = new File([blob], newFileName, {
                                    type: 'image/jpeg',
                                    lastModified: Date.now(),
                                });
                                resolve(normalizedFile);
                            } else {
                                safeResolve();
                            }
                        },
                        'image/jpeg',
                        quality
                    );
                } catch (e) {
                    safeResolve();
                }
            };
            img.onerror = safeResolve;
            if (event.target?.result) {
                img.src = event.target.result as string;
            } else {
                safeResolve();
            }
        };
        reader.onerror = safeResolve;
        reader.readAsDataURL(file);
    });
};

import type { ManualEdits } from '../types';

export type HistogramData = { r: number[]; g: number[]; b: number[]; l: number[] };

export async function calculateHistogramAsync(imageData: ImageData): Promise<HistogramData> {
    return new Promise((resolve, reject) => {
        try {
            const worker = new Worker(new URL('../workers/histogram.worker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = (e) => {
                resolve(e.data);
                worker.terminate();
            };
            worker.onerror = (err) => {
                worker.terminate();
                reject(err);
            };
            worker.postMessage(imageData);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Calculates histogram data from an image source.
 */
export const calculateHistogram = (imageUrl: string): Promise<HistogramData> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        if (!/^(blob:|data:)/i.test(imageUrl)) {
            img.crossOrigin = "anonymous";
        }
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            // Resize for faster processing, 500px is enough for histogram
            const scale = Math.min(1, 500 / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject();
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            try {
                const hist = await calculateHistogramAsync(imageData);
                resolve(hist);
            } catch (error) {
                const data = imageData.data;
                const r = new Array(256).fill(0);
                const g = new Array(256).fill(0);
                const b = new Array(256).fill(0);
                const l = new Array(256).fill(0);
                
                for (let i = 0; i < data.length; i += 4) {
                    r[data[i]]++;
                    g[data[i+1]]++;
                    b[data[i+2]]++;
                    const lum = Math.round(0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2]);
                    l[Math.min(255, lum)]++;
                }
                resolve({ r, g, b, l });
            }
        };
        img.onerror = reject;
        img.src = imageUrl;
    });
};

export const applyEditsAndExport = (
  imageUrl: string,
  edits: ManualEdits,
  options: { format: string; quality: number; scale: number }
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Blob a data URLs jsou same-origin – crossOrigin='anonymous' u nich může způsobit onerror
    // nebo canvas tainting (toBlob pak vrátí null / SecurityError). Nastavit jen pro http(s) zdroje.
    if (!/^(blob:|data:)/i.test(imageUrl)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        const canvas = renderEdits({ image: img, width: img.naturalWidth, height: img.naturalHeight }, edits, options, () => document.createElement('canvas'));
        const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const quality = options.format === 'jpeg' ? Math.max(0.1, Math.min(1, options.quality / 100)) : undefined;
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed.'));
        }, mimeType, quality);
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for editing.'));
    img.src = imageUrl;
  });
};
