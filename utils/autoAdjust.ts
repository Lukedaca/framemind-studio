// Automatická úprava bez AI a bez API: z histogramu náhledu odvodí posuvníky
// editoru (jas, kontrast, stíny, světla, živost). Výsledek je jen návrh —
// posuvníky zůstávají ručně doladitelné a nic se nezapéká do souboru.
//
// Hodnoty odpovídají tomu, jak je aplikuje utils/imageProcessor.ts:
// jas = expozice 2^(b/100), světla > 0 = stažení světel, stíny > 0 = zvednutí.

import type { ManualEdits } from '../types';

export type AutoAdjustEdits = Pick<ManualEdits, 'brightness' | 'contrast' | 'shadows' | 'highlights' | 'vibrance'>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Cílový medián jasu. Záměrně jen tlumeně (×0,6) — low-key a high-key fotky
// nemají skončit v šedém průměru.
const TARGET_MEDIAN = 118;

export const computeAutoAdjust = (rgba: ArrayLike<number>): AutoAdjustEdits => {
  const pixels = Math.floor(rgba.length / 4);
  const neutral = { brightness: 0, contrast: 0, shadows: 0, highlights: 0, vibrance: 0 };
  if (pixels === 0) return neutral;

  const hist = new Uint32Array(256);
  let satSum = 0;
  for (let i = 0; i < pixels; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    hist[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
    const max = Math.max(r, g, b);
    satSum += max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  }
  const percentile = (p: number) => {
    const target = p * pixels;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };

  const median = Math.max(4, percentile(0.5));
  const brightness = clamp(Math.round(100 * Math.log2(TARGET_MEDIAN / median) * 0.6), -40, 50);

  // Podíl oříznutých pixelů: už oříznuté ve zdroji (ty ztmavení nezachrání)
  // plus ty, které ořízne zamýšlená expozice.
  const gain = Math.pow(2, brightness / 100);
  let hi = 0;
  let lo = 0;
  for (let v = 0; v < 256; v++) {
    const shifted = v * gain;
    if (v >= 250 || shifted >= 250) hi += hist[v];
    if (v <= 8 || shifted <= 8) lo += hist[v];
  }
  const hiShare = hi / pixels;
  const loShare = lo / pixels;
  const highlights = hiShare > 0.01 ? clamp(Math.round(hiShare * 400), 10, 50) : 0;
  const shadows = loShare > 0.02 ? clamp(Math.round(loShare * 300), 10, 40) : 0;

  const range = percentile(0.99) - percentile(0.01);
  const contrast = range < 180 ? clamp(Math.round((200 - range) * 0.25), 0, 25) : 0;

  const meanSat = satSum / pixels;
  const vibrance = meanSat < 0.3 ? clamp(Math.round((0.3 - meanSat) * 80), 0, 20) : 0;

  return { brightness, contrast, shadows, highlights, vibrance };
};
