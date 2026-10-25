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
installer was subsequently built at version 0.1.2 (about 225 MB), without installing
or publishing it. Native evidence is in output/playwright/native-culling-real.json.

This is calibration and regression evidence for one JPEG gallery. Accuracy across
other genres/cameras, real RAW sets and small subjects between samples remains
unverified. Native export and retouch were outside this change.

Reproduce the real-set audit with a local server on port 3100:
node scripts/culling-batch-audit.mjs "<local photo folder>" calibration
The script only reads the supplied folder and writes reports to ignored output/.

## Local 1.3 development — region inspection and conservative comparison, 2026-10-20

This change was developed in the canonical checkout at baseline `92ee69c`.
It uses this repository's source and local synthetic/authorized real images;
no scraping or reverse engineering was used. The installed Studio process was
left running. At the start of this work the last published product release was
0.1.2. The following records development of culling engine `local-1.3` before
its packaging and publication as Studio 0.1.3.

- Culling cards show the entire import preview without cropping. A double-click
  opens an original-resolution detail view. Up to four selected frames can be
  compared with linked or independent normalized crop positions, shared 1:1/2:1
  zoom, arrow-key movement and K/R/X decisions on the active frame.
- Each 384px region is decoded and measured sequentially in an owned worker.
  The displayed PNG preserves decoded crop pixels. Device pixel ratio determines
  physical 1:1 scale; no full-resolution RGBA buffer is retained. RAW inspection
  uses the immutable import JPEG preview, not a subsequently edited render.
- Selected-region metrics are an inspection aid, not subject recognition and
  not an automatic verdict override. Their position is local to the open view.
  Worker cancellation and Blob URL cleanup prevent stale results or retained
  crop resources when the selected position changes or the view closes.
- Completed full-image measurements are reused across workers only for the
  exact pixel Blob, original metadata Blob and source kind in this application
  session. A new Blob with identical file attributes is remeasured. A fresh
  application session requires new measurement. Explicit remeasurement bypasses
  the cache. Scores and groups are recomputed and manual decisions are preserved.
- Relative rejection in a verified series uses native evidence only at matching
  source dimensions with sufficient informative samples. Native and preview
  detail must agree on the deficit; a contradiction vetoes relative rejection.
  Group classification retains the complete-linkage admission evidence, removing
  the second all-pairs pass without weakening scene-change checks or group limits.

Verification of the final source: 144 tests across 22 files, typecheck, production
web build, desktop frontend build and a Windows release-profile executable build
passed. The final 400-image determinism/cap test took 1.9 seconds on this run;
this is a regression check, not a controlled cross-version performance benchmark.
The browser culling regression passed reruns, profiles, manual choices, stop and
confirmed/dismissed removal. The comparison smoke passed four-frame selection,
the four-frame cap, linked/independent regions, physical pixel scale at DPR 1.5,
2:1 scale and a manual decision across rerun. Direct worker inspection verified
pixel equality with the decoded original, unchanged source SHA-256, detection of
a small detailed region missed by the fixed grid, zero analyze requests on a cache
hit and one on forced remeasurement. External culling requests and page errors
were zero. Reports are in ignored output/playwright/culling-{local-smoke,inspection}.json.

The 114-image football gallery was measured again read-only; all original SHA-256
hashes matched and external requests/page errors were zero. Initial native-only
relative ranking produced a disputed fourth reject for IMG_9969. The disagreement
between preview and sample evidence motivated the two-scale veto above. Replaying
the final pure scoring/grouping code over those measured metrics returned
94 keep / 17 review / 3 reject and six grouped photos. IMG_9969 remains review;
the reject suggestions are IMG_9944, IMG_9945 and IMG_9946. The final replay does
not re-decode photos and is not a fresh timing benchmark. Reports are
output/playwright/sigma-local13-audit.json and sigma-local13-final-replay.json.

One JPEG gallery does not establish general photographic accuracy or a European
ranking. Other cameras, real RAW sets, very small subjects and other genres still
need independent labeled calibration. The existing native-blur rule can miss a
small sharp subject between fixed sample positions; the manual inspector helps
review this limitation, but does not turn it into subject-aware automation.

Reproduce comparison verification with node scripts/culling-inspection-smoke.mjs
against a local server on port 3100. It also supports DESKTOP_SMOKE_CDP for a
separate native QA executable/profile. Native results are written to
output/playwright/native-culling-inspection.json. The development native build
uses identifier cz.framemind.studio.culling-qa-20261020 so it can run alongside
the user's installed application. The native WebView2 run passed four-frame
comparison, the selection limit, linked/independent crops, 1:1/2:1 display at
actual Windows DPR 1.25 and the manual choice across rerun. Native external
requests and page errors were zero. The owned QA process was closed afterwards;
the original installed process remained running.

A separate unsigned development installer uses the ignored version-only overlay
output/playwright/culling-local13-preview-config.json to package version 0.1.3
with the normal application identifier. This does not change the published
release, install an update or publish an artifact. Build it from an x64 Visual
Studio developer command environment:
node node_modules/@tauri-apps/cli/tauri.js build --bundles nsis --config output/playwright/culling-local13-preview-config.json
The overlay contains exactly {"version":"0.1.3"}; recreate it locally if needed.

Packaging completed successfully. The resulting
src-tauri/target/release/bundle/nsis/FrameMind Studio_0.1.3_x64-setup.exe is
229644389 bytes and both installer/application ProductVersion fields are 0.1.3.
Installer SHA-256: 17d68a834cf39d3209915d3c704486f5c3d977b93b0344cf787b66b074637d5c.
At that checkpoint the installer had not been run or published; installation
is recorded below.

### User-authorized installation follow-up, 2026-10-20

The user then explicitly requested installation. The same verified installer was
run with /S /UPDATE into the existing current-user installation. Windows uninstall
registration and executable metadata both report 0.1.3. The installed executable
was verified against the actual payload of that installer: SHA-256
e8bc156c6e323e455e6e8f61bff303bd4c596219478c86ed2dc0de8d94842572.
The loose post-bundle release executable has a different hash, so that file was
not used as the payload-equivalence reference. All 12 existing IndexedDB and
localStorage files had unchanged hashes and inventory after installation, before
first launch. The normal installed application was opened without a QA profile
or debug arguments and its window was responding. Evidence is in ignored
output/playwright/studio-install-0.1.3.json and studio-0.1.3-payload-verification.json.

### Documentation and release preparation, 2026-10-20

The user requested alignment of GitHub documentation and framemind.cz.
Source version manifests were aligned to 0.1.3; the download uses the same
verified installer recorded above, with its existing SHA-256 unchanged.
Both READMEs, the documentation index and Windows guide now describe local-1.3,
with a current culling usage guide and version-specific release notes.
Nine current-interface screenshots, including two-frame region inspection,
were captured from the production frontend in an isolated browser profile using
already-public FrameMind demo images. Capture reported zero page errors.
Private calibration photographs and local verification reports remain excluded
from Git. The website copy and its product knowledge record describe the same
features, data flow, unsigned release status and calibration limits.
