<div align="center">
  <img src="public/brand/readme-logo-cs.png" alt="FrameMind — Tvorba poháněná inteligencí" width="440" />

  <h1>FrameMind Studio</h1>

  <p><strong>Vyberte. Upravte. Vyretušujte.</strong></p>

  <p>Fotostudio v prohlížeči pro celou cestu od karty k hotovým fotkám —<br />import, výběr, úpravy, retuš štětcem a export v jednom okně.<br />Retuš i úpravy počítá váš počítač, ne cloud.</p>

  <p>
    <a href="README.md"><img src="https://img.shields.io/badge/README-%C4%8Cesky-2f6fe0?style=for-the-badge" alt="Čeština" /></a>
    <a href="README.en.md"><img src="https://img.shields.io/badge/README-English-555?style=for-the-badge" alt="English" /></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/React-19-2f6fe0" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-5.8-2f6fe0" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Vite-6-b01ecb" alt="Vite 6" />
    <img src="https://img.shields.io/badge/ONNX_Runtime_Web-lok%C3%A1ln%C3%AD_AI-1fc06b" alt="ONNX Runtime Web" />
    <img src="https://img.shields.io/badge/PWA-ready-1fc06b" alt="PWA" />
  </p>
</div>

---

## Postup

| | Krok | Co dělá | Kde běží |
|---|---|---|---|
| 01 | **Import** | JPEG, PNG, WebP; z RAW (CR2, CR3, NEF, ARW, DNG…) se bere vložený JPEG náhled | lokálně |
| 02 | **Výběr** | ostrost, expozice, šum, kompozice, série a duplicity; klávesy K / R / X | lokálně · AI verdikty volitelně přes Gemini |
| 03 | **Úpravy** | *Automaticky* z histogramu + posuvníky světla, barvy, detailu a ořez | lokálně |
| 04 | **Retuš** | štětcem přejedete přes rušivý prvek a po puštění se místo dopočítá z okolí | lokálně (ONNX model v prohlížeči) |
| 05 | **Export** | JPEG / PNG, kvalita, velikost, vodoznak, celá sada do složky | lokálně |

Po importu víc fotek appka otevře rovnou výběr, u jedné fotky úpravy. K tomu lokální projekty a klienti s náhledem klientské galerie.

## Retuš štětcem bez API

Retuš funguje jako [cleanup.photo](https://cleanup.photo/): jeden štětec, žádné nastavování. Rozdíl je v tom, kde se počítá — model běží přímo v prohlížeči přes [ONNX Runtime Web](https://onnxruntime.ai/) ve web workeru (WebGPU, když ho prohlížeč má, jinak WASM na CPU). Fotka nikam neodchází a retuš nestojí kredity ani API klíč.

Dvě kvality:

| | Model | Velikost | Na co |
|---|---|---|---|
| **Rychlá** (výchozí) | [MI-GAN](https://huggingface.co/andraniksargsyan/migan) · MIT | 28 MB | drobnosti, kabely, texty, skvrny |
| **Detailní** | [LaMa](https://huggingface.co/Carve/LaMa-ONNX) · Apache-2.0 | 208 MB | velké plochy, lidé, auta |

Model se stáhne při prvním použití z Hugging Face (URL připnutá na konkrétní commit) a uloží se do Cache Storage prohlížeče — další spuštění ho čte z disku a retuš jde i offline.

**Jak to drží plné rozlišení:** modely pracují na čtverci 512 × 512. Z fotky se proto vyřízne jen okolí masky (maska zabírá zhruba polovinu výřezu, kvůli kontextu), model doplní ten výřez a zpátky do fotky se vloží **jen pixely pod maskou** s měkkým přechodem. Zbytek snímku zůstane v původním rozlišení; jediná ztráta je finální uložení JPEG (kvalita 0,96). Maska se před výpočtem rozšíří o pár pixelů — bez toho model „protáhne" obrys objektu dovnitř díry.

Ovládání: `[` / `]` velikost štětce · kolečko myši zoom · mezerník + tah posun · `0` celá fotka · `Ctrl+Z` zpět · držet **Porovnat** (nebo `\`) = originál.

## Gemini jako volitelný doplněk

Bez API klíče funguje všechno kromě dvou věcí, které appka nabízí navíc:

- **AI verdikty ve výběru** — Gemini posoudí fotky podle žánru (9 profilů: sport, portrét, svatba…), s krátkým zdůvodněním a volitelným briefem fotografa. Bez klíče výběr skončí lokálními verdikty.
- **Úprava textem** — v panelu Retuš popíšete změnu slovy a fotka se pošle do Gemini.

Klíč se zadává tlačítkem s klíčem vlevo dole ([Google AI Studio](https://aistudio.google.com/app/apikey)). Výchozí je uložení jen na relaci (`sessionStorage`), trvalé uložení chce potvrzení. API klíč nikdy nepatří do repozitáře ani do buildu.

## Jak začít

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # produkční build (dist/)
npm run preview    # náhled buildu
npm run typecheck
npm run test:run   # Vitest
```

**Hlavičky pro vícevláknovou retuš.** WASM běží na víc vláknech jen v cross-origin izolované stránce (`SharedArrayBuffer`). Dev server i `preview` posílají `Cross-Origin-Opener-Policy: same-origin` a `Cross-Origin-Embedder-Policy: credentialless`; na Vercelu totéž nastavuje `vercel.json`. Bez nich retuš funguje taky, jen pomaleji na jednom vlákně.

## Co je a co není

**Hotové:** všechno z tabulky výše, lokální CRM (projekty, klienti, náhled galerie) v úložišti prohlížeče, PWA, čeština i angličtina.

**Není:**

- plné vyvolání RAW (demosaicing) — z RAW se bere jen vložený náhled
- účty, synchronizace mezi zařízeními, cloud — data projektů jsou jen v tomhle prohlížeči
- serverový proxy pro Gemini — klíč je v prohlížeči uživatele
- ověření retuše na všech prohlížečích: WebGPU cesta závisí na prohlížeči a ovladači, WASM je záloha

## Technologie

| | |
|---|---|
| Aplikace | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 3 |
| Lokální AI | ONNX Runtime Web (MI-GAN, LaMa), MediaPipe Tasks (obličeje, osoby pro výběr) |
| Volitelná AI | Google Gemini (`@google/genai`) |
| Offline | vite-plugin-pwa (Workbox), Cache Storage pro modely |
| Písmo | Geist, Geist Mono, Instrument Serif |

```
App.tsx                    # kostra, navigace, historie (undo/redo)
components/
  EditorView.tsx           # editor: Úpravy / Retuš / Export
  editor/                  # plátno se štětcem, panely, sdílené prvky
  CullingView.tsx          # výběr
  DashboardView.tsx        # přehled
services/
  localInpaint.ts          # retuš: výřez → model → vložení do plného rozlišení
  geminiService.ts         # volitelné AI verdikty a úprava textem
utils/
  inpaintMath.ts           # čistá matika retuše (testovaná)
  autoAdjust.ts            # automatická úprava z histogramu (testovaná)
  cullingEngine.ts …       # heuristiky výběru
workers/
  inpaint.worker.ts        # ONNX Runtime + cache modelů
  culling.worker.ts
public/brand/              # logo FrameMind
```

---

<div align="center">
  <sub>FrameMind Studio je součást <a href="https://framemind.cz">FrameMind</a>.</sub>
</div>
