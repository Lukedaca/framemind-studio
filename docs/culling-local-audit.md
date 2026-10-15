# FrameMind Solutions for Photo 1.0 — culling audit

> Dated audit and implementation history. Current product behavior and release evidence are indexed in [docs/README.md](README.md).

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
- Automatic results suggest keep/review/reject. Local 1.1 adds explained rejection
  suggestions for almost empty clipped previews, redundant near duplicates and
  substantially softer variants of verified similar scenes with a measurable,
  stronger reference. Low texture, isolated clipping and motion cues alone remain
  review evidence. Scores retain profile weights when evidence is weak instead of
  dropping sharpness weight and inflating the overall result. Choosing a series
  representative preserves manual decisions. Reruns and profile changes
  preserve manual decisions. Legacy automatic results require fresh analysis
  and do not collapse older groups or reuse AI labels.
- Import retains the session's original File and RAW preview provenance. RAW
  metadata comes from the original RAW, pixels from the extracted JPEG preview.
  Existing localStorage project storage still cannot persist original Files.

Historical local-1.0 verification: 91 unit tests passed; typecheck and production build passed.
Browser smoke passed import, preview bounds, manual decisions across reruns and
profile changes, cancelled/confirmed set removal and stopping a 60-file batch.
The actual worker produced local-1.0 results without AI fields; SHA-256 of the
synthetic original stayed unchanged. External requests and page errors: zero.
Artifacts are in output/playwright/ and ignored by Git.

Local-1.1 verification (Studio 0.1.1): 113 tests passed across 17 files;
typecheck and web/desktop frontend builds passed. The native WebView2 smoke
used a separate application identifier and synthetic JPEGs, leaving the open
installed application untouched. An informative copy and an empty black frame
received automatic reject suggestions. Manual keep/review/reject survived
reruns and a profile change; removal required confirmation and cancellation
left the set intact. Stopping a 60-file run also passed. Culling external
requests and page errors: zero. This is regression evidence, not calibration
on the user's football gallery.

Reproduce with npm run typecheck, npm run test:run, npm run build and
node scripts/culling-local-smoke.mjs against a local Vite server on port 3100.
The browser smoke needs separately installed Playwright and Chromium, or
CULLING_SMOKE_BROWSER pointing to an installed Chromium executable. See CONTRIBUTING.md.
Real photo/RAW batch calibration and large-device performance remain unverified.

## Local 1.2 — original-resolution samples and translated series, 2026-10-13

The previous implementation reproduced 110 keep / 4 review / 0 reject and no
groups on an authorized 114-image football JPEG set. Original-resolution
inspection showed that downscaling hid substantial softness in three frames.

- Larger sources now add up to nine sequential, unscaled 384px samples. The
  strongest informative sample limits the sharpness score. The original bitmap
  and a reused bounded canvas are used; no original-resolution RGBA array is kept.
- A native-blur reject suggestion requires measurable structure across at least
  five of nine samples, uniformly weak fine detail and low noise. Any observed
  sharp patch vetoes this rule. Low texture and insufficient samples alone cannot
  trigger it. Sampling can still miss a small sharp subject between positions;
  these are reversible technical suggestions, not content-aware quality labels.
- A symmetric, bounded translation search compensates for small camera shifts
  when capture time or filename sequence supports a burst. Local luminance changes
  and color disagreement still veto grouping. Registration never establishes a
  near duplicate; complete linkage and existing group limits remain in force.
- Stored automatic local-1.1 results require fresh analysis. Manual choices retain
  precedence. The detail panel exposes source size and native sample measurements
  in Czech and English; RAW still measures its embedded JPEG, not sensor pixels.

Verification: 122 tests across 18 files, typecheck, web build and desktop frontend
build passed. The same real JPEG set produced 94 keep / 17 review / 3 reject and
three two-frame burst groups in 92 seconds on this machine, compared with 54 seconds
for the previous engine. Reject suggestions were IMG_9944, IMG_9945 and IMG_9946.
All 114 original SHA-256 hashes matched after analysis; culling external requests
and page errors were zero. Private reports and contact sheets are in ignored
output/playwright/sigma-{baseline,final}-audit.json and associated images.

The browser UI smoke passed manual decisions, reruns, profile changes, cancellation
and confirmed/dismissed set removal. A separate native application identifier
cz.framemind.studio.culling-qa-20261013 was used for the Windows WebView2 check.
All three real soft frames received reject suggestions; IMG_9981 stayed keep.
Native sample diagnostics and a manual keep override across rerun/profile change
passed, with zero culling external requests and page errors. The user's open
installed application was left running. The normal-identifier NSIS development
installer was subsequently built at version 0.1.2 (214.41 MiB), without installing
or publishing it. Native evidence is in output/playwright/native-culling-real.json.

This is calibration and regression evidence for one JPEG gallery. Accuracy across
other genres/cameras, real RAW sets and small subjects between samples remains
unverified. Native export and retouch were outside this change.

Reproduce the real-set audit with a local server on port 3100:
node scripts/culling-batch-audit.mjs "<local photo folder>" calibration
The script only reads the supplied folder and writes reports to ignored output/.
