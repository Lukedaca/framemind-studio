import type { ManualEdits } from '../types';

export interface RenderOptions {
  scale: number;
  /** Preview bound only. Export leaves this unset. */
  maxSize?: number;
}

export function getRenderGeometry(width: number, height: number, edits: ManualEdits, options: RenderOptions) {
  if (![width, height, options.scale].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Image dimensions and scale must be positive and finite.');
  }
  if (options.maxSize !== undefined && (!Number.isFinite(options.maxSize) || options.maxSize < 1)) {
    throw new RangeError('Preview size must be at least one pixel.');
  }
  let srcX = 0, srcY = 0, srcW = width, srcH = height;
  if (edits.cropRect) {
    const crop = edits.cropRect;
    if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.width <= 0 || crop.height <= 0) {
      throw new RangeError('Crop must have finite coordinates and positive dimensions.');
    }
    srcX = Math.max(0, crop.x);
    srcY = Math.max(0, crop.y);
    srcW = Math.min(width - srcX, crop.width);
    srcH = Math.min(height - srcY, crop.height);
    if (srcW <= 0 || srcH <= 0) throw new RangeError('Crop is outside the image.');
  } else if (edits.aspectRatio !== undefined) {
    const ratio = edits.aspectRatio;
    if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError('Aspect ratio must be positive and finite.');
    if (width / height > ratio) {
      srcW = height * ratio;
      srcX = (width - srcW) / 2;
    } else {
      srcH = width / ratio;
      srcY = (height - srcH) / 2;
    }
  }
  const scale = Math.min(options.scale, options.maxSize === undefined ? Infinity : options.maxSize / Math.max(srcW, srcH));
  return { srcX, srcY, srcW, srcH, finalWidth: Math.max(1, Math.floor(srcW * scale)), finalHeight: Math.max(1, Math.floor(srcH * scale)) };
}

type EditCanvas = HTMLCanvasElement | OffscreenCanvas;
type EditContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Shared pixel pipeline for worker previews and full-resolution exports. */
export function renderEdits<C extends EditCanvas>(
  source: { image: CanvasImageSource; width: number; height: number },
  edits: ManualEdits,
  options: RenderOptions,
  createCanvas: () => C,
): C {
  const canvas = createCanvas();
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as EditContext | null;
  if (!ctx) throw new Error('Could not get canvas context');
  const { srcX, srcY, srcW, srcH, finalWidth, finalHeight } = getRenderGeometry(source.width, source.height, edits, options);

  canvas.width = finalWidth;
  canvas.height = finalHeight;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(source.image, srcX, srcY, srcW, srcH, 0, 0, finalWidth, finalHeight);

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
           const tempCanvas = createCanvas();
           tempCanvas.width = finalWidth;
           tempCanvas.height = finalHeight;
           const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true }) as EditContext | null;
           if (!tempCtx) throw new Error('Could not get canvas context');

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
      const fontSize = Math.max(1, Math.floor(finalWidth * (wm.size / 300))); // Scale relative to width
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

  return canvas;
}
