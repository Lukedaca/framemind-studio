# Contributing to FrameMind Studio

[Český návod](README.md) · [English guide](README.en.md) · [MIT license](LICENSE)

FrameMind Studio is maintained by Lukáš Drštička (Lukedaca). Contributions are
welcome through GitHub issues and pull requests. The application runs locally;
changes must not introduce automatic application deployments.

## Report a problem

Include the steps to reproduce, expected and actual behavior, application version
and desktop/browser mode, browser/version where relevant,
operating system and relevant console errors. For import problems, describe the
file type and camera model if known. Share a minimal sample only when you have
permission to publish it. Do not put API keys, client details or private photos
in public issues.

Describe whether a culling problem concerns measurement, grouping or your manual
decision. A low technical score alone does not prove that the photo is unusable.

## Work on a change

Use Node.js 22 and install the locked dependencies with `npm ci`.
Create a branch or fork, keep the change focused, and update both READMEs when
user-visible behavior changes.

```bash
npm run typecheck
npm run test:run
npm run build
npm run build:desktop
```

CI runs these checks on pushes to main and pull requests. It verifies a build,
without deploying the application. Explain additional browser or real-image
checks in the pull request; distinguish completed checks from unverified behavior.

For native changes, build and exercise the Windows installer with
`npm run desktop:build`; requirements and optional WebView smoke checks are in
[docs/desktop.md](docs/desktop.md). Windows CI builds an installer artifact and
does not publish a release or deploy anything. Keep `Cargo.lock` committed.
Use and await `confirmAction` for confirmations. It selects the public Tauri
dialog API in desktop mode and browser confirmation in web mode.

## Preserve culling boundaries

Culling is local and deterministic. Its import graph must not reach Gemini,
API-key management, downloaded detectors, ONNX, usage tracking or network calls.
Keep preview limits visible. Preserve manual choices across reruns and profile
changes, require confirmation for set removal, and leave original disk files intact.
Automatic suggestions may include keep, review or reject with an explained technical reason.
Preserve manual decisions; removing rejected images from the set still requires confirmation.

The editor currently contains separate local ONNX paths and two Gemini paths.
Document their actual data flow instead of claiming that the entire application
is offline.

## Optional browser smoke check

The scripts are separate from `npm run test:run` and from CI. Playwright is a
locked development dependency installed by `npm ci`; it is not needed by users
of the packaged application. For an optional local check:

```bash
npm ci
npx playwright install chromium
node node_modules/vite/bin/vite.js --port 3100 --strictPort
```

In a second terminal:

```bash
node scripts/culling-local-smoke.mjs
node scripts/culling-inspection-smoke.mjs
```

The script uses synthetic photos and writes results to ignored
`output/playwright/`. Override `CULLING_SMOKE_URL` for another local server.
Set `CULLING_SMOKE_BROWSER` to an installed Chromium executable to use it instead
of the Playwright browser. For example in PowerShell:

```powershell
$env:CULLING_SMOKE_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node scripts/culling-local-smoke.mjs
```

The script blocks external requests and checks that culling makes none after
entering the culling screen. It does not prove that application startup or every
editor feature is offline. Synthetic tests do not calibrate photographic quality.
The culling check also compares pervasive native softness with an otherwise
identical frame containing a small sharp patch between the fixed sampling locations.

For a read-only comparison of a local sports shoot with one photographer's exports:

```powershell
node scripts/culling-selection-audit.mjs 'D:\Photos\Match\RAW' 'D:\Photos\Match\JPEG' match-check
```

This script uses the `sport` profile and matches source/export basenames,
including `edited_` and `autopilot_` prefixes. RAWs use the application's embedded
JPEG preview path. Optional source filenames after the label restrict a diagnostic
run to those originals and also save their analysis sources in ignored output.
Subset runs do not reproduce full-set grouping. Unmatched exports are reported.
Exported frames are examples of one person's choice; unexported frames are not
bad-photo labels. Keep all private files and reports out of commits. Original
hashes, blocked requests and page errors are checked before a successful report.

The inspection script checks one-click opening of full originals, exact imported
bytes, fitting the entire image without clipping, physical pixel scaling, drag
and wheel zoom, four-frame comparison and manual decisions across reruns.
Its worker checks also cover exact decoded crop pixels, measurement caching
and forced remeasurement. For native mode use
`DESKTOP_SMOKE_CDP` with a separate QA profile as described in the Windows guide.

For adjustment-preview checks, run the dev server on port 3101 and execute
`node scripts/editor-preview-smoke.mjs`. Override `EDITOR_SMOKE_URL` for another
local URL. The script checks worker/export pixel parity, alpha preservation,
source caching, latest-request handling, fallback rendering and photo switching.
It also records timings on a generated 24 MP image in `output/playwright/`.
Optional `EDITOR_BASELINE_MODULE` points to a Vite-served copy of an earlier
renderer from this repository for before/after pixel and timing comparisons.
These checks exercise Chromium; they do not verify the installed Tauri application.

Run `node scripts/editor-history-smoke.mjs` against the same local server to test
Undo/Redo gestures, auto adjustment, crop, restoring originals, project isolation,
save failure/retry and complete browser shutdown/restart. It uses synthetic photos
and an isolated Chromium profile under ignored `output/playwright/history-profile-*`.
It checks original hashes, asset deduplication, atomic rollback and preservation
of legacy metadata. It never opens a normal browser profile or existing user photos.

For local retouching, place the exact model files configured in
`utils/inpaintModels.ts` in ignored `output/playwright/retouch-quality/` as
`fast.onnx` and `quality.onnx`, then run `node scripts/retouch-quality-smoke.mjs`.
The script checks file sizes, seeds an isolated browser cache from those local
copies, and blocks external requests. It exercises both real models on synthetic
images, crop proportions, lossless saves and preservation outside the patch.
Metrics and before/after PNGs are written beside the test models. This is not
an assessment of retouch quality on real photographs or native WebView2 evidence.

Run `node scripts/retouch-adaptive-smoke.mjs --hd` for the adaptive retouch path,
using the same local `fast.onnx` and `quality.onnx` files and `EDITOR_SMOKE_URL`.
The browser path checks separated repair regions, unchanged source pixels and
pixels outside the patch. The editor checks distinct context variants, Cancel
and Escape, one history step on Apply, exact Undo/Redo and an actual 1024-pixel
LaMa worker request. It uses synthetic photographs, not a representative quality
benchmark. Reports and screenshots go to ignored `output/playwright/retouch-adaptive/`.
The script launches an isolated Chromium context by default. For native UI checks,
set `DESKTOP_SMOKE_CDP` to a Tauri/WebView2 instance started with a separate test
profile; the script attaches to that instance. A Chromium run alone does not
establish native application behavior.

For a short native clone-brush check without model inference, run
`powershell.exe -NoProfile -File scripts/windows-retouch-smoke.ps1 -Quick`.
It checks a real source sample, a lossless working copy and unchanged originals.
Add `-ModelCheck` to exercise actual MI-GAN inference, cached reopening and a
second repair. It uses the local fast-model file, does not decode whole images
while polling computation, and checks the original JPEG's complete SHA-256.

After a desktop build, run
`powershell.exe -NoProfile -File scripts/windows-retouch-smoke.ps1 -Hd` for the
native check. It refuses an already running Studio, creates a separate WebView2
profile, seeds models directly into its cache without changing CSP, and compares
the normal workspace's IndexedDB/localStorage file hashes before and after.

For the bounded 24 MP retouch-response comparison, run
`node scripts/retouch-performance-smoke.mjs` with the local `fast.onnx` file above.
It compares the 0.1.4 brush with the current source, checks unchanged mask pixels,
counts redundant drawing/blur work and verifies shared model preparation plus
actual MI-GAN inference. It uses an isolated browser and a 150-second deadline.

## License

Contributions are submitted under the repository's MIT license. Retain third-party
license notices and document the source and license of any added model or asset.
