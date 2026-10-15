# Fotograf AI - Bugfix Implementation Plan

> Historical implementation plan. See [current Studio documentation](../README.md) for release behavior and verification.

**Autor:** Lukáš Drštička + Claude Code Review
**Datum:** 2026-01-24
**Status:** Ready for implementation
**Priority:** CRITICAL - aplikace má bezpečnostní díry a crashuje

---

## PŘEHLED

Tento dokument obsahuje detailní plán oprav pro Fotograf AI. Bugy jsou seřazeny podle priority.

**Celkem:** 10 bugů + 3 architektonické problémy
**Odhadovaný čas:** 4-6 hodin

---

## FÁZE 1: KRITICKÉ SECURITY (15 min)

### BUG #10: Admin Bypass Security Hole

**Soubor:** `services/userProfileService.ts`
**Řádky:** 33-47
**Severity:** 🔴 CRITICAL SECURITY

**Aktuální kód (SMAZAT):**
```typescript
if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('role') === 'admin') {
        profile.isAdmin = true;
        saveUserProfile(profile);
    }
}
```

**Oprava:** Kompletně odstranit tento blok kódu. Admin mód by měl být pouze přes environment variable nebo hardcoded pro development.

**Nový kód:**
```typescript
// Admin mode only via environment variable (build time)
// NEVER allow URL parameter admin access
if (import.meta.env.DEV && import.meta.env.VITE_ADMIN_MODE === 'true') {
    profile.isAdmin = true;
}
```

**Test:** Ověřit že `?role=admin` už nefunguje.

---

## FÁZE 2: AI FUNKCE CRASHY (45 min)

### BUG #1: JSON Parse Crash

**Soubor:** `services/geminiService.ts`
**Řádky:** 90, 134
**Severity:** 🔴 CRITICAL

**Problém:** `JSON.parse(response.text)` bez try-catch crashne aplikaci při malformed response.

**Aktuální kód:**
```typescript
return JSON.parse(response.text) as AnalysisResult;
```

**Oprava - vytvořit helper funkci:**
```typescript
// Přidat na začátek souboru (po importech)
function safeJsonParse<T>(text: string | undefined, fallbackError: string): T {
    if (!text) {
        throw new Error(`${fallbackError}: Empty response from AI`);
    }
    
    try {
        // Někdy AI vrátí markdown code block
        let cleanText = text.trim();
        if (cleanText.startsWith('```json')) {
            cleanText = cleanText.slice(7);
        }
        if (cleanText.startsWith('```')) {
            cleanText = cleanText.slice(3);
        }
        if (cleanText.endsWith('```')) {
            cleanText = cleanText.slice(0, -3);
        }
        cleanText = cleanText.trim();
        
        return JSON.parse(cleanText) as T;
    } catch (e) {
        console.error('Failed to parse AI response:', text);
        throw new Error(`${fallbackError}: Invalid JSON from AI`);
    }
}
```

**Nahradit všechny JSON.parse volání:**

```typescript
// Řádek ~90 (analyzeImage funkce)
// BYLO:
return JSON.parse(response.text) as AnalysisResult;
// NOVĚ:
return safeJsonParse<AnalysisResult>(response.text, 'Image analysis failed');

// Řádek ~134 (assessQuality funkce)
// BYLO:
return JSON.parse(response.text) as QualityAssessment;
// NOVĚ:
return safeJsonParse<QualityAssessment>(response.text, 'Quality assessment failed');
```

---

### BUG #7: Vague Error Messages

**Soubor:** `services/geminiService.ts`
**Řádky:** 58-60, 105-106, 116-117
**Severity:** 🟡 MEDIUM

**Aktuální kód:**
```typescript
const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
if (!imagePart || !imagePart.inlineData) throw new Error('Autopilot failed.');
```

**Oprava - detailní error messages:**
```typescript
// Nahradit generic error handling za specifické
if (!response) {
    throw new Error('AI service unavailable - no response received');
}

if (!response.candidates || response.candidates.length === 0) {
    // Check for blocked content
    if (response.promptFeedback?.blockReason) {
        throw new Error(`AI blocked request: ${response.promptFeedback.blockReason}`);
    }
    throw new Error('AI returned no results - may be rate limited or model unavailable');
}

const candidate = response.candidates[0];
if (!candidate.content || !candidate.content.parts) {
    throw new Error('AI response has no content - unexpected format');
}

const imagePart = candidate.content.parts.find(part => part.inlineData);
if (!imagePart) {
    throw new Error('AI did not generate image data - try again or use different settings');
}

if (!imagePart.inlineData || !imagePart.inlineData.data) {
    throw new Error('AI image data is empty - generation may have failed');
}
```

---

### NOVÝ: API Retry Logic

**Soubor:** `services/geminiService.ts`
**Přidat na začátek souboru:**

```typescript
// Retry wrapper for API calls
async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            
            // Don't retry on certain errors
            const errorMessage = lastError.message.toLowerCase();
            if (
                errorMessage.includes('invalid api key') ||
                errorMessage.includes('blocked') ||
                errorMessage.includes('invalid json')
            ) {
                throw lastError;
            }
            
            // Exponential backoff
            if (attempt < maxRetries - 1) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                console.log(`AI request failed, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError || new Error('AI request failed after retries');
}
```

**Použití v funkcích:**
```typescript
// Obalit API volání
export async function runAutopilot(file: File): Promise<File> {
    return withRetry(async () => {
        // ... existující kód ...
    });
}
```

---

## FÁZE 3: MEMORY LEAKS (30 min)

### BUG #3: URL.createObjectURL Memory Leak

**Soubor:** `components/EditorView.tsx`
**Řádky:** 116, 133, 145, 165
**Severity:** 🔴 CRITICAL

**Problém:** Každý `URL.createObjectURL()` alokuje paměť která se nikdy neuvolní.

**Oprava - přidat cleanup:**

```typescript
// 1. Přidat ref pro tracking URLs
const createdUrlsRef = useRef<string[]>([]);

// 2. Helper pro vytváření URL s trackingem
const createTrackedUrl = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    createdUrlsRef.current.push(url);
    return url;
}, []);

// 3. Cleanup při unmount
useEffect(() => {
    return () => {
        createdUrlsRef.current.forEach(url => {
            URL.revokeObjectURL(url);
        });
        createdUrlsRef.current = [];
    };
}, []);

// 4. Cleanup při změně editedPreviewUrl
useEffect(() => {
    return () => {
        if (editedPreviewUrl && editedPreviewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(editedPreviewUrl);
        }
    };
}, [editedPreviewUrl]);
```

**5. Nahradit všechny `URL.createObjectURL()` za `createTrackedUrl()`:**
```typescript
// BYLO:
const url = URL.createObjectURL(blob);
// NOVĚ:
const url = createTrackedUrl(blob);
```

---

### Memory Leak v App.tsx

**Soubor:** `App.tsx`
**Funkce:** `handleFilesSelected`

**Přidat cleanup při odstranění souborů:**
```typescript
// Přidat helper funkci
const cleanupFileUrls = useCallback((filesToClean: UploadedFile[]) => {
    filesToClean.forEach(file => {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
        if (file.originalPreviewUrl && file.originalPreviewUrl !== file.previewUrl) {
            URL.revokeObjectURL(file.originalPreviewUrl);
        }
    });
}, []);

// Použít při mazání souborů
const handleRemoveFile = useCallback((fileId: string) => {
    const fileToRemove = files.find(f => f.id === fileId);
    if (fileToRemove) {
        cleanupFileUrls([fileToRemove]);
    }
    setFiles(current => current.filter(f => f.id !== fileId), 'Remove file');
}, [files, cleanupFileUrls, setFiles]);
```

---

## FÁZE 4: RACE CONDITIONS (60 min)

### BUG #2: Stale Reference v EditorView

**Soubor:** `components/EditorView.tsx`
**Řádky:** 111-122
**Severity:** 🔴 CRITICAL

**Problém:** `activeFile` se může změnit během async operace.

**Oprava:**
```typescript
useEffect(() => {
    if (!activeFile) return;
    
    // Capture current values
    const currentFileId = activeFile.id;
    const currentUrl = activeFile.originalPreviewUrl;
    let isCancelled = false;
    
    const apply = async () => {
        try {
            const blob = await applyEditsAndExport(
                currentUrl,  // Use captured value
                manualEdits,
                { format: 'jpeg', quality: 90, scale: 0.5 }
            );
            
            // Check if still relevant
            if (isCancelled) return;
            
            // Verify file still exists
            const stillExists = files.find(f => f.id === currentFileId);
            if (!stillExists) return;
            
            const url = createTrackedUrl(blob);
            setEditedPreviewUrl(url);
        } catch (error) {
            if (!isCancelled) {
                console.error('Preview generation failed:', error);
            }
        }
    };
    
    const timeoutId = setTimeout(apply, 150);
    
    return () => {
        isCancelled = true;
        clearTimeout(timeoutId);
    };
}, [activeFile?.id, activeFile?.originalPreviewUrl, manualEdits, files, createTrackedUrl]);
```

---

### BUG #4: Upload Race Condition

**Soubor:** `App.tsx`
**Funkce:** `handleFilesSelected`
**Severity:** 🔴 CRITICAL

**Problém:** `validFiles.push()` v async loop = race condition.

**Oprava:**
```typescript
const handleFilesSelected = useCallback(async (selectedFiles: File[]) => {
    // Process all files and collect results
    const results = await Promise.allSettled(
        selectedFiles.map(async (file): Promise<UploadedFile | null> => {
            try {
                const normalizedFile = await normalizeImageFile(file);
                const previewUrl = URL.createObjectURL(normalizedFile);
                return {
                    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    file: normalizedFile,
                    previewUrl: previewUrl,
                    originalPreviewUrl: previewUrl,
                };
            } catch (error) {
                addNotification(`${t.msg_error}: ${file.name}`, 'error');
                return null;
            }
        })
    );
    
    // Filter successful uploads
    const validFiles = results
        .filter((r): r is PromiseFulfilledResult<UploadedFile> => 
            r.status === 'fulfilled' && r.value !== null
        )
        .map(r => r.value);
    
    if (validFiles.length > 0) {
        setFiles(
            currentFiles => [...currentFiles, ...validFiles],
            `Uploaded ${validFiles.length} files`
        );
        setShowTemplateModal(true);
        addNotification(`${validFiles.length} ${t.notify_upload_success}`, 'info');
    }
}, [addNotification, setFiles, t.msg_error, t.notify_upload_success]);
```

---

### BUG #5: Credit Deduction Race

**Soubor:** `App.tsx`
**Funkce:** `handleDeductCredits`
**Severity:** 🔴 CRITICAL

**Problém:** Spam clicking = multiple deductions.

**Oprava:**
```typescript
// Přidat ref pro locking
const creditOperationInProgress = useRef(false);

const handleDeductCredits = useCallback(async (amount: number): Promise<boolean> => {
    if (isAdmin) return true;
    
    // Prevent concurrent operations
    if (creditOperationInProgress.current) {
        console.log('Credit operation already in progress');
        return false;
    }
    
    creditOperationInProgress.current = true;
    
    try {
        // Get fresh value from storage (not state)
        const currentProfile = getUserProfile();
        const currentCredits = currentProfile.credits;
        
        if (currentCredits >= amount) {
            const newTotal = updateCredits(-amount);
            setCredits(newTotal);
            return true;
        }
        
        setShowPurchaseModal(true);
        return false;
    } finally {
        creditOperationInProgress.current = false;
    }
}, [isAdmin]);
```

---

## FÁZE 5: ERROR HANDLING (45 min)

### BUG #6: Silent Batch Failures

**Soubor:** `components/BatchView.tsx`
**Řádky:** 66-75
**Severity:** 🟡 MEDIUM

**Oprava - track failures:**
```typescript
const [failedFiles, setFailedFiles] = useState<string[]>([]);

// V processing loop:
for (const file of files) {
    try {
        const assessment = await assessQuality(file.file);
        onSetFiles(prev => prev.map(f => 
            f.id === file.id ? { ...f, assessment, isAnalyzing: false } : f
        ), 'Quality assessed');
    } catch (e) {
        console.error(`Failed to assess ${file.file.name}:`, e);
        setFailedFiles(prev => [...prev, file.file.name]);
        onSetFiles(prev => prev.map(f => 
            f.id === file.id ? { ...f, isAnalyzing: false } : f
        ), 'Assessment failed');
    }
}

// Po loop ukázat souhrn:
if (failedFiles.length > 0) {
    addNotification(
        `${failedFiles.length} files failed: ${failedFiles.slice(0, 3).join(', ')}${failedFiles.length > 3 ? '...' : ''}`,
        'error'
    );
}
```

---

### BUG #8: localStorage Schema Validation

**Soubor:** `contexts/ProjectContext.tsx`
**Řádky:** 16-26
**Severity:** 🟡 MEDIUM

**Oprava:**
```typescript
// Validation helper
function isValidStoredData(data: unknown): data is StoredData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    
    if (!Array.isArray(obj.clients)) return false;
    if (!Array.isArray(obj.projects)) return false;
    
    // Basic schema check
    for (const client of obj.clients) {
        if (!client || typeof client !== 'object') return false;
        if (typeof (client as Client).id !== 'string') return false;
        if (typeof (client as Client).name !== 'string') return false;
    }
    
    return true;
}

const getInitialData = (): StoredData => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (isValidStoredData(parsed)) {
                return { clients: parsed.clients, projects: parsed.projects };
            }
            console.warn('Invalid CRM data schema, resetting to defaults');
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch (error) {
        console.error('Failed to parse CRM storage:', error);
        localStorage.removeItem(STORAGE_KEY);
    }
    return { clients: mockClients, projects: mockProjects };
};
```

---

### BUG #9: Voice Recognition Error Handling

**Soubor:** `components/EditorView.tsx`
**Řádky:** 85-104
**Severity:** 🟡 MEDIUM

**Oprava:**
```typescript
useEffect(() => {
    if (!isVoiceActive) return;
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        addNotification('Voice recognition not supported in this browser', 'error');
        setIsVoiceActive(false);
        return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = language === 'cs' ? 'cs-CZ' : 'en-US';
    
    recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (!event.results || event.results.length === 0) return;
        
        const last = event.results.length - 1;
        const result = event.results[last];
        if (!result || !result[0]) return;
        
        const command = result[0].transcript.toLowerCase().trim();
        if (command) {
            handleVoiceCommand(command);
        }
    };
    
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        
        const errorMessages: Record<string, string> = {
            'no-speech': 'No speech detected - try speaking louder',
            'audio-capture': 'Microphone not available',
            'not-allowed': 'Microphone permission denied',
            'network': 'Network error - check connection',
        };
        
        const message = errorMessages[event.error] || `Voice error: ${event.error}`;
        addNotification(message, 'error');
        
        if (event.error === 'not-allowed' || event.error === 'audio-capture') {
            setIsVoiceActive(false);
        }
    };
    
    recognition.onend = () => {
        // Restart if still active (handles timeout)
        if (isVoiceActive) {
            try {
                recognition.start();
            } catch (e) {
                // Already started, ignore
            }
        }
    };
    
    try {
        recognition.start();
    } catch (e) {
        addNotification('Failed to start voice recognition', 'error');
        setIsVoiceActive(false);
    }
    
    return () => {
        try {
            recognition.stop();
        } catch (e) {
            // Already stopped
        }
    };
}, [isVoiceActive, language, addNotification, handleVoiceCommand]);
```

---

## FÁZE 6: GLOBAL ERROR BOUNDARY (30 min)

### Nový soubor: `components/ErrorBoundary.tsx`

```typescript
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
        // TODO: Send to error tracking service (Sentry, etc.)
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }
            
            return (
                <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
                    <div className="bg-slate-900 rounded-2xl p-8 max-w-md text-center border border-red-500/30">
                        <div className="text-red-400 text-6xl mb-4">⚠️</div>
                        <h1 className="text-xl font-bold text-white mb-2">
                            Něco se pokazilo
                        </h1>
                        <p className="text-slate-400 mb-4">
                            {this.state.error?.message || 'Neočekávaná chyba'}
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
                        >
                            Obnovit stránku
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
```

### Použití v `index.tsx`:
```typescript
import ErrorBoundary from './components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <LanguageProvider>
                <App />
            </LanguageProvider>
        </ErrorBoundary>
    </React.StrictMode>
);
```

---

## FÁZE 7: PERFORMANCE (volitelné, 45 min)

### Histogram Web Worker

**Nový soubor:** `workers/histogram.worker.ts`
```typescript
self.onmessage = (e: MessageEvent<ImageData>) => {
    const data = e.data.data;
    const r = new Array(256).fill(0);
    const g = new Array(256).fill(0);
    const b = new Array(256).fill(0);
    
    for (let i = 0; i < data.length; i += 4) {
        r[data[i]]++;
        g[data[i + 1]]++;
        b[data[i + 2]]++;
    }
    
    self.postMessage({ r, g, b });
};
```

**Použití v `utils/imageProcessor.ts`:**
```typescript
export async function calculateHistogramAsync(imageData: ImageData): Promise<HistogramData> {
    return new Promise((resolve) => {
        const worker = new Worker(new URL('../workers/histogram.worker.ts', import.meta.url));
        worker.onmessage = (e) => {
            resolve(e.data);
            worker.terminate();
        };
        worker.postMessage(imageData);
    });
}
```

---

## CHECKLIST PRO IMPLEMENTACI

### Fáze 1: Security (IHNED)
- [ ] Odstranit admin URL parameter bypass v `userProfileService.ts`

### Fáze 2: AI Funkce
- [ ] Přidat `safeJsonParse` helper do `geminiService.ts`
- [ ] Nahradit všechny `JSON.parse` volání
- [ ] Přidat detailní error messages
- [ ] Přidat `withRetry` wrapper
- [ ] Obalit API volání retry logikou

### Fáze 3: Memory Leaks
- [ ] Přidat URL tracking v `EditorView.tsx`
- [ ] Přidat cleanup useEffects
- [ ] Nahradit `URL.createObjectURL` za `createTrackedUrl`
- [ ] Přidat `cleanupFileUrls` v `App.tsx`

### Fáze 4: Race Conditions
- [ ] Opravit stale reference v `EditorView.tsx`
- [ ] Opravit upload race condition v `App.tsx`
- [ ] Přidat credit operation locking

### Fáze 5: Error Handling
- [ ] Přidat failed files tracking v `BatchView.tsx`
- [ ] Přidat localStorage schema validation
- [ ] Opravit voice recognition error handling

### Fáze 6: Global Error Boundary
- [ ] Vytvořit `ErrorBoundary.tsx`
- [ ] Přidat do `index.tsx`

### Fáze 7: Performance (volitelné)
- [ ] Vytvořit histogram web worker
- [ ] Použít async histogram calculation

---

## TESTOVÁNÍ

Po implementaci ověřit:

1. **Security test:** Otevřít `?role=admin` - NESMÍ fungovat
2. **AI test:** Spustit Autopilot na obrázek - nesmí crashnout
3. **Memory test:** Otevřít DevTools Memory, udělat 20 editů, zkontrolovat že paměť neroste
4. **Race test:** Rychle klikat na credit operace - kredity se nesmí odečítat vícekrát
5. **Error test:** Odpojit internet, spustit AI - musí ukázat smysluplnou chybu
6. **Batch test:** Nahrát 10 fotek včetně corrupted - musí ukázat které failnuly

---

## POZNÁMKY

- Všechny změny zachovávají zpětnou kompatibilitu
- Existující funkčnost nesmí být narušena
- UI texty v češtině kde je to relevantní
- Zachovat Pure Vision design styl
