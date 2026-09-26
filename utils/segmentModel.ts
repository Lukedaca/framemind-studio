// Chytré laso: SAM 2.1 hiera-tiny (Meta, Apache-2.0) převedený do ONNX
// komunitou onnx-community, varianta quantized (int8) — běží na CPU (WASM)
// i bez WebGPU. URL připnuté na commit, ať se model pod rukama nezmění.
//
// Ověřeno v Node na IMG_7138 (i5-11400H, 1 vlákno): enkodér 3,8 s jednou na
// fotku, jeden klik 60–90 ms. Z jednoho kliku vrací tři masky různé velikosti
// (část / objekt / celek) — klik na ruku dá ruku i celou postavu.

const REPO = 'https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/resolve/814a066640debee5a91e70aa401fb8e17e030503/onnx';

export interface OnnxFileInfo {
  url: string;
  bytes: number;
}

export interface SegmentPart {
  graph: OnnxFileInfo;
  /** Váhy mimo graf (.onnx_data); ONNX na ně odkazuje tímto jménem. */
  data: OnnxFileInfo & { name: string };
}

export const SEGMENT_MODEL: { encoder: SegmentPart; decoder: SegmentPart; license: string } = {
  encoder: {
    graph: { url: `${REPO}/vision_encoder_quantized.onnx`, bytes: 441_167 },
    data: { url: `${REPO}/vision_encoder_quantized.onnx_data`, bytes: 52_573_088, name: 'vision_encoder_quantized.onnx_data' },
  },
  decoder: {
    graph: { url: `${REPO}/prompt_encoder_mask_decoder_quantized.onnx`, bytes: 290_416 },
    data: {
      url: `${REPO}/prompt_encoder_mask_decoder_quantized.onnx_data`,
      bytes: 8_662_016,
      name: 'prompt_encoder_mask_decoder_quantized.onnx_data',
    },
  },
  license: 'Apache-2.0',
};

export const SEGMENT_TOTAL_BYTES =
  SEGMENT_MODEL.encoder.graph.bytes + SEGMENT_MODEL.encoder.data.bytes + SEGMENT_MODEL.decoder.graph.bytes + SEGMENT_MODEL.decoder.data.bytes;

// SAM 2 zmenšuje fotku na čtverec 1024×1024 bez zachování poměru stran
// (Sam2ImageProcessor), normalizace ImageNet. Body se proto přepočítávají
// zvlášť v x a y a masky 256×256 se roztahují zpátky na celou fotku.
export const SEGMENT_INPUT = 1024;
export const SEGMENT_MASK = 256;
export const SEGMENT_MEAN = [0.485, 0.456, 0.406] as const;
export const SEGMENT_STD = [0.229, 0.224, 0.225] as const;

/** RGBA 1024×1024 → planární float32 [3,1024,1024] s normalizací SAM. */
export const toSegmentPixels = (rgba: ArrayLike<number>): Float32Array => {
  const n = SEGMENT_INPUT * SEGMENT_INPUT;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[c * n + i] = (rgba[i * 4 + c] / 255 - SEGMENT_MEAN[c]) / SEGMENT_STD[c];
  }
  return out;
};

/** Plocha masky (logit > 0) v pixelech 256×256 — slouží k řazení část/objekt/celek. */
export const maskArea = (logits: ArrayLike<number>, offset = 0): number => {
  let n = 0;
  const size = SEGMENT_MASK * SEGMENT_MASK;
  for (let i = 0; i < size; i++) if (logits[offset + i] > 0) n++;
  return n;
};
