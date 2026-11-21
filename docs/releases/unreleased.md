# Unreleased

Changes on `main` after [release 0.1.7](0.1.7.md) (source only; the latest published
Windows installer remains `0.1.7`).

## 21 November 2026 — adaptive strictness, optical defect rejection and darkroom UX

### Local culling engine (`local-2.0`, 100% local)
- **Automatic batch-adaptive strictness (`Auto`) + manual override (`Conservative / Balanced / Strict`)**:
  `recommendCullingStrictness` inspects the set's optical blur baseline, sharp share, noise level and
  series density to pick the right strictness automatically — without a fixed reject quota (an all-sharp
  set still rejects 0 photos). Switching strictness rescores immediately without remeasurement.
- **Directional motion blur (`subjectDirection`)**: `opticalMotionBlur` reads the four orientation bins
  already measured by `cullingOptics.ts` so linear motion blur is caught instead of masked by sharp edges
  parallel to the movement. Intentional motion, creative and stacking intents remain protected.
- **Back-focus / out-of-focus subject & higher-ISO tolerance**: distinguishes mild softness (`Review`)
  from strongly out-of-focus subjects (`Reject`) even beside a sharp background, removes false texture
  vetoes on blurry high-contrast frames, and raises the blur-evidence noise ceiling for realistic higher-ISO
  shooting while keeping extreme noise protected.
- **Optical series comparison**: verified burst series prefer optically sharper subjects and reject
  substantially softer alternatives directly against a sharp representative.

### Culling workflow & application intuitiveness
- **Photo-by-photo focus mode**: queue filter (`All / Review / Reject / Keep / Undecided`) with live
  counts, inline series indicator and one-click/shortcut series comparison (`C`), direct editor handoff
  button, shortcuts (`Z` or click for 1:1 on the detected subject/focus point, `M` for blur map,
  `Backspace` for step back, `Ctrl+Z` for Undo, `?` for shortcut help), and photographic EXIF strip
  (`1/1600 s · f/2.8 · ISO 800 · 200 mm`).
- **Whole-set Contact Sheet (Light Table)**: unobstructed photos with a 2 px top status bar and matte
  metadata footer below the image; expanded series open at the top of the viewport; live ETA during
  analysis; unified amber color for `Review`.
- **Darkroom UI & cross-app flow**: quiet obsidian active sidebar state with spectral edge hairline,
  non-clipping segmented controls, single-row editor header, non-overlapping top-right notifications,
  explicit *Add to current set / Start new set* choice on import, smart culling restore on launch, and
  *Apply to whole set* in `AdjustPanel` with edited indicators on the filmstrip.

### Verification (21 November 2026)
- TypeScript (`npm run typecheck`): passed with 0 errors.
- Unit tests (`vitest run`): **32 files, 277 tests passed** (including 9 new tests in
  `tests/cullingStrictness.test.ts` covering motion blur, back-focus, high-ISO blur, optical series
  ranking, strictness levels and `recommendCullingStrictness`).
- Desktop NSIS packaging was not run in this update; published Windows preview remains `0.1.7`.

## Archived development log before 0.1.7

The dated observations below describe development before publication. Statements
about an unpublished or uninstalled package are historical; use the release notes
above for current distribution and verification status.

Local development: application `0.1.7`, culling engine `local-2.0`.

14 November: optical sharpness (`local-2.0`). Blur radius in pixels measured at
straight, isolated edges on a bounded tile lattice over the whole frame plus a
denser lattice inside the detected object, independent of edge contrast and
texture. A sharp measured object removes texture-energy soft risks and vetoes
texture-based blur rejections; a soft object beside a sharp area is flagged
for review, never rejected; rejection needs every measured area blurred. New
**Output 100% / A4 print / Web** judges blur at the delivery size and only
rescores. The detail panel shows a blur map and values in output pixels.
Analysis uses two concurrent workers on machines with six or more threads.
Calibration set: 81/28/5 → 92/18/4; 18 published frames are all kept. Existing
analyses require remeasurement. See [culling](../culling.md#změny-local-20--14-listopadu-2026-optická-ostrost).
An unsigned Windows x64 NSIS installer has been built locally. These changes
have not been installed into the user's working application or
published. The published installer documented in this repository remains 0.1.6.

7 November: replace the culling-only WebGPU/Asyncify imports with standard
WASM assets, retaining one local worker thread. Use a preallocated Float64
noise buffer and native numeric sorting; sampled diagnostics remain exactly
equal. Sparse high-key/low-key subjects now require review instead of being
discarded as empty clipped frames. Original-scale structure also vetoes that
rule. Index series members once per render and scroll keyboard selections
into view. Existing automatic analyses require remeasurement; manual choices
remain authoritative. See [performance and verification](../culling-performance-2026-11-07.md).

- Automatically find salient objects using the bundled, SHA-256-pinned U²-NetP
  model. Measure up to twelve interior 128 × 128 source-pixel details without
  asking the photographer to mark a subject. Model and runtime assets stay local;
  no API key, runtime model download or photo upload is involved.
- Suggest rejection when consistently blurred automatic object measurements have
  enough usable evidence. Any sharp measured object detail vetoes this blur rule.
  Missing model evidence is visible as review. This does not identify eyes,
  expressions, photographic importance or the intended subject.
- **Use selection and open editor / Použít výběr a otevřít editor** confirms removal
  of rejected photos from the working set and continues to editing. Cancellation
  preserves the set; Undo restores removed photos and their culling metadata.
  Original files on disk are never removed by this action.

- Mark up to four important native-size details per photo. Every selected detail
  contributes: a sharp background or another selected region cannot rescue a soft one.
- Copy region positions to the photos open in comparison. Matching source sizes,
  region sizes, positions and visual content are required for regional series ranking.
  A relative blur rejection also needs independent soft candidate evidence and
  a sharp, quiet reference. Region copying does not track subjects.
- Select intent for the set or override individual photos: standard, selected-detail
  priority, intentional motion, creative freedom or stacking. Intentional motion
  excludes blur from scoring/rejection; creative and stacking modes disable automatic
  rejection and grouping. Stacking sets and artistic intent are not detected automatically.
- Distinguish technical-defect rejection suggestions from verified identical copies.
- Manual decisions, selected regions and individual intent survive reruns/profile
  changes. Existing automatic results require a fresh analysis; manual choices stay authoritative.
- Culling remains local. The model finds salient regions, not semantic subject
  classes. Photographic accuracy across real genres remains unverified. Technical
  region measurement and comparison use original implementation principles
  discussed in the [research review](../culling-research-2026-10-31.md).
  Model attribution and its license are bundled with the application.

Usage: [Czech culling guide](../culling.md). Regression checks include
`node scripts/culling-regions-smoke.mjs`, `node scripts/culling-local-smoke.mjs`
and `node scripts/culling-inspection-smoke.mjs` against a loopback Vite server on port 3100.

Verification on 1 November 2026: TypeScript and all 234 tests in 29 files passed.
Web/PWA and desktop frontend production builds passed. The preceding region worker/UI
check passed native-size blur evidence, multiple selected details, matched-region
series ranking, four-region limits, copying/removal, individual intents and manual
priority across reruns/profile changes. The existing culling and original-viewer
browser checks also passed, with zero culling external requests or page errors.
The automatic-selection browser check also passed object-detail measurement,
blur and identical-copy suggestions, cancelled and confirmed editor handoff,
Undo restoration and unchanged fixture hashes, with zero external culling
requests and page errors.

The initial Windows Auto QA build stalled during local-model initialization.
The culling model now uses one WASM thread inside its existing background worker
to avoid nested pthread workers on the packaged WebView2 origin. The rest of the
editor's model configuration is unchanged.

The repaired Windows Auto QA executable and the standard 0.1.7 executable both
passed the automatic-selection check using separate verified WebView2 profiles.
The final web production build passed the same check. This covered automatic object measurement,
blur and identical-copy rejection, cancelled and confirmed native dialogs, editor
handoff, Undo restoration of scores, decisions and explanations, and unchanged fixture hashes. External culling requests
and page errors were zero. This is a local Windows runtime check, not clean-machine
installation or cross-genre photographic accuracy. The NSIS installer was packaged
successfully; it has not been installed or published in this session.

A stored full automatic-model audit of 251 RAW previews measured automatic
regions in 246 images, with no unavailable-model results: 196 keep, 40 review,
15 reject. All source hashes were unchanged, with zero external culling requests
or page errors. These are one unlabelled set's suggestions, not an accuracy metric.

A pure replay of the stored 251-image RAW-preview measurements preserved all
scores/decisions with standard intent and no selected regions. Three RAW files
were also read again: manually selected regions changed a previously kept soft
detail to review, with rejection suggested under explicit detail priority; another
measured sharper selection remained keep. Those three source hashes were unchanged.
Private reports remain in ignored `output/playwright/`. Region size and placement
affect results; these examples are not photographer-labelled cross-genre accuracy.
The application's startup font request was blocked separately during the real-file
probe; no image data or culling requests left the loopback test environment.

Clearing the working set and its history is included in [0.1.6](0.1.6.md).
Retouch model reuse and response fixes are included in [0.1.5](0.1.5.md).
Adaptive retouching, clone/heal, full originals and culling local-1.6 were added
in [0.1.4](0.1.4.md). Older releases retain their original behavior.
See the [documentation index](../README.md) for current guides.
