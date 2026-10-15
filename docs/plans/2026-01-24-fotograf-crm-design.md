# Fotograf AI + CRM - Design Document

> Historický návrh. Aktuální ukládání projektů a fotografií popisuje [dokumentace Studia](../README.md).

**Autor:** Lukáš Drštička
**Datum:** 2026-01-24
**Repo:** https://github.com/Lukedaca/Fotograf-AI
**Status:** Ready for implementation

---

## Vize

Rozšířit Fotograf AI o CRM funkce pro kompletní workflow fotografa:
- **AI-first přístup** - automatické zpracování, úspora času
- **Jednoduchost** - opinionated workflow, minimum nastavení
- **Override možnost** - AI navrhne, fotograf může doladit ručně

**USP:** "Velcí hráči mají milion tlačítek. My prostě fungujeme."

---

## Workflow

```
Nová zakázka → Upload fotek → AI Culling → AI Edit →
→ Manuální doladění (volitelné) → Publikovat galerii klientovi
```

---

## Nové Views

Přidat k existujícím (`home`, `dashboard`, `upload`, `editor`, `batch`, `generate`, `raw-converter`):

| View | Účel | Route |
|------|------|-------|
| `projects` | Seznam všech zakázek | `/projects` |
| `project-detail` | Detail jedné zakázky | `/projects/:id` |
| `clients` | Seznam klientů | `/clients` |
| `client-detail` | Detail klienta + jeho projekty | `/clients/:id` |
| `gallery-preview` | Náhled galerie pro klienta | `/gallery/:id` |

---

## Datový model

### Přidat do `types.ts`:

```typescript
// Project status
export type ProjectStatus = 'draft' | 'editing' | 'review' | 'delivered';

// Client
export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  createdAt: string;
}

// Project (zakázka)
export interface Project {
  id: string;
  name: string;
  clientId: string;
  type: JobTemplate;  // existující typ: 'portrait' | 'event' | 'product' | 'social'
  status: ProjectStatus;
  date: string;
  notes?: string;
  files: UploadedFile[];  // existující typ
  gallery: GallerySettings;
  activity: ActivityEvent[];
  createdAt: string;
  updatedAt: string;
}

// Gallery settings
export interface GallerySettings {
  published: boolean;
  link?: string;
  selectedFileIds: string[];  // které fotky jsou v galerii
  allowDownload: boolean;
  expiresAt?: string;
}

// Activity tracking
export interface ActivityEvent {
  id: string;
  type: 'created' | 'uploaded' | 'edited' | 'published' | 'viewed' | 'downloaded';
  timestamp: string;
  description: string;
}
```

### Update View type:

```typescript
export type View =
  | 'home' | 'dashboard' | 'upload' | 'editor' | 'batch' | 'generate' | 'raw-converter'
  | 'projects' | 'project-detail' | 'clients' | 'client-detail' | 'gallery-preview';
```

---

## Nové komponenty

### Views (hlavní obrazovky)

| Soubor | Popis |
|--------|-------|
| `components/ProjectsView.tsx` | Seznam projektů s filtrováním podle statusu |
| `components/ProjectDetailView.tsx` | Detail projektu se záložkami |
| `components/ClientsView.tsx` | Seznam klientů |
| `components/ClientDetailView.tsx` | Detail klienta |
| `components/GalleryPreviewView.tsx` | Veřejná galerie pro klienta |

### UI komponenty

| Soubor | Popis |
|--------|-------|
| `components/ProjectCard.tsx` | Karta projektu - náhled fotky, název, klient, status |
| `components/ClientCard.tsx` | Karta klienta - jméno, email, počet projektů |
| `components/ProjectModal.tsx` | Modal pro vytvoření/editaci projektu |
| `components/ClientModal.tsx` | Modal pro vytvoření/editaci klienta |
| `components/StatusBadge.tsx` | Barevný badge statusu |
| `components/GallerySettingsPanel.tsx` | Panel nastavení galerie |
| `components/ActivityTimeline.tsx` | Timeline událostí projektu |
| `components/ClientSelector.tsx` | Dropdown pro výběr/vytvoření klienta |

---

## Sidebar navigace

Rozšířit `Sidebar.tsx`:

```
Dashboard
─────────────────
Projekty        ← NOVÉ
Klienti         ← NOVÉ
─────────────────
Upload
Editor
Batch
Generovat
RAW Converter
```

---

## Project Detail - záložky

```
[Info] [Fotky] [Galerie] [Aktivita]
```

- **Info** - název, klient, typ, datum, poznámky, status dropdown
- **Fotky** - grid fotek, klik otevře v editoru, bulk select
- **Galerie** - výběr fotek, toggle published, kopírovat link
- **Aktivita** - timeline událostí

---

## User Flows

### Flow 1: Nový projekt

1. `ProjectsView` → klik "Nový projekt"
2. Otevře se `ProjectModal`:
   - Název projektu (text input)
   - Klient (ClientSelector - dropdown s možností "+ Nový klient")
   - Typ (portrait/event/product/social - radio buttons)
   - Datum (date picker)
3. Submit → vytvoří projekt, redirect na `UploadView` s `projectId` v kontextu

### Flow 2: Upload v kontextu projektu

1. `UploadView` detekuje `projectId` z kontextu
2. Po uploadu fotek se automaticky přiřadí k projektu
3. Zobrazí se tlačítko "Spustit AI zpracování"
4. Po AI zpracování → redirect na `ProjectDetailView`

### Flow 3: Publikování galerie

1. `ProjectDetailView` → záložka "Galerie"
2. Checkbox výběr fotek (nebo "Vybrat všechny")
3. Toggle "Povolit stahování"
4. Klik "Publikovat" → vygeneruje unikátní link
5. Zobrazí link s tlačítky "Kopírovat" / "Náhled"

### Flow 4: Klient prohlíží galerii

1. Klient otevře link
2. `GalleryPreviewView` - čistý, minimalistický design
3. Grid fotek, lightbox na klik
4. Pokud povoleno - tlačítko "Stáhnout vše"
5. Žádná navigace app, jen galerie

---

## Mock Data

### `services/mockData.ts`

```typescript
import { Client, Project, ProjectStatus, ActivityEvent } from '../types';

export const mockClients: Client[] = [
  {
    id: 'c1',
    name: 'Jan Novák',
    email: 'novak@email.cz',
    phone: '+420 777 123 456',
    createdAt: '2026-01-10T10:00:00Z',
  },
  {
    id: 'c2',
    name: 'Firma ABC s.r.o.',
    email: 'marketing@abc.cz',
    notes: 'Preferují produktové fotky na bílém pozadí',
    createdAt: '2026-01-05T14:30:00Z',
  },
  {
    id: 'c3',
    name: 'Marie Svobodová',
    email: 'marie.s@gmail.com',
    phone: '+420 608 555 333',
    createdAt: '2025-12-20T09:15:00Z',
  },
];

export const mockProjects: Project[] = [
  {
    id: 'p1',
    name: 'Svatba Novákovi',
    clientId: 'c1',
    type: 'event',
    status: 'delivered',
    date: '2026-01-15',
    files: [], // v prototypu prázdné nebo mock UploadedFile[]
    gallery: {
      published: true,
      link: 'https://foto.app/g/abc123',
      selectedFileIds: [],
      allowDownload: true,
    },
    activity: [
      { id: 'a1', type: 'created', timestamp: '2026-01-10T10:00:00Z', description: 'Projekt vytvořen' },
      { id: 'a2', type: 'uploaded', timestamp: '2026-01-16T14:00:00Z', description: 'Nahráno 342 fotek' },
      { id: 'a3', type: 'edited', timestamp: '2026-01-16T15:30:00Z', description: 'AI zpracování dokončeno' },
      { id: 'a4', type: 'published', timestamp: '2026-01-17T10:00:00Z', description: 'Galerie publikována' },
    ],
    createdAt: '2026-01-10T10:00:00Z',
    updatedAt: '2026-01-17T10:00:00Z',
  },
  {
    id: 'p2',
    name: 'Produktové foto Q1',
    clientId: 'c2',
    type: 'product',
    status: 'editing',
    date: '2026-01-20',
    files: [],
    gallery: { published: false, selectedFileIds: [], allowDownload: false },
    activity: [
      { id: 'a5', type: 'created', timestamp: '2026-01-18T09:00:00Z', description: 'Projekt vytvořen' },
      { id: 'a6', type: 'uploaded', timestamp: '2026-01-20T11:00:00Z', description: 'Nahráno 48 fotek' },
    ],
    createdAt: '2026-01-18T09:00:00Z',
    updatedAt: '2026-01-20T11:00:00Z',
  },
  {
    id: 'p3',
    name: 'Rodinné focení',
    clientId: 'c3',
    type: 'portrait',
    status: 'draft',
    date: '2026-01-28',
    files: [],
    gallery: { published: false, selectedFileIds: [], allowDownload: true },
    activity: [
      { id: 'a7', type: 'created', timestamp: '2026-01-22T16:00:00Z', description: 'Projekt vytvořen' },
    ],
    createdAt: '2026-01-22T16:00:00Z',
    updatedAt: '2026-01-22T16:00:00Z',
  },
];

// Helper functions
export function getClientById(id: string): Client | undefined {
  return mockClients.find(c => c.id === id);
}

export function getProjectsByClientId(clientId: string): Project[] {
  return mockProjects.filter(p => p.clientId === clientId);
}

export function getProjectById(id: string): Project | undefined {
  return mockProjects.find(p => p.id === id);
}
```

---

## UI Design

### Styl
- Zachovat existující **"Pure Vision"** design
- Tmavé téma (`bg-slate-950`, `bg-slate-900`)
- Glassmorphism efekty (`bg-white/5`, `backdrop-blur`)
- Cyan akcenty (`text-cyan-400`, `border-cyan-500`)
- Zaoblené rohy (`rounded-xl`, `rounded-2xl`)

### Status Badge barvy

```typescript
const statusColors: Record<ProjectStatus, string> = {
  draft: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  editing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  review: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  delivered: 'bg-green-500/20 text-green-400 border-green-500/30',
};
```

### Status labels (CZ)

```typescript
const statusLabels: Record<ProjectStatus, string> = {
  draft: 'Nový',
  editing: 'Úpravy',
  review: 'Ke schválení',
  delivered: 'Dokončeno',
};
```

---

## Integrace s existujícím kódem

### App.tsx změny

1. Přidat nové views do `renderView()` switch
2. Přidat state pro `currentProjectId`
3. Upravit `handleFilesSelected` - pokud je aktivní projekt, přiřadit fotky k němu
4. Přidat `handleProjectSelect` pro navigaci s kontextem

### Context (volitelné)

Vytvořit `ProjectContext` pro sdílení aktuálního projektu:

```typescript
// contexts/ProjectContext.tsx
interface ProjectContextType {
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;
  clients: Client[];
  projects: Project[];
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  addClient: (client: Omit<Client, 'id' | 'createdAt'>) => void;
}
```

---

## Soubory k vytvoření

```
components/
├── ProjectsView.tsx
├── ProjectDetailView.tsx
├── ClientsView.tsx
├── ClientDetailView.tsx
├── GalleryPreviewView.tsx
├── ProjectCard.tsx
├── ClientCard.tsx
├── ProjectModal.tsx
├── ClientModal.tsx
├── StatusBadge.tsx
├── GallerySettingsPanel.tsx
├── ActivityTimeline.tsx
└── ClientSelector.tsx

contexts/
└── ProjectContext.tsx

services/
└── mockData.ts
```

---

## Soubory k upravit

- `types.ts` - přidat nové typy
- `App.tsx` - přidat views, routing, context
- `components/Sidebar.tsx` - přidat navigaci na Projekty a Klienty

---

## Poznámky pro implementaci

1. **Mock data first** - žádný backend, vše v paměti/localStorage
2. **Zachovat funkčnost** - existující editor, upload atd. musí fungovat
3. **Propojení** - z editoru možnost přiřadit fotky k projektu
4. **Responzivní** - mobile-first, sidebar collapse na mobilu
5. **Čeština** - UI texty v češtině, využít existující `useTranslation`

---

## Budoucí rozšíření (mimo scope prototypu)

- [ ] Fakturace
- [ ] Email notifikace klientům
- [ ] Smlouvy a podpisy
- [ ] Booking kalendář
- [ ] Statistiky a reporty
- [ ] Multi-user (tým)
- [ ] Backend + databáze
- [ ] Platební brána
