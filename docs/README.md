# FrameMind Studio documentation

Latest published development release: **0.1.6**, Windows x64, unsigned preview.
It adds confirmed clearing of the working photo set and its history while keeping
saved projects and disk originals. Adaptive retouching, clone/heal brushes, full
originals and culling engine `local-1.6` remain available.
See [clearing behavior and verification](releases/0.1.6.md).

Current source: **0.1.7 / local-1.8**, with bundled local U²-NetP object-region
measurement, automatic blur suggestions, optional manual regions and per-photo
intent, and confirmed selection-to-editor handoff with Undo. The local Windows
installer is prepared but has not been installed or published. TypeScript, 234
tests, both frontend builds and web/native automatic-selection checks passed.
See [current development changes and verification](releases/unreleased.md).

- [Český přehled funkcí, dat a omezení](../README.md)
- [English feature, data and limitation guide](../README.en.md)
- [Windows installation, updates and native verification](desktop.md)
- [Local culling: full originals, zoom, comparison and shortcuts (Czech)](culling.md)
- [Release 0.1.6: clear the working photo set](releases/0.1.6.md)
- [Release 0.1.5: model reuse and brush response](releases/0.1.5.md)
- [Release 0.1.4: retouching, subject regions and verified duplicates](releases/0.1.4.md)
- [Current 0.1.7 development changes and verification](releases/unreleased.md)
- [Current interface screenshots](../demo-screenshots/README.md)
- [Previous release 0.1.3](releases/0.1.3.md)
- [Previous release 0.1.2](releases/0.1.2.md)
- [Contributing and optional synthetic browser checks](../CONTRIBUTING.md)

The source of truth is this repository, `Lukedaca/framemind-studio`.
The product page is [framemind.cz/photo](https://framemind.cz/photo/); use the
source guide and release notes above to distinguish current code from published
downloads. GitHub hosts code and downloads, not private projects or photos.

`culling-local-audit.md` is a dated implementation and verification log.
Documents under `plans/` are historical proposals, not current feature contracts.
Use the current guides above when a historical plan differs from the application.
