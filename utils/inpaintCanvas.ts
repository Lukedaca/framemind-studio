import { MODEL_SIZE, type Rect } from './inpaintMath';

/** Reflect image edges into the padding instead of feeding black letterbox bars. */
export function drawInpaintInput(source: CanvasImageSource, crop: Rect, viewport: Rect): HTMLCanvasElement {
  const output = document.createElement('canvas');
  output.width = output.height = MODEL_SIZE;
  const ctx = output.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('INPAINT_CANVAS_UNAVAILABLE');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const left = Math.floor(-viewport.x / viewport.width);
  const top = Math.floor(-viewport.y / viewport.height);
  const right = Math.ceil((MODEL_SIZE - viewport.x) / viewport.width);
  const bottom = Math.ceil((MODEL_SIZE - viewport.y) / viewport.height);
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const flipX = Math.abs(x % 2) === 1;
    const flipY = Math.abs(y % 2) === 1;
    ctx.save();
    ctx.translate(viewport.x + (x + (flipX ? 1 : 0)) * viewport.width, viewport.y + (y + (flipY ? 1 : 0)) * viewport.height);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, viewport.width, viewport.height);
    ctx.restore();
  }
  return output;
}
