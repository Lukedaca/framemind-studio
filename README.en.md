<div align="center">
  <img src="public/brand/readme-logo-en.png" alt="FrameMind" width="440" />

  <h1>FrameMind Studio</h1>

  <p><strong>Select. Edit. Retouch.</strong></p>

  <p>A photo studio in the browser for the whole path from memory card to finished photos —<br />import, selection, edits, brush retouching and export in one window.<br />Retouching and edits are computed on your machine, not in the cloud.</p>

  <p>
    <a href="README.md"><img src="https://img.shields.io/badge/README-%C4%8Cesky-555?style=for-the-badge" alt="Čeština" /></a>
    <a href="README.en.md"><img src="https://img.shields.io/badge/README-English-2f6fe0?style=for-the-badge" alt="English" /></a>
  </p>
</div>

---

## Workflow

| | Step | What it does | Runs |
|---|---|---|---|
| 01 | **Import** | JPEG, PNG, WebP; RAW files (CR2, CR3, NEF, ARW, DNG…) use the embedded JPEG preview | locally |
| 02 | **Select** | sharpness, exposure, noise, composition, bursts and duplicates; K / R / X keys | locally · AI verdicts optional via Gemini |
| 03 | **Adjust** | histogram-based *Auto* plus light, colour, detail sliders and crop | locally |
| 04 | **Retouch** | brush over a distraction; when you let go, the area is rebuilt from its surroundings | locally (ONNX model in the browser) |
| 05 | **Export** | JPEG / PNG, quality, size, watermark, whole set to a folder | locally |

## Brush retouching without an API

Retouching works like [cleanup.photo](https://cleanup.photo/): one brush, no settings. The difference is where it runs — the model runs in the browser via [ONNX Runtime Web](https://onnxruntime.ai/) in a web worker (WebGPU when available, WASM on the CPU otherwise). The photo never leaves the machine, and retouching needs no credits or API key.

| | Model | Size | For |
|---|---|---|---|
| **Fast** (default) | [MI-GAN](https://huggingface.co/andraniksargsyan/migan) · MIT | 28 MB | small things, cables, text, spots |
| **Detailed** | [LaMa](https://huggingface.co/Carve/LaMa-ONNX) · Apache-2.0 | 208 MB | large areas, people, cars |

The model downloads on first use from Hugging Face (URL pinned to a commit) and is stored in the browser's Cache Storage, so later sessions load it from disk and retouching works offline.

**Full resolution:** the models work on a 512 × 512 square, so only the neighbourhood of the mask is cropped out, the model fills that crop, and **only the pixels under the mask** are blended back. The rest of the photo stays at its original resolution; the only loss is the final JPEG save (quality 0.96).

Controls: `[` / `]` brush size · mouse wheel zoom · space + drag pan · `0` fit · `Ctrl+Z` undo · hold **Compare** (or `\`) for the original.

## Gemini as an optional extra

Everything works without an API key except two extras: **AI verdicts in Select** (genre-aware, with short reasons and an optional photographer brief) and **edit with text** in the Retouch panel. Add the key with the key button bottom left. It is session-only by default; persistent storage needs confirmation.

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
npm run preview
npm run typecheck
npm run test:run
```

Multi-threaded WASM needs a cross-origin isolated page. The dev and preview servers send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`; `vercel.json` does the same in production. Without them retouching still works, single-threaded.

## What it is not

- no full RAW development — only the embedded preview
- no accounts, sync or cloud — project data lives in this browser only
- no server proxy for Gemini — the key stays in the user's browser

---

<div align="center">
  <sub>FrameMind Studio is part of <a href="https://framemind.cz">FrameMind</a>.</sub>
</div>
