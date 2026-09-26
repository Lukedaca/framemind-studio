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
| 02 | **Výběr** (AI culling) | ostrost, expozice, šum, kompozice, série a duplicity; klávesy K / R / X | lokálně · AI verdikty volitelně přes Gemini |
| 03 | **Úpravy** | *Automaticky* z histogramu + posuvníky světla, barvy, detailu a ořez | lokálně |
| 04 | **Retuš** | štětec nebo chytré laso: označíte, co na fotce nemá být, a místo se dopočítá z okolí | lokálně (ONNX modely v prohlížeči) |
| 05 | **Export** | JPEG / PNG, kvalita, velikost, vodoznak, celá sada do složky | lokálně |

Po importu víc fotek appka otevře rovnou výběr, u jedné fotky úpravy. K tomu lokální projekty a klienti s náhledem klientské galerie.

## Retuš bez API

Retuš počítají modely přímo v prohlížeči přes [ONNX Runtime Web](https://onnxruntime.ai/) ve web workerech. Fotka kvůli ní nikam neodchází a nestojí kredity ani API klíč. Každý model se stáhne při prvním použití z Hugging Face (URL připnutá na konkrétní commit) a uloží se do Cache Storage prohlížeče, takže další spuštění ho čte z disku a retuš jde i offline.

### Kvalita

| Volba | Co dělá |
|---|---|
| **Automaticky** (výchozí) | drobnosti (plocha do ~120 × 120 px) jdou přes rychlý model, větší plochy a lidé přes detailní |
| **Rychlá** | vždy [MI-GAN](https://huggingface.co/andraniksargsyan/migan) · MIT · 28 MB — skvrny, prach, kabely, malý text |
| **Detailní** | vždy [LaMa](https://huggingface.co/Carve/LaMa-ONNX) · Apache-2.0 · 208 MB — velké plochy, lidé, auta |

Proč dva modely: MI-GAN je okamžitý, ale na větších dírách si vymýšlí. Na testovací fotce z utkání vyrobil místo odstraněné hlavy svítící fleky. LaMa na stejném místě plynule navázala rozmazaný dav v pozadí.

### Štětec

- **Velikost**, **tvrdost okraje** (0–100 %) a **síla** (10–100 %). Měkký štětec retuš k okraji plynule prolne s fotkou, nižší síla objekt jen zjemní (vráska, stín). Nastavení se pamatuje.
- Po puštění tahu je výsledek vidět hned; soubor v plném rozlišení se ukládá na pozadí.

### Chytré laso

- Kliknete na objekt a [SAM 2.1](https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX) (Meta · Apache-2.0 · varianta tiny int8, 61 MB) vrátí jeho přesný obrys. Další klik přidá další objekt, **Alt+klik** ubere.
- Z jednoho kliku jsou tři rozsahy — **Část / Objekt / Celek**. Klik na ruku tak umí vybrat ruku i celou postavu.
- Výběr se jen ukáže; retuš proběhne až po **Odstranit výběr**.
- Fotku model „přečte“ jednou (enkodér), každý další klik je pak otázka desítek milisekund. Změřeno v Node na i5-11400H na jednom vlákně: čtení fotky 3,8 s, klik 60–90 ms; v prohlížeči běží na víc vláknech.

### Jak to drží plné rozlišení a kvalitu

- Modely pracují na čtverci 512 × 512. Z fotky se proto vyřízne jen okolí masky — pro rychlý model 2×, pro detailní 4× delší strana masky, protože s víc kontextem LaMa doplňuje věrohodněji.
- Zpátky do fotky se vloží **jen pixely pod maskou** s měkkým přechodem. Zbytek snímku zůstane v původním rozlišení; jediná ztráta je finální uložení JPEG (kvalita 0,96).
- Maska se před výpočtem rozšíří o pár pixelů, jinak model „protáhne“ obrys objektu dovnitř díry.
- Doplněné místo dostane **zrno** změřené v okolí retuše. Bez toho je hladší než zbytek fotky a retuš prozradí.
- Rychlý model si při přípravě změří grafickou kartu (WebGPU) i procesor (WASM) a nechá rychlejší; detailní jde přes grafickou kartu, když ji prohlížeč nabízí.

Ovládání: `[` / `]` velikost štětce · kolečko myši zoom · mezerník + tah posun · `0` celá fotka · `Ctrl+Z` zpět · držet **Porovnat** (nebo `\`) = originál.

## Gemini jako volitelný doplněk

Bez API klíče funguje všechno kromě tří věcí, které appka nabízí navíc:

- **AI verdikty ve výběru** — Gemini posoudí fotky podle žánru (9 profilů: sport, portrét, svatba…), s krátkým zdůvodněním a volitelným briefem fotografa. Bez klíče výběr skončí lokálními verdikty.
- **Laso podle popisu** — napíšete třeba „všechna tetování“, Gemini najde, kde na fotce jsou, a přesné obrysy z toho udělá lokální SAM. Do Gemini jde zmenšená fotka (delší strana 1 536 px).
- **Úprava textem** — v panelu Retuš popíšete změnu slovy a fotka se pošle do Gemini.

Ve všech třech případech fotka (u výběru zmenšený náhled) odchází do Google Gemini (servery v USA). U lasa podle popisu a úpravy textem to appka říká přímo u pole; ve výběru popis kroku uvádí, že AI verdikty jdou přes Gemini.

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
- velké plochy (třeba celá postava) nemají plné rozlišení doplnění: LaMa má vstup napevno 512 × 512 a výřez se na něj zmenšuje, takže čím větší plocha, tím měkčí doplnění. U rozmazaného pozadí to nevadí, u ostrého je to vidět
- ověření retuše na všech prohlížečích: WebGPU cesta závisí na prohlížeči a ovladači, WASM je záloha

## Technologie

| | |
|---|---|
| Aplikace | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 3 |
| Lokální AI | ONNX Runtime Web (MI-GAN, LaMa, SAM 2.1), MediaPipe Tasks (obličeje, osoby pro výběr) |
| Volitelná AI | Google Gemini (`@google/genai`) |
| Offline | vite-plugin-pwa (Workbox), Cache Storage pro modely |
| Písmo | Manrope (titulky), Inter (rozhraní), Geist Mono (čísla) |

```
App.tsx                    # kostra, navigace, historie (undo/redo)
components/
  EditorView.tsx           # editor: Úpravy / Retuš / Export
  editor/                  # plátno (štětec, laso), panely, sdílené prvky
  common/FmMark.tsx        # značka FrameMind jako vektor
  CullingView.tsx          # výběr
  DashboardView.tsx        # přehled
services/
  localInpaint.ts          # retuš: výřez → model → zrno → vložení do plného rozlišení
  localSegment.ts          # chytré laso: vstup pro SAM, kliky, masky
  geminiService.ts         # volitelné: AI verdikty, laso podle popisu, úprava textem
utils/
  inpaintMath.ts           # čistá matika retuše — výřez, výběr modelu, zrno (testovaná)
  segmentModel.ts          # SAM 2.1: soubory, normalizace (testovaná)
  autoAdjust.ts            # automatická úprava z histogramu (testovaná)
  cullingEngine.ts …       # heuristiky výběru
workers/
  inpaint.worker.ts        # retuš: MI-GAN / LaMa
  segment.worker.ts        # chytré laso: SAM 2.1
  modelFetch.ts            # stažení modelu s průběhem + Cache Storage
  culling.worker.ts
public/brand/              # logo FrameMind
```

---

<div align="center">
  <sub>FrameMind Studio je součást <a href="https://framemind.cz">FrameMind</a>.</sub>
</div>
