# FrameMind Solutions for Photo 1.0 — culling audit

Audit of checkout `Lukedaca/framemind-studio`, baseline `69a17bc`.

The sections before "Implemented local branch" describe the historical baseline
and refactor plan. The implementation section and README describe current behavior.

## Baseline flow (before refactor)

`CullingView.runCulling` decodes three files concurrently through
`cullingEngine.analyzePhotoPixels`. Each file gets a 420 px canvas; pixel metrics
run in `culling.worker` (with a synchronous main-thread fallback).
The engine then calls MediaPipe person and face detectors, measures cropped
sharpness, and builds a 768 px base64 JPEG for Gemini. A 256-bit average hash
joins photos using union-find; time, EXIF and filename sequence are not used.
If an API key exists, Gemini first classifies the genre, then supplies photo
verdicts. Safe/economy modes choose which previews are sent. Gemini verdicts
usually override heuristics. Manual decisions have final precedence.

## LOCAL DETERMINISTIC

- `utils/cullingMetrics.ts`: luminance, Laplacian variance, mean-based exposure,
  clipping, standard deviation, neighbour residual noise, edge-based composition
  approximation and average hash. No image content understanding.
- `utils/cullingEngine.ts`: genre weights, thresholds, grouping, sorting and
  concurrency. Whole-set sharpness thresholds exist but are disabled because
  heterogeneous textures previously caused false rejects.
- `services/tasteEngine.ts`: localStorage weights trained by sigmoid updates
  from manual decisions. Blends 25% personal score after 12 samples. Its Gemini
  hint leaves the device through the old culling request. Disconnected in 1.0;
  stored preferences are preserved and do not influence technical verdicts.

## LOCAL ML

- `services/subjectDetection.ts`: MediaPipe EfficientDet person detection.
- `services/faceDetection.ts`: MediaPipe face landmarks and eye blendshapes.
- Both import CDN code and download Google-hosted models. Remove their imports
  and calls from culling, preserving standalone code/tests. ONNX is used by
  retouch/segmentation and is outside the scope of this change.

## REMOTE AI

- `services/geminiService.ts`: `detectBatchGenre` and `getCullingVerdict` send
  previews to Gemini. Remove these culling APIs, prompts and schemas.
- The JSON generation/fallback helper, URL parser and thinking configuration
  are also used by `locateObjects` for the editor's smart lasso. Preserve that
  behavior with names specific to object location. Preserve `retouchWithPrompt`.

## UI

- `components/CullingView.tsx`: grid, collapsed/expanded series, keyboard
  decisions, filters, confirmation before removing rejects from the set.
- Remove genre inference, natural-language brief, AI phases, usage counters,
  safe/economy modes, eye badges and personal-score adaptation. Preserve visual
  identity and manual control. Show technical explanations and preview limits.

## STORAGE

- `UploadedFile.culling` and `assessment` enter existing App history via
  `onSetFiles`; manual changes use the same path.
- `ProjectContext`/`projectStorage` retain the existing localStorage CRM.
  This is not durable original-file storage or cloud sync.
- Existing serialized culling fields remain readable for compatibility. Old
  automatic results require fresh analysis; manual decisions remain authoritative.
- RAW import currently re-encodes an embedded JPEG, discarding capture EXIF.
  Preserve provenance and original metadata input for culling without changing
  RAW development or the original file.

## Implementation boundary

Keep pure mathematics independent of browser I/O. Decode one file at a time in
an owned worker, then compute bounded-preview metrics and series grouping there.
Terminating the session cancels pending work. No culling import path may reach
network APIs, AI/model services or telemetry. Original files are read-only.

## Implemented local branch — 2026-10-04

- Culling has no AI branch, API key, taste adaptation, face/person detector,
  model download or usage tracking. The key button is hidden in the culling view.
  Removed culling APIs from the Gemini service; editor object location keeps its
  independent helper and regression tests.
- Each run owns a worker. It reads one image at a time, measures a preview with
  long side at most 768 px, reads EXIF from the original input and groups series.
  Stop, unmount and an authoritative change of files terminate pending work.
- Measurements include luminance percentiles, histogram entropy, channel
  clipping, noise-corrected Laplacian/Sobel detail and a weak directional cue.
  Scores expose their weighted contributions. These are preview indicators,
  not subject focus, artistic quality or calibrated probabilities.
- Signatures compare spatial luminance, color, two hashes and histograms.
  Similar scenes need capture-time or filename-sequence support; matching
  filenames never override conflicting capture times. Complete linkage avoids
  transitive scene chains. Large sets use bounded candidates and groups of at
  most 48; grouping is deliberately incomplete rather than increasingly broad.
- Automatic results suggest keep/review. Rejection is manual; choosing a series
  representative does not reject its alternatives. Reruns and profile changes
  preserve manual decisions. Legacy automatic results require fresh analysis
  and do not collapse older groups or reuse AI labels.
- Import retains the session's original File and RAW preview provenance. RAW
  metadata comes from the original RAW, pixels from the extracted JPEG preview.
  Existing localStorage project storage still cannot persist original Files.

Verification: 91 unit tests passed; typecheck and production build passed.
Browser smoke passed import, preview bounds, manual decisions across reruns and
profile changes, cancelled/confirmed set removal and stopping a 60-file batch.
The actual worker produced local-1.0 results without AI fields; SHA-256 of the
synthetic original stayed unchanged. External requests and page errors: zero.
Artifacts are in output/playwright/ and ignored by Git.

Reproduce with npm run typecheck, npm run test:run, npm run build and
node scripts/culling-local-smoke.mjs against a local Vite server on port 3100.
The browser smoke needs separately installed Playwright and Chromium, or
CULLING_SMOKE_BROWSER pointing to an installed Chromium executable. See CONTRIBUTING.md.
Real photo/RAW batch calibration and large-device performance remain unverified.
