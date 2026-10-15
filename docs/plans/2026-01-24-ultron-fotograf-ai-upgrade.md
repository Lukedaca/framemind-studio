# ULTRON: Fotograf-AI Massive Upgrade Plan

> Historical proposal. See [current Studio documentation](../README.md) for implemented behavior and verification.

**Datum**: 2026-01-24
**Projekt**: Fotograf-AI
**Kódové jméno**: ULTRON
**Autor**: Lukáš Drštička + JARVIS
**Cíl**: Vytvořit produkt, ze kterého si všichni sednou na prdel

---

## EXECUTIVE SUMMARY

Fotograf-AI je solidně postavená aplikace, ale trpí třemi hlavními problémy:
1. **Autocrop nefunguje** - je to jen UI tlačítko bez logiky
2. **Generický design** - vypadá jako každá druhá SaaS aplikace
3. **AI je schovaná** - místo aby byla hlavní hvězdou, je zapadlá v manuálních úpravách

Tento plán transformuje Fotograf-AI z "další editing tool" na **"AI-first photo studio"**.

---

## ČÁST 1: AUTOCROP FIX

### 1.1 Současný stav
- UI tlačítko existuje, naviguje na `action: 'auto-crop'`
- `onStartManualCrop={() => {}}` - prázdná funkce!
- Žádná AI logika pro detekci obsahu

### 1.2 Implementace Smart Autocrop

```typescript
// Nová funkce v geminiService.ts
async function analyzeForAutoCrop(imageBase64: string): Promise<AutoCropResult> {
  const prompt = `Analyze this image for optimal cropping:
    1. Identify the main subject(s) and their positions
    2. Detect rule of thirds points
    3. Find visual weight centers
    4. Suggest optimal crop for: portrait, landscape, square, 16:9

    Return JSON: {
      mainSubject: { x, y, width, height },
      facesBoundingBox: { x, y, width, height } | null,
      suggestedCrops: [
        { aspectRatio: "1:1", rect: {x,y,w,h}, confidence: 0-1 },
        { aspectRatio: "4:3", rect: {x,y,w,h}, confidence: 0-1 },
        { aspectRatio: "16:9", rect: {x,y,w,h}, confidence: 0-1 }
      ],
      safeZone: { x, y, width, height }, // Oblast kde NESMÍ být ořez
      composition: "centered" | "rule-of-thirds" | "golden-ratio"
    }`;
  // ... Gemini API call
}
```

### 1.3 Úkoly
| ID | Úkol | Priorita |
|----|------|----------|
| AC-1 | Přidat `analyzeForAutoCrop()` do geminiService.ts | P0 |
| AC-2 | Vytvořit `AutoCropPreview` komponentu s více návrhy | P0 |
| AC-3 | Implementovat `handleAutoCrop()` v EditorView | P0 |
| AC-4 | Přidat animovaný overlay pro crop návrhy | P1 |
| AC-5 | Keyboard shortcuts (1,2,3 pro výběr návrhu) | P2 |

---

## ČÁST 2: DESIGN REVOLUTION - "BRUTALIST PHOTO LAB"

### 2.1 KRITICKÉ: Současný design je STÁLE generický!
Screenshot analýza ukazuje:
- ❌ Stále slate-950 pozadí
- ❌ Stále cyan/orange gradienty (typický "AI startup" look)
- ❌ Stále rounded corners všude
- ❌ Stále nudný sidebar layout
- ❌ Vypadá jako KAŽDÁ DRUHÁ AI aplikace

### 2.2 RADIKÁLNÍ změna: "BRUTALIST PHOTO LAB"

**ZAKÁZANÉ prvky (ODSTRAŇ Z CELÉ APLIKACE):**
- ❌ Gradient backgrounds (žádné from-cyan-to-purple)
- ❌ Rounded-xl/2xl/3xl (max rounded-sm nebo nic)
- ❌ Glassmorphism/backdrop-blur
- ❌ Slate barvy (slate-900, slate-950)
- ❌ Neon/glow efekty
- ❌ Soft shadows

**POVINNÉ prvky (NOVÝ VIZUÁLNÍ JAZYK):**

#### A) Barevná paleta - KONTRASTNÍ & ODVÁŽNÁ

```css
/* tailwind.config.cjs - KOMPLETNĚ PŘEPSAT */
colors: {
  // Pozadí - čistá čerň, ne slate
  void: '#000000',
  surface: '#0d0d0d',
  elevated: '#1a1a1a',

  // Primární akcent - VÝRAZNÁ ČERVENÁ (ne oranžová!)
  accent: {
    DEFAULT: '#FF0040',  // Neon červená
    hover: '#FF3366',
    muted: '#990033',
  },

  // Sekundární - ČISTÁ BÍLÁ pro kontrast
  white: '#FFFFFF',
  gray: {
    100: '#F5F5F5',
    400: '#9CA3AF',
    600: '#4B5563',
    800: '#1F1F1F',
  },

  // Funkční barvy
  success: '#00FF88',
  warning: '#FFCC00',
  error: '#FF0040',
}
```

#### B) Typografie - BRUTALISTICKÁ

```css
/* Headings: Space Grotesk (brutalist, industrial) */
/* Body: IBM Plex Mono (technický, profesionální) */

@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

.heading {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.body {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
}
```

#### C) Layout - ASYMETRICKÝ GRID

```
┌─────────────────────────────────────────────────────────────┐
│ FOTOGRAF AI                          [API] [EXPORT] [■■■]  │
│ ════════════════════════════════════════════════════════════│
│                                                             │
│  ┌───────────────────────────────────────┐  ┌────────────┐ │
│  │                                       │  │ AI CONTROL │ │
│  │                                       │  ├────────────┤ │
│  │            CANVAS                     │  │ ▶ AUTO     │ │
│  │            100%                       │  │ ▷ PORTRAIT │ │
│  │                                       │  │ ▷ LANDSCAPE│ │
│  │                                       │  │ ▷ PRODUCT  │ │
│  └───────────────────────────────────────┘  │            │ │
│                                             │ ────────── │ │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┐    │ ANALYSIS   │ │
│  │CROP │LIGHT│COLOR│SHARP│ FX  │ AI  │    │ Exp: +0.5  │ │
│  └─────┴─────┴─────┴─────┴─────┴─────┘    │ Sat: OK    │ │
│                                             └────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### D) Komponenty - OSTRÉ HRANY, SILNÉ LINIE

```tsx
// PŘED (generické)
<div className="bg-slate-900 rounded-2xl p-6 shadow-lg">

// PO (brutalist)
<div className="bg-surface border-l-4 border-accent p-4">
```

```tsx
// PŘED (soft button)
<button className="bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full px-6 py-3">

// PO (brutalist button)
<button className="bg-accent text-black font-mono uppercase tracking-wider px-6 py-2 hover:bg-white hover:text-black transition-none">
```

#### E) Specifické změny v komponentách

**Dashboard cards:**
```tsx
// PŘED
<div className="bg-gradient-to-br from-cyan-500/20 to-purple-500/20 rounded-2xl">

// PO - čistý border design
<div className="bg-void border border-gray-800 hover:border-accent">
  <div className="border-b border-gray-800 px-4 py-2">
    <span className="text-accent font-mono text-xs uppercase">Pipeline</span>
  </div>
  <div className="p-4">
    <h3 className="text-white font-bold text-xl uppercase tracking-wide">
      Nová zakázka
    </h3>
  </div>
</div>
```

**Sidebar:**
```tsx
// PŘED - rounded icons, soft hover
// PO - brutalist menu
<nav className="border-r border-gray-800 w-48">
  <a className="block px-4 py-3 border-l-4 border-transparent hover:border-accent hover:bg-gray-800/50 font-mono text-sm uppercase">
    AI Command
  </a>
</nav>
```

**Buttons:**
```tsx
// Primary button
<button className="bg-accent text-black px-6 py-2 font-mono uppercase text-sm tracking-wider hover:bg-white">
  Spustit
</button>

// Secondary button
<button className="border border-gray-600 text-white px-6 py-2 font-mono uppercase text-sm tracking-wider hover:border-accent hover:text-accent">
  Zrušit
</button>
```

### 2.3 Soubory k úpravě

| Soubor | Co změnit |
|--------|-----------|
| `tailwind.config.cjs` | Kompletně přepsat colors, odstranit slate |
| `styles.css` | Přidat fonty, globální reset rounded |
| `index.html` | Přidat Google Fonts link |
| `components/Sidebar.tsx` | Border-l design místo rounded icons |
| `components/Header.tsx` | Uppercase logo, brutalist nav |
| `views/DashboardView.tsx` | Border cards místo gradient cards |
| `views/EditorView.tsx` | Asymetrický layout, ostré panely |
| `views/AICommandCenter.tsx` | Industrial look, monospace text |
| `components/Button.tsx` | Vytvořit novou komponentu |

### 2.4 Vizuální reference

Inspirace:
- **Stripe Dashboard** - čisté, funkční
- **Linear App** - minimalistické, ostré
- **Vercel** - černobílé s akcenty
- **Teenage Engineering** - brutalist industrial

NENÍ inspirace:
- ~~Figma~~ (příliš soft)
- ~~Notion~~ (příliš rounded)
- ~~Typical AI SaaS~~ (gradient hell)

### 2.5 Úkoly - DESIGN
| ID | Úkol | Priorita | Detail |
|----|------|----------|--------|
| DS-1 | Přepsat tailwind.config.cjs | P0 | Nové barvy, odstranit slate, přidat void/surface/accent |
| DS-2 | Přidat fonty Space Grotesk + IBM Plex Mono | P0 | Google Fonts v index.html |
| DS-3 | Globální CSS reset | P0 | Odstranit všechny rounded-xl/2xl, shadows |
| DS-4 | Přepracovat Sidebar.tsx | P0 | Border-l hover, uppercase, monospace |
| DS-5 | Přepracovat DashboardView.tsx | P0 | Border cards, ne gradient cards |
| DS-6 | Přepracovat Header.tsx | P0 | Brutalist nav, uppercase logo |
| DS-7 | Vytvořit Button.tsx komponentu | P0 | Primary/secondary/ghost varianty |
| DS-8 | Přepracovat AICommandCenter.tsx | P0 | Industrial panel design |
| DS-9 | Přepracovat EditorView.tsx | P1 | Asymetrický layout |
| DS-10 | Odstranit VŠECHNY gradienty | P0 | Grep "gradient" a nahradit |
| DS-11 | Odstranit VŠECHNY blur efekty | P0 | Grep "blur" a nahradit |

---

## ČÁST 3: OPRAVA TEXTŮ - ENCODING & LOKALIZACE

### 3.1 KRITICKÝ BUG: Encoding problém

Screenshot ukazuje rozbitý text:
```
ŠPATNĚ: "â€¢ ZvÄ Ĺ¨it kontrast pro dramatiÄŤtÄ›jÅ¡Ă dojem"
SPRÁVNĚ: "• Zvýšit kontrast pro dramatičtější dojem"

ŠPATNĚ: "â€¢ OĹ™Äznout pro rule of thirds kompozici"
SPRÁVNĚ: "• Oříznout pro rule of thirds kompozici"

ŠPATNĚ: "â€¢ PĹ™idat vignette pro focus na subjekt"
SPRÁVNĚ: "• Přidat vignette pro focus na subjekt"
```

### 3.2 Příčina problému

Texty z Gemini API přichází v UTF-8, ale někde se špatně dekódují (pravděpodobně double-encoding nebo špatný charset).

**Možné příčiny:**
1. Gemini vrací UTF-8 ale response se parsuje jako Latin-1
2. JSON.parse bez správného encoding
3. Chybí `<meta charset="UTF-8">` v HTML
4. LocalStorage ukládá/načítá špatně

### 3.3 Oprava encoding

```typescript
// services/geminiService.ts

// PŘED
const text = response.text();

// PO - zajistit správné dekódování
const text = new TextDecoder('utf-8').decode(
  new TextEncoder().encode(response.text())
);

// Nebo sanitizace při zobrazení
function sanitizeText(text: string): string {
  // Fix common encoding issues
  return text
    .replace(/â€¢/g, '•')
    .replace(/Ä›/g, 'ě')
    .replace(/Å¡/g, 'š')
    .replace(/Ä/g, 'č')
    .replace(/Å™/g, 'ř')
    .replace(/Ĺ¨/g, 'ý')
    .replace(/Ă/g, 'í');
}
```

### 3.4 Konzistence jazyků

**Problém:** Míchání angličtiny a češtiny
```
ŠPATNĚ: "Side-by-side preview and AI analysis."
SPRÁVNĚ: "Náhled vedle sebe a AI analýza."

ŠPATNĚ: "SOURCE FILE" + "No files available"
SPRÁVNĚ: "ZDROJOVÝ SOUBOR" + "Žádné soubory"

ŠPATNĚ: "ENHANCEMENT MODES" + "Auto" + "Portrait"
SPRÁVNĚ: "REŽIMY VYLEPŠENÍ" + "Auto" + "Portrét"
```

### 3.5 Lokalizační soubor - AKTUALIZOVAT

```typescript
// contexts/LanguageContext.tsx nebo utils/translations.ts

const cs = {
  // AI Command Center
  aiCommandCenter: {
    title: 'AI Řídicí Centrum',
    subtitle: 'Náhled vedle sebe a AI analýza',
    status: 'Stav',
    foundation: 'Základ',
    sourceFile: 'Zdrojový soubor',
    noFiles: 'Žádné soubory k dispozici',
    original: 'Originál',
    aiEnhanced: 'AI Vylepšeno',
  },

  // Enhancement modes
  enhancementModes: {
    title: 'Režimy vylepšení',
    auto: 'Automatický',
    portrait: 'Portrét',
    landscape: 'Krajina',
    product: 'Produkt',
    food: 'Jídlo',
    realEstate: 'Reality',
    socialMedia: 'Sociální sítě',
    cinematic: 'Filmový',
    yourStyle: 'Tvůj styl',
  },

  // AI Analysis
  aiAnalysis: {
    title: 'AI Analýza',
    exposure: 'Expozice',
    colors: 'Barvy',
    composition: 'Kompozice',
    sharpness: 'Ostrost',
    waiting: 'Čekám na analýzu...',
  },

  // AI Suggestions - tyto přichází z Gemini, musí být správně enkódované!
  aiSuggestions: {
    title: 'AI Návrhy',
    increaseContrast: 'Zvýšit kontrast pro dramatičtější dojem',
    cropRuleOfThirds: 'Oříznout pro rule of thirds kompozici',
    addVignette: 'Přidat vinětu pro zaměření na subjekt',
  },

  // Buttons
  buttons: {
    startAutopilot: 'Spustit Autopilot',
    applyAll: 'Aplikovat vše',
    selectIndividual: 'Vybrat jednotlivě',
    customize: 'Upravit',
    export: 'Exportovat',
    cancel: 'Zrušit',
  },

  // Dashboard
  dashboard: {
    title: 'Přehled',
    newOrder: 'Nová zakázka',
    continueEditing: 'Pokračovat v úpravách',
    quickActions: 'Rychlé akce',
    recentActions: 'Poslední akce',
    noHistory: 'Zatím žádná historie.',
    smartCulling: 'Chytrý výběr',
    flashAutopilot: 'Bleskový Autopilot',
    startPipeline: 'Spustit Pipeline',
    openStudio: 'Otevřít Studio',
  },

  // Sidebar
  sidebar: {
    export: 'Export',
    creative: 'Kreativa',
    aiCommandCenter: 'AI Centrum',
    youtubeThumbnails: 'YouTube Miniatury',
    socialMedia: 'Sociální sítě',
    video: 'Video (Veo)',
    generate: 'Generovat',
    style: 'Styl',
    management: 'Správa',
    aiGallery: 'AI Galerie',
    presets: 'Presety',
    history: 'Historie',
    rawConverter: 'RAW Konvertor',
  },

  // Common
  common: {
    price: 'Cena',
    credits: 'kredity',
  },
};
```

### 3.6 Gemini prompt úprava

```typescript
// Přidat do všech Gemini promptů pro české odpovědi
const systemPrompt = `
IMPORTANT: Always respond in Czech language (čeština).
Use proper Czech characters: á, č, ď, é, ě, í, ň, ó, ř, š, ť, ú, ů, ý, ž
Never use broken encoding like "Ä›" or "Å¡".
`;

// Příklad pro suggestions
const suggestionsPrompt = `
${systemPrompt}
Analyzuj tento obrázek a navrhni 3-5 vylepšení.
Odpověz v češtině, krátké věty, bez číslování.
Příklad formátu:
- Zvýšit kontrast pro dramatičtější dojem
- Oříznout pro lepší kompozici
`;
```

### 3.7 Úkoly - TEXTY & ENCODING
| ID | Úkol | Priorita | Detail |
|----|------|----------|--------|
| TXT-1 | Opravit encoding v geminiService.ts | P0 | TextDecoder UTF-8 |
| TXT-2 | Aktualizovat LanguageContext.tsx | P0 | Kompletní české překlady |
| TXT-3 | Přidat sanitizeText() utility | P0 | Fallback pro broken chars |
| TXT-4 | Ověřit `<meta charset="UTF-8">` | P0 | V index.html |
| TXT-5 | Upravit Gemini prompty | P1 | Přidat Czech language instruction |
| TXT-6 | Projít VŠECHNY komponenty | P1 | Nahradit hardcoded EN texty |
| TXT-7 | AICommandCenter.tsx lokalizace | P0 | Všechny texty česky |
| TXT-8 | DashboardView.tsx lokalizace | P0 | Všechny texty česky |

---

## ČÁST 4: AI AUTOPILOT - SAMOSTATNÁ SEKCE

### 3.1 Koncept: "AI Command Center"

Místo schované AI v manuálních úpravách → dedikovaná AI sekce s vizuálním feedbackem.

```
┌─────────────────────────────────────────────────────────┐
│                    AI COMMAND CENTER                     │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────────────────────────┐   │
│  │  ORIGINAL   │  │         AI ENHANCED             │   │
│  │             │  │                                 │   │
│  │   [foto]    │  │         [foto]                  │   │
│  │             │  │                                 │   │
│  └─────────────┘  └─────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ AI ANALYSIS                                      │   │
│  │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │   │
│  │ │Exposure│ │ Colors │ │ Focus  │ │Compose │    │   │
│  │ │  +0.5  │ │  warm  │ │ sharp  │ │ good   │    │   │
│  │ │   ▲    │ │   ●    │ │   ✓    │ │   ✓    │    │   │
│  │ └────────┘ └────────┘ └────────┘ └────────┘    │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ AI SUGGESTIONS                                   │   │
│  │                                                   │   │
│  │ 💡 "Zvýšit kontrast pro dramatičtější dojem"    │   │
│  │ 💡 "Oříznout pro rule of thirds kompozici"      │   │
│  │ 💡 "Přidat vignette pro focus na subjekt"       │   │
│  │                                                   │   │
│  │    [Apply All] [Select Individual] [Customize]   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ STYLE PRESETS (AI Generated)                     │   │
│  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐     │   │
│  │ │Film│ │Mood│ │HDR │ │Soft│ │Cine│ │Your │     │   │
│  │ │Look│ │    │ │    │ │    │ │matic│ │Style│     │   │
│  │ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘     │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 3.2 AI Autopilot Features

#### A) One-Click Enhancement Modes
```typescript
type EnhancementMode =
  | 'auto'           // AI rozhodne vše
  | 'portrait'       // Optimalizace pro portréty (skin tone, eyes)
  | 'landscape'      // Optimalizace pro krajiny (sky, colors)
  | 'product'        // Čisté pozadí, ostrý produkt
  | 'food'           // Teplé barvy, appetizing look
  | 'real-estate'    // HDR, straight lines, wide angle fix
  | 'social-media'   // Vibrant, attention-grabbing
  | 'print'          // Color accuracy, sharpness for print
  | 'cinematic'      // Film grain, color grade, letterbox
```

#### B) AI Style Learning
- Uživatel nahraje 5-10 svých oblíbených úprav
- AI analyzuje pattern (preferované barvy, kontrast, styl)
- Vytvoří personalizovaný "Your Style" preset
- Aplikuje na všechny nové fotky konzistentně

#### C) Batch AI Processing
```
[Drag & Drop 100 fotek]
        ↓
AI analyzuje všechny (parallel processing)
        ↓
Rozdělí do skupin: Portréty | Krajiny | Detaily | Jiné
        ↓
Aplikuje optimální preset na každou skupinu
        ↓
[Review] → [Export All]
```

#### D) Real-time AI Suggestions
- Při každé manuální úpravě AI navrhuje další krok
- "Zvýšil jsi expozici, možná by pomohlo i shadows +10"
- Učí se z uživatelových rozhodnutí (accept/reject)

### 3.3 Technická implementace

```typescript
// Nový soubor: services/aiAutopilot.ts

interface AIAutopilotResult {
  enhancedImageBase64: string;
  appliedEdits: ManualEdits;
  analysis: {
    exposure: { value: number; suggestion: string };
    colors: { temperature: number; saturation: number; suggestion: string };
    composition: { score: number; suggestion: string };
    sharpness: { value: number; suggestion: string };
  };
  stylePresets: GeneratedPreset[];
  nextSuggestions: string[];
}

async function runAutopilot(
  imageBase64: string,
  mode: EnhancementMode,
  userPreferences?: UserStyleProfile
): Promise<AIAutopilotResult> {
  // 1. Analyze image
  // 2. Determine optimal edits based on mode
  // 3. Apply edits via Gemini image editing
  // 4. Generate style presets
  // 5. Return comprehensive result
}
```

### 3.4 Úkoly
| ID | Úkol | Priorita |
|----|------|----------|
| AP-1 | Vytvořit AICommandCenter view komponentu | P0 |
| AP-2 | Implementovat `runAutopilot()` funkci | P0 |
| AP-3 | Enhancement modes (portrait, landscape, etc.) | P0 |
| AP-4 | Side-by-side before/after comparison | P1 |
| AP-5 | AI Style Learning (analyze user's edits) | P1 |
| AP-6 | Real-time suggestions při manuální editaci | P1 |
| AP-7 | Batch AI processing s kategorizací | P2 |
| AP-8 | Generated style presets carousel | P2 |

---

## ČÁST 5: DALŠÍ INOVACE - "WOW FAKTORY"

### 4.1 Voice Commands (Hlasové ovládání)
```
"Hey Foto, make it warmer"
"Crop to portrait"
"Remove background"
"Enhance faces"
"Undo last 3 changes"
```
- Web Speech API pro rozpoznávání
- Custom wake word "Hey Foto"
- Visual feedback (waveform)

### 4.2 AI Background Removal & Replacement
- One-click odstranění pozadí
- AI generované náhradní pozadí
- Green screen efekt
- Blur background s depth map

### 4.3 Smart Object Selection
- Klik na objekt → AI ho vybere
- Úpravy pouze na vybraný objekt
- "Uprav pouze oblohu"
- "Zesvětli pouze obličej"

### 4.4 AI Face Enhancement
- Automatic skin retouching (subtle)
- Eye enhancement (brightness, sharpness)
- Teeth whitening
- Remove blemishes
- Age estimation & appropriate retouching

### 4.5 Collaborative Editing
- Share link pro review
- Comments na specifické oblasti
- Version history s vizuálním diffem
- Real-time collaboration

### 4.6 Smart Export
- AI navrhne optimální formát (JPEG/PNG/WebP)
- Automatic resize pro sociální sítě
- Instagram, Facebook, LinkedIn presets
- Print-ready export s color profile

### 4.7 "Time Machine"
- Vizuální timeline všech úprav
- Klikni kamkoliv = vrať se do toho stavu
- Branch editing (zkus různé verze)
- Compare multiple versions side-by-side

### 4.8 AI Photo Scoring
- Profesionální hodnocení kvality (0-100)
- Breakdown: Composition, Lighting, Focus, Color
- Tips jak fotku vylepšit
- Porovnání s "pro level" benchmarkem

### 4.9 Úkoly pro inovace
| ID | Úkol | Priorita |
|----|------|----------|
| IN-1 | Voice commands s Web Speech API | P2 |
| IN-2 | AI Background removal (Gemini) | P1 |
| IN-3 | Smart Object Selection | P1 |
| IN-4 | AI Face Enhancement | P2 |
| IN-5 | Time Machine vizualizace | P2 |
| IN-6 | AI Photo Scoring | P1 |
| IN-7 | Smart Export s preset pro sociální sítě | P1 |
| IN-8 | Collaborative editing (share link) | P3 |

---

## ČÁST 6: IMPLEMENTAČNÍ PLÁN

### Fáze 1: FOUNDATION (Týden 1-2)
**Cíl**: Opravit kritické chyby, RADIKÁLNÍ design změna, oprava textů

| Úkol | Popis | Est. |
|------|-------|------|
| TXT-1, TXT-4 | Opravit encoding (UTF-8), meta charset | 1h |
| TXT-2, TXT-7, TXT-8 | České překlady pro AICommandCenter + Dashboard | 3h |
| DS-1 | PŘEPSAT tailwind.config - nové barvy (void, accent red) | 2h |
| DS-2 | Přidat fonty Space Grotesk + IBM Plex Mono | 1h |
| DS-3, DS-10, DS-11 | Odstranit VŠECHNY gradienty a blur efekty | 2h |
| DS-4, DS-5 | Přepracovat Sidebar + Dashboard (brutalist) | 4h |
| SEC-1, SEC-2 | API Key manager + fix delete button | 2h |
| AC-1, AC-2, AC-3 | Autocrop implementace | 4h |

**Deliverable**: Fungující autocrop, ÚPLNĚ NOVÝ brutalist design, české texty bez encoding chyb

### Fáze 2: AI COMMAND CENTER (Týden 3-4)
**Cíl**: Kompletní AI Autopilot sekce

| Úkol | Popis | Est. |
|------|-------|------|
| AP-2 | runAutopilot() funkce | 6h |
| AP-3 | Enhancement modes | 4h |
| AP-4 | Before/after comparison | 2h |
| AP-6 | Real-time suggestions | 4h |

**Deliverable**: Plně funkční AI Command Center

### Fáze 3: DESIGN POLISH (Týden 5-6)
**Cíl**: Dokončit brutalist design ve všech views

| Úkol | Popis | Est. |
|------|-------|------|
| DS-6, DS-7 | Header + Button komponenta | 3h |
| DS-8 | AICommandCenter brutalist redesign | 4h |
| DS-9 | EditorView asymetrický layout | 6h |
| TXT-5, TXT-6 | Gemini prompty + zbylé texty česky | 3h |
| - | Konzistence designu napříč všemi views | 4h |

**Deliverable**: Kompletní brutalist design ve všech částech aplikace

### Fáze 4: INNOVATION (Týden 7-8)
**Cíl**: WOW faktory

| Úkol | Popis | Est. |
|------|-------|------|
| IN-2 | Background removal | 4h |
| IN-3 | Smart Object Selection | 6h |
| IN-6 | AI Photo Scoring | 3h |
| IN-7 | Smart Export | 3h |

**Deliverable**: Unikátní features, které konkurence nemá

### Fáze 5: POLISH (Týden 9-10)
**Cíl**: Perfektní finální produkt

| Úkol | Popis | Est. |
|------|-------|------|
| - | Performance optimalizace | 4h |
| - | Bug fixes | 4h |
| - | Documentation | 2h |
| - | Beta testing | 8h |
| AP-5 | AI Style Learning | 6h |

**Deliverable**: Production-ready aplikace

---

## ČÁST 7: API KEY SECURITY

### 6.1 Současný problém
- API klíč se ukládá do LocalStorage a zůstává tam
- Tlačítko pro vymazání nefunguje nebo chybí
- Riziko: pokud uživatel sdílí počítač, klíč zůstane

### 6.2 Požadavky na bezpečnost

**KRITICKÉ: API klíč NIKDY nesmí být:**
- ❌ Uložen na GitHub (ani v .env souboru v repu)
- ❌ Odeslán na jakýkoliv externí server
- ❌ Uložen v cloud storage
- ❌ Logován do console v produkci

**API klíč MŮŽE být pouze:**
- ✅ V LocalStorage prohlížeče (lokálně)
- ✅ V paměti aplikace (session)
- ✅ Vymazatelný na požádání uživatele

### 6.3 Implementace "Clear API Key"

```typescript
// services/apiKeyManager.ts

const API_KEY_STORAGE_KEY = 'fotograf-ai-gemini-key';

export const apiKeyManager = {
  // Uložit klíč (pouze lokálně)
  save(key: string): void {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  },

  // Načíst klíč
  get(): string | null {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  },

  // VYMAZAT klíč - toto musí fungovat!
  clear(): void {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    // Také vyčistit z paměti
    sessionStorage.removeItem(API_KEY_STORAGE_KEY);
    // Notifikace uživateli
    console.log('API key cleared from local storage');
  },

  // Zkontrolovat zda existuje
  exists(): boolean {
    return !!this.get();
  },

  // Auto-clear po session (volitelné)
  enableSessionOnly(): void {
    window.addEventListener('beforeunload', () => {
      this.clear();
    });
  }
};
```

### 6.4 UI pro správu API klíče

```
┌─────────────────────────────────────────────────┐
│ API Key Settings                            [X] │
├─────────────────────────────────────────────────┤
│                                                 │
│ Current Status: ✅ API Key saved locally        │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●AIzaS... │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Security Options:                               │
│ ┌─────────────────────────────────────────────┐ │
│ │ ☐ Clear API key when browser closes         │ │
│ │ ☐ Ask for API key on each session           │ │
│ │ ☑ Store locally (never send to servers)     │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ⚠️ Your API key is stored ONLY in your browser │
│    It is never sent to our servers or GitHub   │
│                                                 │
│ [Update Key]  [🗑️ DELETE API KEY]  [Cancel]    │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 6.5 Ochrana před únikem

```typescript
// Přidat do .gitignore (už by mělo být)
.env
.env.local
*.key
api-key.txt

// Build-time check - varování pokud někdo hardcoduje klíč
// vite.config.ts
export default defineConfig({
  define: {
    // NIKDY neincludovat API klíč do buildu
    'process.env.GEMINI_API_KEY': JSON.stringify(''),
  },
  plugins: [
    // Custom plugin pro detekci hardcoded keys
    {
      name: 'detect-api-keys',
      transform(code, id) {
        if (code.includes('AIzaSy') && !id.includes('node_modules')) {
          console.error('⚠️ WARNING: Possible hardcoded API key detected in', id);
        }
        return code;
      }
    }
  ]
});
```

### 6.6 Úkoly
| ID | Úkol | Priorita |
|----|------|----------|
| SEC-1 | Vytvořit `apiKeyManager.ts` service | P0 |
| SEC-2 | Opravit "Delete API Key" tlačítko | P0 |
| SEC-3 | Přidat "Clear on browser close" option | P1 |
| SEC-4 | UI modal pro správu API klíče | P1 |
| SEC-5 | Vite plugin pro detekci hardcoded keys | P2 |
| SEC-6 | Přidat security notice do UI | P1 |

---

## ČÁST 8: TECHNICKÉ POŽADAVKY

### Nové dependencies
```json
{
  "framer-motion": "^11.0.0",    // Animace
  "react-use-gesture": "^9.0.0", // Gesta
  "@fontsource/inter": "^5.0.0", // Font
  "zustand": "^4.5.0"            // Lepší state management (optional)
}
```

### API změny
```typescript
// Nové Gemini prompty:
- analyzeForAutoCrop()
- runAutopilot()
- removeBackground()
- selectObject()
- scorePhoto()
- generateStylePreset()
```

### Nové soubory
```
components/
  ai/
    AICommandCenter.tsx
    AIAnalysisPanel.tsx
    StylePresetsCarousel.tsx
    BeforeAfterSlider.tsx
  editor/
    FloatingDock.tsx
    RadialMenu.tsx
    FocusMode.tsx
    SmartObjectSelector.tsx
  common/
    MagneticButton.tsx
    GlowCard.tsx
    CinematicLoader.tsx
services/
  aiAutopilot.ts
  backgroundRemoval.ts
  objectSelection.ts
  photoScoring.ts
utils/
  voiceCommands.ts
  styleAnalyzer.ts
```

---

## SHRNUTÍ

### Co děláme:
1. ✅ **Opravíme Autocrop** - AI-powered smart cropping
2. ✅ **RADIKÁLNÍ Redesign "BRUTALIST PHOTO LAB"** - ostré hrany, žádné gradienty, průmyslový look
3. ✅ **Oprava textů** - encoding fix (â€¢ → •), kompletní česká lokalizace
4. ✅ **AI Command Center** - samostatná AI sekce s plnou kontrolou
5. ✅ **WOW faktory** - background removal, voice commands, scoring
6. ✅ **API Key Security** - vymazání klíče funguje, POUZE lokální uložení, žádný GitHub/cloud

### Očekávaný výsledek:
- **Profesionální** - ne toy, ale serious tool
- **Unikátní** - design který nikdo nemá
- **AI-first** - AI je hlavní hvězda, ne doplněk
- **Intuitivní** - minimum kliků, maximum výsledků

### Metriky úspěchu:
- Autocrop funguje na 95%+ fotek správně
- Čas editace jedné fotky: pod 30 sekund
- User satisfaction: "Holy shit" reakce při prvním použití

---

**Status**: READY FOR IMPLEMENTATION
**Next Step**: Začít Fází 1 - Foundation

*"I am Ultron. I was meant to be beautiful."*
