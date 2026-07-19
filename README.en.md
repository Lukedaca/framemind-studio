<div align="center">
  <img src="public/logo-full.png" alt="FrameMind Studio" width="420" />

  <h1>FrameMind Studio</h1>

  <p><strong>Connecting images with intelligence.</strong></p>

  <p>An AI photo studio for photographers, right in the browser — genre-aware AI culling, editor, retouching,<br />RAW conversion, client galleries and CRM in a single app.</p>

  <p>
    <a href="README.md"><img src="https://img.shields.io/badge/README-%C4%8Cesky-555?style=for-the-badge" alt="Čeština" /></a>
    <a href="README.en.md"><img src="https://img.shields.io/badge/README-English-2f6fe0?style=for-the-badge" alt="English" /></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/React-19-2f6fe0" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-5.8-2f6fe0" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Vite-6-b01ecb" alt="Vite 6" />
    <img src="https://img.shields.io/badge/Gemini-AI-1fc06b" alt="Gemini AI" />
    <img src="https://img.shields.io/badge/PWA-ready-1fc06b" alt="PWA" />
  </p>
</div>

---

## Why FrameMind Studio

The big culling tools (Aftershoot, Narrative, FilterPixel, Imagen) are single-purpose desktop apps with subscriptions. FrameMind Studio covers a photographer's entire workflow in the browser — from import through selection and editing to client delivery — and its culling does things the competition doesn't:

- **Culling brief** — describe the intent of the shoot in your own words and the AI weighs it in its verdicts
- **Explainable verdicts** — every photo gets reasons and risks in plain language, not just a score
- **Free heuristic pass** — sharpness, exposure, noise and series detection run locally, no API, works offline

---

## AI Culling

A three-phase selection built on the FrameMind engine:

1. **Local heuristics** (free, in a web worker) — Laplacian sharpness, exposure, noise, composition, perceptual-hash detection of series and duplicates
2. **Genre detection** — the AI identifies the genre of the whole batch from three previews; 9 genre profiles (sports, portrait, wedding, product, landscape, street, wildlife, event, general) change the weights and thresholds — closed eyes kill a portrait but don't matter in sports
3. **AI verdicts** — Gemini decides keep / review / reject by the standards of the detected genre, with a summary, reasons and risks; confident rejects are skipped

Plus pro-grade controls: **K / R / X** keys and arrow navigation, series collapsed to a representative with a "This is the winner" pick, verdict filters and one-click discarding of rejects.

## More features

| Feature | Description |
|---------|-------------|
| **Editor** | Manual adjustments, filters, crop, watermark, undo/redo history |
| **AI Autopilot** | Automatic photo enhancement + learned user tendencies |
| **Retouching** | AI retouching by prompt or mask, object removal, background replacement |
| **Batch Studio** | Bulk edits and portrait retouching for a whole series |
| **RAW Converter** | RAW conversion (CR2, NEF, ARW…) right in the browser |
| **YouTube thumbnails** | Thumbnail generator with 4 templates and text overlay |
| **AI Gallery** | Image generation and AI asset management |
| **Projects & clients** | CRM — jobs, clients, activity timeline, client galleries |
| **PWA** | Installable from the browser, offline-capable |
| **CZ / EN** | Fully bilingual interface |

---

## Getting started

```bash
npm install        # install dependencies
npm run dev        # development server (port 3000)
npm run build      # production build
npm run preview    # preview the production build
```

### API key

1. Launch the app and paste your Google Gemini API key in the UI (the **API** button in the top bar).
2. You can get a key for free in [Google AI Studio](https://aistudio.google.com/app/apikey).
3. The key is stored only locally in your browser.

> **Security:** API keys never belong in the repository or in builds.

---

## Tech stack

| Category | Technology |
|----------|------------|
| Framework | React 19 + TypeScript 5.8 |
| Build | Vite 6 |
| Styling | Tailwind CSS 3 (FrameMind palette from the logo) |
| Animation | Framer Motion 11 |
| AI | Google Gemini API (`@google/genai`) |
| Culling | Custom engine — web worker heuristics + genre profiles |
| PWA | vite-plugin-pwa (Workbox) |

## Project structure

```
App.tsx                  # Main app logic, routing, state
components/              # UI components (lazy-loaded views + shared)
  CullingView.tsx        # AI culling board (genres, series, K/R/X)
  ai/                    # AI Command Center
  editor/                # Editor sub-components
contexts/                # React contexts (Language, Project)
services/                # Gemini services, user profile, API keys
utils/                   # cullingEngine, cullingMetrics, imageProcessor…
workers/                 # Web workers (culling heuristics, histogram)
public/                  # Logos, PWA icons
```

---

<div align="center">
  <sub>FrameMind Studio is part of the FrameMind family — AI tools for photographers.</sub>
</div>
