import { maskBoundingBox } from '../utils/inpaintMath';

export interface SampleStroke { source: { x: number; y: number }; target: { x: number; y: number } }
export interface SamplePatch { layer: HTMLCanvasElement; x: number; y: number; ms: number }
const make = (width: number, height: number) => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; };

/** Copy real source texture; healing transfers its high frequencies onto the local tone. */
export function sampleRetouch(source: HTMLCanvasElement, mask: HTMLCanvasElement, stroke: SampleStroke,
  heal: boolean, strength: number): SamplePatch | null {
  const started = performance.now();
  const rgba = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height).data;
  const alpha = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  const box = maskBoundingBox(alpha, mask.width, mask.height);
  if (!box) return null;
  const sx = source.width / mask.width, sy = source.height / mask.height;
  const dx = Math.round(stroke.source.x - stroke.target.x), dy = Math.round(stroke.source.y - stroke.target.y);
  const x = Math.max(0, -dx, Math.floor(box.x * sx));
  const y = Math.max(0, -dy, Math.floor(box.y * sy));
  const right = Math.min(source.width, source.width - dx, Math.ceil((box.x + box.width) * sx));
  const bottom = Math.min(source.height, source.height - dy, Math.ceil((box.y + box.height) * sy));
  if (right <= x || bottom <= y) return null;
  const width = right - x, height = bottom - y;
  const radius = Math.max(4, Math.min(32, Math.min(width, height) / 5));
  const pad = heal ? Math.ceil(radius * 3) : 0;
  const left = Math.max(0, -dx, x - pad), top = Math.max(0, -dy, y - pad);
  const r = Math.min(source.width, source.width - dx, right + pad), b = Math.min(source.height, source.height - dy, bottom + pad);
  const donor = make(r - left, b - top), donorCtx = donor.getContext('2d')!;
  donorCtx.drawImage(source, left + dx, top + dy, donor.width, donor.height, 0, 0, donor.width, donor.height);
  const layer = make(width, height), ctx = layer.getContext('2d')!;
  ctx.drawImage(donor, x - left, y - top, width, height, 0, 0, width, height);
  if (heal) {
    const lowDonor = make(donor.width, donor.height), lowTarget = make(donor.width, donor.height);
    const a = lowDonor.getContext('2d')!, c = lowTarget.getContext('2d')!;
    a.filter = c.filter = `blur(${radius}px)`;
    a.drawImage(donor, 0, 0);
    c.drawImage(source, left, top, donor.width, donor.height, 0, 0, donor.width, donor.height);
    const detail = ctx.getImageData(0, 0, width, height);
    const from = a.getImageData(x - left, y - top, width, height).data;
    const to = c.getImageData(x - left, y - top, width, height).data;
    for (let i = 0; i < detail.data.length; i += 4) for (let channel = 0; channel < 3; channel++) {
      detail.data[i + channel] = detail.data[i + channel] - from[i + channel] + to[i + channel];
    }
    ctx.putImageData(detail, 0, 0);
    lowDonor.width = lowTarget.width = 1;
  }
  const coverage = make(width, height), m = coverage.getContext('2d')!;
  m.drawImage(mask, x / sx, y / sy, width / sx, height / sy, 0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.globalAlpha = Math.max(0, Math.min(1, strength));
  ctx.drawImage(coverage, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  donor.width = coverage.width = 1;
  return { layer, x, y, ms: performance.now() - started };
}
