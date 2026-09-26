// Čistá matika lokální retuše (bez DOM), aby šla testovat v Node.
//
// Inpainting modely pracují na malém čtverci (LaMa pevně 512×512). Kdybychom
// do nich poslali celou 24MP fotku zmenšenou na 512, výsledek by byl rozmazaný.
// Proto se z fotky vyřízne jen okolí masky, model doplní ten výřez a zpátky se
// vloží POUZE pixely pod maskou — zbytek fotky zůstane bajtově původní.

export const MODEL_SIZE = 512;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Obdélník kolem všech pixelů masky nad prahem. `alpha` je jeden bajt na pixel.
export const maskBoundingBox = (
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  threshold = 0,
): Rect | null => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

// Čtvercový výřez kolem masky s okolím pro kontext. Model potřebuje vidět, co
// je kolem díry — čím víc kontextu, tím věrohodnější doplnění, ale zároveň se
// výřez víc zmenšuje na 512 a doplněná plocha měkne. Kompromis: maska zabere
// zhruba polovinu strany výřezu, nejméně 512 px (menší výřez by se zvětšoval).
// Výřez se u okraje fotky posouvá, ne zmenšuje; menší je jen u malé fotky.
export const computeInpaintCrop = (
  mask: Rect,
  imageWidth: number,
  imageHeight: number,
  contextFactor = 2,
): Rect => {
  const longest = Math.max(mask.width, mask.height);
  let side = Math.max(MODEL_SIZE, Math.ceil(longest * contextFactor));
  side = Math.min(side, imageWidth, imageHeight);
  // Maska delší než kratší strana fotky: čtverec by ji nepokryl, vezmeme celou fotku.
  if (mask.width > side || mask.height > side) {
    return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  }
  const cx = mask.x + mask.width / 2;
  const cy = mask.y + mask.height / 2;
  const x = Math.round(Math.min(Math.max(cx - side / 2, 0), imageWidth - side));
  const y = Math.round(Math.min(Math.max(cy - side / 2, 0), imageHeight - side));
  return { x, y, width: side, height: side };
};

// Binární maska 0/1 → rozšířená o `radius` pixelů (čtvercové jádro, dva
// separabilní průchody). LaMa i MI-GAN nechávají „duchy", když okraj masky
// těsně obkresluje objekt — antialiasované hrany objektu zůstanou mimo díru
// a model je protáhne dovnitř. Pár pixelů navíc to odstraní.
export const dilateMask = (
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array => {
  if (radius <= 0) return mask.slice();
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let last = -Infinity;
    // Poslední pozice jedničky zleva a nejbližší zprava — O(n) na řádek.
    const nextOn = new Int32Array(width).fill(-1);
    let next = -1;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[row + x]) next = x;
      nextOn[x] = next;
    }
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) last = x;
      const right = nextOn[x];
      if (x - last <= radius || (right >= 0 && right - x <= radius)) horizontal[row + x] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    const nextOn = new Int32Array(height).fill(-1);
    let next = -1;
    for (let y = height - 1; y >= 0; y--) {
      if (horizontal[y * width + x]) next = y;
      nextOn[y] = next;
    }
    for (let y = 0; y < height; y++) {
      if (horizontal[y * width + x]) last = y;
      const below = nextOn[y];
      if (y - last <= radius || (below >= 0 && below - y <= radius)) out[y * width + x] = 1;
    }
  }
  return out;
};

// RGBA (z canvasu) → planární RGB, jak ho chtějí ONNX modely ([1,3,H,W]).
export const rgbaToPlanar = (rgba: ArrayLike<number>, pixels: number): Uint8Array => {
  const out = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    out[i] = rgba[i * 4];
    out[pixels + i] = rgba[i * 4 + 1];
    out[2 * pixels + i] = rgba[i * 4 + 2];
  }
  return out;
};

// Planární RGB (uint8 nebo float 0–255) → RGBA pro ImageData.
export const planarToRgba = (planar: ArrayLike<number>, pixels: number): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    out[i * 4] = planar[i];
    out[i * 4 + 1] = planar[pixels + i];
    out[i * 4 + 2] = planar[2 * pixels + i];
    out[i * 4 + 3] = 255;
  }
  return out;
};

// Rozšíření masky v pixelech modelu (512×512). Ověřeno na ukázce LaMa-ONNX:
// těsná maska nechala obrys postavy, maska s okrajem ji odstranila čistě.
export const MASK_DILATION_PX = 4;

// Kolik okolí dostane model. Změřeno na IMG_7138 (hlava hráče 300×430 px před
// rozmazaným davem): LaMa s okolím 2× strany masky udělala rozmazanou skvrnu,
// se 4× dav plynule pokračoval. Víc kontextu = věrohodnější doplnění.
export const CONTEXT_FACTOR = { fast: 2, quality: 4 } as const;

// Automatický výběr modelu podle plochy díry v plném rozlišení. MI-GAN je
// okamžitý a na drobnosti (skvrna, prach, malý text) stačí, ale na větších
// dírách si vymýšlí — na IMG_7138 místo hlavy vyrobil svítící fleky. Větší
// plochy proto jdou na LaMa. Hranice ~ plocha kruhu o průměru 135 px.
export const AUTO_FAST_MAX_AREA = 120 * 120;

export const pickAutoModel = (holeAreaPx: number): 'fast' | 'quality' =>
  holeAreaPx <= AUTO_FAST_MAX_AREA ? 'fast' : 'quality';

// Směrodatná odchylka (po kanálech) jemné struktury = zrna: rozdíl obrazu
// a jeho lehce rozmazané verze, jen na vybraných pixelech. `step` řídne vzorek.
export const grainSigma = (
  rgba: ArrayLike<number>,
  blurred: ArrayLike<number>,
  pick: (pixel: number) => boolean,
  pixels: number,
  step = 1,
): [number, number, number] | null => {
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < pixels; i += step) {
    if (!pick(i)) continue;
    for (let c = 0; c < 3; c++) {
      const d = rgba[i * 4 + c] - blurred[i * 4 + c];
      sum[c] += d;
      sq[c] += d * d;
    }
    n++;
  }
  if (n < 64) return null;
  return [0, 1, 2].map((c) => Math.sqrt(Math.max(0, sq[c] / n - (sum[c] / n) ** 2))) as [number, number, number];
};

// Kolik zrna přidat do doplněné plochy, aby měla stejné jako okolí:
// rozptyly se sčítají, takže chybějící část je sqrt(okolí² − doplnění²).
export const missingGrain = (around: number[], filled: number[]): [number, number, number] =>
  [0, 1, 2].map((c) => Math.sqrt(Math.max(0, around[c] ** 2 - filled[c] ** 2))) as [number, number, number];
