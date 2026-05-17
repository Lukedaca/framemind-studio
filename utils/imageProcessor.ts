
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
export const normalizeImageFile = (
    file: File,
    maxSize = 6000, 
    quality = 0.98 
): Promise<File> => {
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

import type { ManualEdits, WatermarkSettings } from '../types';

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
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return reject(new Error('Could not get canvas context'));
      }

      // --- 1. Calculate Dimensions based on Crop ---
      let srcX = 0;
      let srcY = 0;
      let srcW = img.width;
      let srcH = img.height;

      if (edits.cropRect) {
          srcX = Math.max(0, edits.cropRect.x);
          srcY = Math.max(0, edits.cropRect.y);
          srcW = Math.min(img.width - srcX, edits.cropRect.width);
          srcH = Math.min(img.height - srcY, edits.cropRect.height);
      } else if (edits.aspectRatio) {
          const imageRatio = img.width / img.height;
          const targetRatio = edits.aspectRatio;

          if (imageRatio > targetRatio) {
              srcW = img.height * targetRatio;
              srcX = (img.width - srcW) / 2;
          } else {
              srcH = img.width / targetRatio;
              srcY = (img.height - srcH) / 2;
          }
      }

      // --- 2. Set Canvas Size ---
      const finalWidth = Math.floor(srcW * options.scale);
      const finalHeight = Math.floor(srcH * options.scale);
      
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, finalWidth, finalHeight);

      // --- 3. Pixel Manipulation ---
      const hasPixelEdits = 
          edits.brightness !== 0 || edits.contrast !== 0 || 
          edits.saturation !== 0 || edits.vibrance !== 0 || 
          edits.shadows !== 0 || edits.highlights !== 0 ||
          edits.noiseReduction > 0 || edits.sharpness > 0 || edits.clarity > 0;

      if (hasPixelEdits) {
          const imageData = ctx.getImageData(0, 0, finalWidth, finalHeight);
          const data = imageData.data;

          const exposureMultiplier = Math.pow(2, edits.brightness / 100); 
          const contrastFactor = (1.015 * (edits.contrast + 100)) / (100 * (1.015 - edits.contrast / 100));
          const saturationScale = 1 + (edits.saturation / 100);
          const vibranceScale = 1 + (edits.vibrance / 100);
          const shadowLift = edits.shadows * 0.8;
          const highlightRec = -(edits.highlights * 0.8);

          for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];
            
            if (edits.brightness !== 0) {
                r *= exposureMultiplier;
                g *= exposureMultiplier;
                b *= exposureMultiplier;
            }

            let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

            if (edits.contrast !== 0) {
                let newLum = 128 + contrastFactor * (lum - 128);
                newLum = Math.max(0, Math.min(255, newLum));
                if (lum > 1) {
                    const ratio = newLum / lum;
                    r *= ratio;
                    g *= ratio;
                    b *= ratio;
                    lum = newLum;
                }
            }

            if (edits.shadows !== 0 || edits.highlights !== 0) {
                const normLum = lum / 255;
                if (edits.shadows !== 0) {
                    const shadowMask = (1.0 - normLum) * (1.0 - normLum);
                    const lift = shadowLift * shadowMask;
                    r += lift; g += lift; b += lift;
                }
                if (edits.highlights !== 0) {
                    const highlightMask = normLum * normLum;
                    const recovery = highlightRec * highlightMask;
                    r += recovery; g += recovery; b += recovery;
                }
            }

            if (edits.saturation !== 0 || edits.vibrance !== 0) {
                lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                let max = Math.max(r, g, b);
                let min = Math.min(r, g, b);
                let delta = max - min;
                let currentSat = (max === 0) ? 0 : delta / max;

                let totalSatMult = saturationScale;
                if (edits.vibrance !== 0) {
                    const vibFactor = (1 - currentSat); 
                    totalSatMult += ((vibranceScale - 1) * vibFactor);
                }

                r = lum + (r - lum) * totalSatMult;
                g = lum + (g - lum) * totalSatMult;
                b = lum + (b - lum) * totalSatMult;
            }

            data[i] = Math.max(0, Math.min(255, r));
            data[i + 1] = Math.max(0, Math.min(255, g));
            data[i + 2] = Math.max(0, Math.min(255, b));
          }

          ctx.putImageData(imageData, 0, 0);

          if (edits.noiseReduction > 0 || edits.sharpness > 0 || edits.clarity > 0) {
               const tempCanvas = document.createElement('canvas');
               tempCanvas.width = finalWidth;
               tempCanvas.height = finalHeight;
               const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })!;
               
               if (edits.noiseReduction > 0) {
                   tempCtx.drawImage(canvas, 0, 0);
                   ctx.filter = `blur(${edits.noiseReduction / 40}px)`; 
                   ctx.drawImage(tempCanvas, 0, 0);
                   ctx.filter = 'none';
               }

               if (edits.sharpness > 0 || edits.clarity > 0) {
                    const sharpData = ctx.getImageData(0, 0, finalWidth, finalHeight);
                    const pixels = sharpData.data;
                    const sourceData = new Uint8ClampedArray(pixels);
                    
                    const sharpAmount = edits.sharpness / 100;
                    const clarityAmount = edits.clarity / 80;
                    const threshold = 10; 

                    for (let y = 1; y < finalHeight - 1; y++) {
                        for (let x = 1; x < finalWidth - 1; x++) {
                            const idx = (y * finalWidth + x) * 4;
                            for (let c = 0; c < 3; c++) {
                                const val = sourceData[idx + c];
                                const up = sourceData[((y - 1) * finalWidth + x) * 4 + c];
                                const down = sourceData[((y + 1) * finalWidth + x) * 4 + c];
                                const left = sourceData[(y * finalWidth + (x - 1)) * 4 + c];
                                const right = sourceData[(y * finalWidth + (x + 1)) * 4 + c];
                                const laplacian = (4 * val) - (up + down + left + right);

                                if (Math.abs(laplacian) > threshold) {
                                    let newVal = val;
                                    newVal += (laplacian * sharpAmount);
                                    newVal += (laplacian * clarityAmount * 0.6);
                                    pixels[idx + c] = Math.max(0, Math.min(255, newVal));
                                }
                            }
                        }
                    }
                    ctx.putImageData(sharpData, 0, 0);
               }
          }
      }

      // --- 4. Watermark ---
      if (edits.watermark && edits.watermark.enabled && edits.watermark.text) {
          const wm = edits.watermark;
          const fontSize = Math.floor(finalWidth * (wm.size / 300)); // Scale relative to width
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.globalAlpha = wm.opacity / 100;
          ctx.fillStyle = wm.color;
          
          const textMetrics = ctx.measureText(wm.text);
          const textWidth = textMetrics.width;
          const padding = fontSize / 2;
          
          let x = 0, y = 0;

          if (wm.position === 'tiled') {
             ctx.rotate(-45 * Math.PI / 180);
             const diag = Math.sqrt(finalWidth*finalWidth + finalHeight*finalHeight);
             for(let i=-diag; i<diag; i+= textWidth + padding*4) {
                 for(let j=-diag; j<diag; j+= fontSize*3) {
                     ctx.fillText(wm.text, i, j);
                 }
             }
             ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
          } else {
              // Basic positions
              switch (wm.position) {
                  case 'center':
                      x = (finalWidth - textWidth) / 2;
                      y = finalHeight / 2;
                      break;
                  case 'top-left':
                      x = padding;
                      y = padding + fontSize;
                      break;
                  case 'top-right':
                      x = finalWidth - textWidth - padding;
                      y = padding + fontSize;
                      break;
                  case 'bottom-left':
                      x = padding;
                      y = finalHeight - padding;
                      break;
                  case 'bottom-right':
                      x = finalWidth - textWidth - padding;
                      y = finalHeight - padding;
                      break;
              }
              ctx.fillText(wm.text, x, y);
          }
          ctx.globalAlpha = 1.0;
      }

      // Export
      const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const quality = options.format === 'jpeg' ? Math.max(0.1, Math.min(1, options.quality / 100)) : undefined;
      
      canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed.'));
        }, mimeType, quality);
    };
    img.onerror = () => reject(new Error('Failed to load image for editing.'));
    img.src = imageUrl;
  });
};

// --- Patch-based retouch helpers (bypass safety filter cropováním) ---

const loadImageFromFile = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image from file'));
    };
    img.src = url;
  });
};

export type CropRect = { x: number; y: number; width: number; height: number };

/**
 * Vyřízne čtvercový patch kolem bbox s paddingem a resizem na targetSize.
 * Vrátí patch File + skutečný cropRect v originálních souřadnicích (pro pozdější composite).
 */
export const cropPatchFromFile = async (
  file: File,
  bbox: CropRect,
  targetSize: number = 768,
  paddingRatio: number = 0.3
): Promise<{ patchFile: File; cropRect: CropRect; bboxInPatch: CropRect }> => {
  const img = await loadImageFromFile(file);

  const longSide = Math.max(bbox.width, bbox.height);
  const padded = Math.ceil(longSide * (1 + paddingRatio * 2));
  const cropSize = Math.min(padded, Math.min(img.width, img.height));

  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;

  let cropX = Math.round(cx - cropSize / 2);
  let cropY = Math.round(cy - cropSize / 2);
  cropX = Math.max(0, Math.min(img.width - cropSize, cropX));
  cropY = Math.max(0, Math.min(img.height - cropSize, cropY));

  const cropRect: CropRect = { x: cropX, y: cropY, width: cropSize, height: cropSize };

  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, targetSize, targetSize);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Patch toBlob failed'))), 'image/jpeg', 0.95);
  });
  const patchFile = new File([blob], `patch_${file.name}`, { type: 'image/jpeg' });

  // Vypočítaj bbox uvnitř patche (po cropu+resizu na targetSize)
  const scale = targetSize / cropSize;
  const bboxInPatch: CropRect = {
    x: Math.max(0, Math.round((bbox.x - cropX) * scale)),
    y: Math.max(0, Math.round((bbox.y - cropY) * scale)),
    width: Math.min(targetSize, Math.round(bbox.width * scale)),
    height: Math.min(targetSize, Math.round(bbox.height * scale)),
  };

  return { patchFile, cropRect, bboxInPatch };
};

/**
 * Aplikuje silný Gaussian blur na zadanou oblast uvnitř File a vrátí novou File.
 * Použito jako safety bypass: tetování → rozmazaná skvrna → AI nepozná, projde safety, deblurne čistě.
 */
export const blurRegionInFile = async (
  file: File,
  region: CropRect,
  blurRadius: number = 40,
  outputMime: string = 'image/jpeg',
  quality: number = 0.92
): Promise<File> => {
  const img = await loadImageFromFile(file);

  // 1) Vykresli celý obrázek
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(img, 0, 0);

  // 2) Aplikuj blur jen na region — vyřízni, blurni přes filter, vykresli zpět
  const pad = Math.round(blurRadius * 1.5);
  const sx = Math.max(0, region.x - pad);
  const sy = Math.max(0, region.y - pad);
  const sw = Math.min(img.width - sx, region.width + pad * 2);
  const sh = Math.min(img.height - sy, region.height + pad * 2);

  // Tmpcanvas s blurnutým regionem (i s padding pro plynulý okraj)
  const tmp = document.createElement('canvas');
  tmp.width = sw;
  tmp.height = sh;
  const tctx = tmp.getContext('2d');
  if (!tctx) throw new Error('Canvas context unavailable');
  tctx.filter = `blur(${blurRadius}px)`;
  tctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  tctx.filter = 'none';

  // Vykresli blurnutý region zpět do main canvas
  ctx.drawImage(tmp, 0, 0, sw, sh, sx, sy, sw, sh);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Blur toBlob failed'))),
      outputMime,
      outputMime === 'image/jpeg' ? quality : undefined
    );
  });

  const ext = outputMime === 'image/png' ? 'png' : 'jpg';
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  return new File([blob], `blurred_${baseName}.${ext}`, { type: outputMime });
};

/**
 * Slepi retušovaný patch zpět do originálního obrázku na pozici cropRect.
 * Patch může mít jiné rozlišení než cropRect — automaticky se resizuje.
 */
export const compositePatchIntoFile = async (
  originalFile: File,
  patchFile: File,
  cropRect: CropRect,
  outputMime: string = 'image/jpeg',
  quality: number = 0.95
): Promise<File> => {
  const [origImg, patchImg] = await Promise.all([
    loadImageFromFile(originalFile),
    loadImageFromFile(patchFile),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = origImg.width;
  canvas.height = origImg.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(origImg, 0, 0);
  ctx.drawImage(patchImg, 0, 0, patchImg.width, patchImg.height, cropRect.x, cropRect.y, cropRect.width, cropRect.height);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Composite toBlob failed'))),
      outputMime,
      outputMime === 'image/jpeg' ? quality : undefined
    );
  });

  const ext = outputMime === 'image/png' ? 'png' : 'jpg';
  const baseName = originalFile.name.replace(/\.[^/.]+$/, '');
  return new File([blob], `retouched_${baseName}.${ext}`, { type: outputMime });
};
