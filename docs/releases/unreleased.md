# Unreleased changes after 0.1.3

These notes describe the current `main` branch, verified locally on 21 October
2026. No new GitHub release or installer download has been published for these
changes. Package metadata remains 0.1.3; the culling engine is `local-1.4`.
The installer attached to the existing [0.1.3 release](0.1.3.md) retains its
previous behavior.

## Full original photographs

- Click a culling photograph to open the entire original image file, replacing
  the fixed 384 × 384 px detail viewer. Display uses the imported bytes without
  another image conversion or compression.
- The initial view fits the complete frame without cropping. Use the wheel or
  100%, 200% and 400% controls to zoom, then drag or use arrows to pan. Physical
  pixel scaling accounts for Windows display density.
- Select up to four frames with `+` to compare full photographs. K/R/X apply to
  the active frame; 0 fits the image, 1 selects 100%, and Esc closes the viewer.
- RAW still uses its embedded JPEG, not developed sensor data. The viewer uses
  the import source rather than later editor adjustments or retouching.

## Culling

Engine `local-1.4` corrects cases where small residual edge energy prevented a
soft original from receiving a reject suggestion. A verified series can also
identify weak original-resolution detail hidden by downscaling. That path
requires matching source dimensions, enough informative samples, low noise,
independently weak candidate detail and a sharp reference. A sampled sharp patch
protects the candidate from that original-resolution rule.

Manual choices still take priority. Culling remains local and deterministic,
without AI, models, API keys or photo uploads. Suggestions do not delete original
files; removing rejects from the working set still requires confirmation.

## Completed verification

- 147 tests across 22 files, TypeScript, web and desktop frontend builds, and the
  Windows NSIS installer build passed.
- Browser and native WebView2 checks verified identical original bytes, complete
  frames without clipping, physical pixel scaling, drag/wheel zoom, four-frame
  comparison and manual decisions across reruns. Browser DPR was 1.5; native DPR
  was 1.25. Culling external requests and page errors were zero.
- A read-only run on the same 114 sports JPEGs changed suggestions from
  94 keep / 17 review / 3 reject to 94 / 13 / 7. All original SHA-256 hashes
  remained unchanged. This is one calibration set, not a general accuracy claim.
- Native checks used a separate WebView2 profile. The local installed update
  preserved all 341 existing IndexedDB/localStorage files and matched the exact
  NSIS executable payload. This records that local update, not a public release.

Fixed automatic samples can still miss a small sharp subject. Culling does not
recognize eyes, expression, the decisive moment or focus on a particular subject.
Scores are technical indicators rather than probabilities of photo quality.

[Czech culling guide](../culling.md) · [Windows guide](../desktop.md) ·
[Documentation index](../README.md)
