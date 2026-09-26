// Lokální modely pro retuš štětcem. URL jsou připnuté na konkrétní commit na
// Hugging Face, aby se model pod rukama nezměnil. Oba soubory HF servíruje
// s CORS, takže je prohlížeč stáhne napřímo.

export type InpaintModelId = 'fast' | 'quality';

export interface InpaintModelInfo {
  id: InpaintModelId;
  name: string;
  url: string;
  bytes: number;
  license: string;
}

export const INPAINT_MODELS: Record<InpaintModelId, InpaintModelInfo> = {
  fast: {
    id: 'fast',
    name: 'MI-GAN',
    url: 'https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx',
    bytes: 28_079_181,
    license: 'MIT',
  },
  quality: {
    id: 'quality',
    name: 'LaMa',
    url: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx',
    bytes: 208_044_816,
    license: 'Apache-2.0',
  },
};
