// Volitelná vrstva Gemini: AI verdikty v cullingu a úprava fotky textem.
// Všechno ostatní (retuš štětcem, úpravy, heuristický culling) běží lokálně
// bez API — viz services/localInpaint.ts a utils/autoAdjust.ts.

import { GoogleGenAI, MediaResolution, ThinkingLevel } from '@google/genai';
import type { CullingAiVerdict, CullingGenre, CullingMetrics } from '../types';
import { fileToBase64, base64ToFile } from '../utils/imageProcessor';
import { sanitizeText } from '../utils/text';
import { getApiKey } from '../utils/apiKey';
import { recordUsage, type RawUsageMetadata } from './aiUsage';

function safeJsonParse<T>(text: string | undefined, fallbackError: string): T {
    if (!text) {
        throw new Error(`${fallbackError}: Empty response from AI`);
    }

    try {
        let cleanText = sanitizeText(text).trim();
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
        // Obsah odpovědi nelogovat — může parafrázovat obsah fotky/promptu.
        console.error('Failed to parse AI response (invalid JSON)');
        throw new Error(`${fallbackError}: Invalid JSON from AI`);
    }
}

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
            const errorMessage = lastError.message;
            const lowerMessage = errorMessage.toLowerCase();

            // Always retry RETRYABLE errors (e.g. model returned text instead of image)
            const isRetryable = errorMessage.startsWith('RETRYABLE:');

            // Don't retry permanent failures (bad API key, invalid JSON, safety blocks)
            if (!isRetryable && (
                lowerMessage.includes('invalid api key') ||
                lowerMessage.includes('invalid json') ||
                errorMessage.startsWith('SAFETY_BLOCKED:')
            )) {
                throw lastError;
            }

            if (attempt < maxRetries - 1) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                console.warn(`AI request failed, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError || new Error('AI request failed after retries');
}

function getInlineImageData(response: any) {
    if (!response) {
        throw new Error('AI service unavailable - no response received');
    }

    if (!response.candidates || response.candidates.length === 0) {
        if (response.promptFeedback?.blockReason) {
            throw new Error(`SAFETY_BLOCKED: ${response.promptFeedback.blockReason}`);
        }
        throw new Error('AI returned no results - may be rate limited or model unavailable');
    }

    const candidate = response.candidates[0];

    // SAFETY / RECITATION / PROHIBITED_CONTENT jsou trvalá blokace — retry nepomůže, jen plýtvá kredity a časem
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT' || candidate.finishReason === 'IMAGE_SAFETY') {
        throw new Error(`SAFETY_BLOCKED: ${candidate.finishReason}`);
    }
    if (candidate.finishReason === 'RECITATION') {
        throw new Error('SAFETY_BLOCKED: RECITATION');
    }

    if (!candidate.content || !candidate.content.parts) {
        throw new Error('RETRYABLE: AI response has no content - retrying');
    }

    // Search all parts for image data
    const imagePart = candidate.content.parts.find((part: any) =>
        part.inlineData?.data
    );
    if (!imagePart) {
        const textParts = candidate.content.parts
            .filter((p: any) => p.text)
            .map((p: any) => p.text)
            .join(' ');
        // Obsah textu nelogovat ani nepropagovat — může parafrázovat obsah fotky.
        console.warn('AI returned text instead of image');
        // Pokud text obsahuje typické safety odmítnutí, respektovat a neretryovat
        if (/cannot|can't|won't|not able|policy|safety|inappropriate|harmful/i.test(textParts)) {
            throw new Error('SAFETY_BLOCKED: model refused');
        }
        throw new Error('RETRYABLE: AI did not generate image - returned text instead');
    }

    return imagePart.inlineData;
}

// Klíč zadává uživatel a drží se v prohlížeči (utils/apiKey). Bez klíče se
// nic neodesílá — volající dostane API_KEY_MISSING a nabídne jeho zadání.
const getGenAI = () => {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error("API_KEY_MISSING");
    }
    return new GoogleGenAI({ apiKey });
};

// --- FrameMind AI Culling (žánrově adaptivní verdikty) ---

// 3.6 Flash je z rodiny Flash nejlevnější na výstupu ($7.50/1M vs $9.00 u 3.5),
// a výstup je u cullingu většina účtu — thinking tokeny se účtují jako output.
// Fallback drží 3.5 Flash pro případ výpadku/nedostupnosti novějšího modelu.
const CULLING_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'] as const;

// Culling je klasifikace s předpočítanými metrikami, ne řetězec úvah — hluboké
// myšlení tu nic nepřidá, jen prodraží výstup. Gemini 3 navíc doporučuje nechat
// temperature na výchozí 1.0; nižší hodnoty u thinking modelů vedou ke smyčkám,
// což paradoxně spotřebu zvyšuje.
const CULLING_THINKING = { thinkingLevel: ThinkingLevel.LOW };

// Gemini účtuje obrázek po dlaždicích a počet dlaždic se odvíjí od POMĚRU stran,
// ne od velikosti — náhled 3:2 stojí 1 548 tokenů, ať má 768 px nebo 400 px.
// mediaResolution ten strop nastaví přímo: MEDIUM = 256 tokenů, LOW = 64.
//
// MEDIUM u verdiktu: model vidí celou fotku v jednom pohledu místo šesti výřezů.
// Detailní ostrost stejně rozhoduje lokální Laplacian na plném rozlišení, AI má
// na starost moment, kompozici a výraz — na to jeden pohled stačí.
// LOW u detekce žánru: rozpoznat "sport vs. portrét" jde i z hrubého náhledu.
const CULLING_MEDIA_RESOLUTION = MediaResolution.MEDIA_RESOLUTION_MEDIUM;
const GENRE_MEDIA_RESOLUTION = MediaResolution.MEDIA_RESOLUTION_LOW;

const CULLING_SYSTEM_PROMPT = `Jsi expert na fotografický culling pro profesionální fotografy.
Tvůj úkol: podívej se na jednu fotku, urči její žánr a rozhodni "keep", "review" nebo "reject" PODLE STANDARDŮ TOHO ŽÁNRU. Univerzální metr neexistuje — co je vada v produktovce, je styl ve streetu.

Žánrová kritéria:
- sport: rozhoduje vrchol akce a ostrý hlavní subjekt. Pohybová neostrost pozadí (panning) je plus, ne vada. Vyšší šum toleruj (haly, večerní zápasy). Zavřené oči neřeš, pokud moment funguje.
- portrait: ostré a OTEVŘENÉ oči jsou kritické. Výraz, práce se světlem, tóny pleti. Zavřené oči = reject, pokud nejsou zjevný záměr.
- wedding: emoce a moment mají přednost před technickou dokonalostí. Klíčové osoby musí fungovat. Zavřené oči vadí u pózovaných, méně u reportážních momentů.
- product: tvrdá technická kritéria — celková ostrost, přesná expozice, čisté pozadí, žádný rušivý šum.
- landscape: ostrost celé scény, rovný horizont, expozice oblohy (přepálené nebe je vážná vada), kompozice.
- street: moment, příběh a kompozice před technikou. Zrno a lehká neostrost mohou být součást stylu.
- wildlife: rozhoduje ostré oko zvířete. Zachycené chování nebo akce je plus.
- event: reportáž — momenty, výrazy, atmosféra; technická kritéria mírněji.
- other: obecná profesionální kritéria.

Kategorie verdiktu:
- keep: podle žánrových kritérií silná fotka bez zásadních problémů
- review: hraniční — opravitelné vady, téměř duplicita lepšího záběru, nebo potřeba lidského úsudku
- reject: selhává v tom, na čem v daném žánru záleží

Dostáváš: samotný obrázek plus předpočítané heuristické metriky (ostrost, expozice, kontrast, šum, kompozice, přepaly světel/stínů, příznak skupiny duplicit). Ber metriky jako podpůrný důkaz — tvůj vizuální úsudek je primární. Pokud dostaneš záměr fotografa, má při rozhodování vysokou váhu.

Pravidla:
- Hodnoty "decision" a "genre" zůstávají VŽDY anglicky, přesně z povolených hodnot.
- aiScore musí odrážet celkovou kvalitu v kontextu žánru, ne jen technické metriky.
- "summary" max 120 znaků, česky, žádné marketingové fráze.
- "reasons" a "risks" každé max 4 položky, každá max 60 znaků, česky.
- Lokálně detekované tváře, stav očí a ostrost hlavního obličeje jsou důležité technické signály. Pokud se obraz a metriky rozcházejí, zvol "review", ne automatické "keep".
- Pokud obrázek chybí nebo je nečitelný, nastav decision na "review" a vysvětli v risks.`;

const CULLING_GENRE_VALUES: CullingGenre[] = ['sport', 'portrait', 'wedding', 'product', 'landscape', 'street', 'wildlife', 'event', 'other'];

const CULLING_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        decision: { type: 'string', enum: ['keep', 'review', 'reject'] },
        genre: { type: 'string', enum: CULLING_GENRE_VALUES },
        aiScore: { type: 'integer' },
        summary: { type: 'string' },
        reasons: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
    },
    required: ['decision', 'genre', 'aiScore', 'summary', 'reasons', 'risks'],
} as any;

const GENRE_DETECT_PROMPT = `Jsi expert na fotografii. Dostaneš 1-3 náhledy ze STEJNÉHO focení. Urči převažující žánr celé sady.
Hodnota "genre" zůstává anglicky. "note" je jedna krátká česká věta (max 100 znaků), co na fotkách vidíš.`;

const GENRE_DETECT_SCHEMA = {
    type: 'object',
    properties: {
        genre: { type: 'string', enum: CULLING_GENRE_VALUES },
        confidence: { type: 'integer' },
        note: { type: 'string' },
    },
    required: ['genre', 'confidence', 'note'],
} as any;

const dataUrlToInlinePart = (dataUrl: string) => {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
    if (!match) throw new Error('Invalid thumbnail data URL');
    return { inlineData: { mimeType: match[1], data: match[2] } };
};

function isModelUnavailable(error: unknown): boolean {
    const status = typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : 0;
    const message = error instanceof Error ? error.message : String(error);
    return status === 404 || /not[_ -]?found|unsupported|does not exist|unknown model/i.test(message);
}

function isStructuredOutputFailure(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /empty response from ai|invalid json from ai/i.test(message);
}

async function generateCullingJson<T>(
    generate: (model: string) => Promise<{ text?: string; usageMetadata?: RawUsageMetadata }>,
    fallbackError: string
): Promise<T> {
    let lastError: Error | null = null;

    for (let index = 0; index < CULLING_MODELS.length; index += 1) {
        const model = CULLING_MODELS[index];
        try {
            const response = await generate(model);
            // Spotřebu zapisujeme i u odpovědi, která se pak neparsuje — zaplacená
            // byla stejně a bez ní by účet vycházel opticky nižší, než jaký přijde.
            recordUsage(model, response.usageMetadata);
            return safeJsonParse<T>(response.text, fallbackError);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const hasFallback = index < CULLING_MODELS.length - 1;
            if (!hasFallback || (!isModelUnavailable(error) && !isStructuredOutputFailure(error))) {
                throw lastError;
            }
        }
    }

    throw lastError || new Error(fallbackError);
}

export const detectBatchGenre = async (
    thumbnailDataUrls: string[]
): Promise<{ genre: CullingGenre; confidence: number; note: string }> => {
    return withRetry(async () => {
        const ai = getGenAI();
        const thumbs = thumbnailDataUrls.slice(0, 3).map(dataUrlToInlinePart);
        const parsed = await generateCullingJson<{ genre: CullingGenre; confidence: number; note: string }>(
            (model) => ai.models.generateContent({
                model,
                contents: {
                    parts: [
                        { text: `Náhledy z jednoho focení (${thumbs.length}). Urči žánr sady.` },
                        ...thumbs,
                    ],
                },
                config: {
                    systemInstruction: GENRE_DETECT_PROMPT,
                    thinkingConfig: CULLING_THINKING,
                    mediaResolution: GENRE_MEDIA_RESOLUTION,
                    maxOutputTokens: 1024,
                    responseMimeType: 'application/json',
                    responseSchema: GENRE_DETECT_SCHEMA,
                },
            }),
            'Genre detection failed'
        );
        return {
            genre: CULLING_GENRE_VALUES.includes(parsed.genre) ? parsed.genre : 'other',
            confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence)) || 0)),
            note: typeof parsed.note === 'string' ? parsed.note.slice(0, 140) : '',
        };
    });
};

export interface CullingVerdictContext {
    filename: string;
    metrics: CullingMetrics;
    heuristicScore: number;
    duplicateGroupId?: string;
    isBestInGroup?: boolean;
    genre?: CullingGenre | null;
    brief?: string;
    faceCount?: number;
    eyeBlink?: number;
    taste?: string | null;
    // 'soft' / 'bad' = měření na nativním rozlišení říká, že je snímek měkčí
    // než zbytek sady. Model to z náhledu nepozná, musí se mu to říct.
    sharpnessStanding?: 'unknown' | 'normal' | 'soft' | 'bad';
}

export const getCullingVerdict = async (
    thumbnailDataUrl: string,
    context: CullingVerdictContext
): Promise<CullingAiVerdict> => {
    return withRetry(async () => {
        const ai = getGenAI();
        const m = context.metrics;
        const lines = [
            `Filename: ${context.filename.slice(0, 200)}`,
            'Heuristic metrics (0-1 unless noted):',
            `- sharpness: ${m.sharpnessScore.toFixed(2)}`,
            `- exposure: ${m.exposureScore.toFixed(2)}`,
            `- contrast: ${m.contrastScore.toFixed(2)}`,
            `- noise (1=clean): ${m.noiseScore.toFixed(2)}`,
            `- composition: ${m.compositionScore.toFixed(2)}`,
            `- highlight clipping (0=none): ${m.highlightClipping.toFixed(2)}`,
            `- shadow clipping (0=none): ${m.shadowClipping.toFixed(2)}`,
            `- heuristic finalScore: ${Math.round(context.heuristicScore)}/100`,
            context.duplicateGroupId
                ? `- duplicate group: ${context.duplicateGroupId}${context.isBestInGroup ? ' (best in group)' : ' (not best)'}`
                : null,
            context.faceCount
                ? `- faces detected: ${context.faceCount}${(context.eyeBlink ?? 0) >= 0.5 ? `, main face eyes likely CLOSED (blink ${Number(context.eyeBlink).toFixed(2)})` : (context.eyeBlink ?? 0) > 0 ? `, main face eyes open (blink ${Number(context.eyeBlink).toFixed(2)})` : ''}`
                : null,
            context.sharpnessStanding === 'bad'
                ? '- MĚŘENÍ NA PLNÉM ROZLIŠENÍ: tenhle snímek je výrazně měkčí než zbytek sady (pod pětinou mediánu ostrosti). Na zmenšeném náhledu to nepoznáš — ber to jako tvrdý důkaz neostrosti, ne jako domněnku.'
                : context.sharpnessStanding === 'soft'
                    ? '- MĚŘENÍ NA PLNÉM ROZLIŠENÍ: tenhle snímek je měkčí než zbytek sady (pod polovinou mediánu ostrosti). Náhled to neukáže; zvaž to při rozhodování.'
                    : null,
            context.genre
                ? `Žánr celé sady byl klasifikován jako: ${context.genre}. Ber jako výchozí; pokud tahle konkrétní fotka zjevně patří jinam, urči vlastní žánr.`
                : null,
            // Brief fotografa je length-capped — injection guard proti přetlačení promptu.
            context.brief?.trim()
                ? `Záměr fotografa pro toto focení (zohledni s vysokou vahou): ${context.brief.trim().slice(0, 500)}`
                : null,
            context.taste?.trim()
                ? `Osobní profil vkusu fotografa (z jeho dřívějších ručních rozhodnutí): ${context.taste.trim().slice(0, 280)}`
                : null,
            '',
            'Podívej se na obrázek a vrať JSON verdikt.',
        ].filter(Boolean).join('\n');

        const raw = await generateCullingJson<CullingAiVerdict>(
            (model) => ai.models.generateContent({
                model,
                contents: {
                    parts: [
                        { text: lines },
                        dataUrlToInlinePart(thumbnailDataUrl),
                    ],
                },
                config: {
                    systemInstruction: CULLING_SYSTEM_PROMPT,
                    thinkingConfig: CULLING_THINKING,
                    mediaResolution: CULLING_MEDIA_RESOLUTION,
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json',
                    responseSchema: CULLING_RESPONSE_SCHEMA,
                },
            }),
            'Culling verdict failed'
        );
        const decision = ['keep', 'review', 'reject'].includes(raw.decision) ? raw.decision : 'review';
        return {
            decision,
            genre: CULLING_GENRE_VALUES.includes(raw.genre) ? raw.genre : 'other',
            aiScore: Math.max(0, Math.min(100, Math.round(Number(raw.aiScore)) || 0)),
            summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 180) : '',
            reasons: Array.isArray(raw.reasons)
                ? raw.reasons.filter((item): item is string => typeof item === 'string').slice(0, 4).map((item) => item.slice(0, 80))
                : [],
            risks: Array.isArray(raw.risks)
                ? raw.risks.filter((item): item is string => typeof item === 'string').slice(0, 4).map((item) => item.slice(0, 80))
                : [],
        };
    });
};

// Retuš celé fotky standardním API voláním. Když model úpravu odmítne
// (SAFETY_BLOCKED), odmítnutí respektujeme — žádný další pokus, žádný
// alternativní kontext. Původní soubor zůstává nedotčený, volající zobrazí
// lokalizovanou hlášku přes services/aiErrors.
const retouchFullImage = async (file: File, prompt: string): Promise<{ file: File }> => {
    return withRetry(async () => {
        const ai = getGenAI();
        const base64Image = await fileToBase64(file);
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Image, mimeType: file.type } },
                    { text: `You are a professional photo retoucher working on a commercial portrait. Apply this retouching request to the photo: "${prompt}". Use natural skin tones, realistic textures, intelligent inpainting and seamless blending so the result looks like a clean, untouched photograph. Keep the original style, composition, lighting, framing and resolution. Apply ONLY the requested edit. Return ONLY the edited image, no text.` }
                ]
            },
            config: {
                responseModalities: ['image', 'text'],
            }
        });
        const imagePart = getInlineImageData(response);
        return { file: await base64ToFile(imagePart.data, `retouched_${file.name}`, imagePart.mimeType) };
    });
};

/**
 * Public retouch entry — jediné standardní volání. SAFETY_BLOCKED se propaguje
 * volajícímu (UI zobrazí hlášku a nabídne ruční úpravy), žádný fallback
 * s ochuzeným kontextem se nespouští.
 */
export const retouchWithPrompt = async (file: File, prompt: string): Promise<{ file: File }> => {
    return retouchFullImage(file, prompt);
};

// --- Chytré laso textem: Gemini jen najde, kde objekty jsou ---
// Vrací obdélníky; přesnou masku z nich dělá lokální SAM (services/localSegment).
// Konvence Gemini pro detekci: box_2d = [ymin, xmin, ymax, xmax] v 0–1000.

const LOCATE_SCHEMA = {
    type: 'object',
    properties: {
        objects: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    label: { type: 'string' },
                    box_2d: { type: 'array', items: { type: 'integer' } },
                },
                required: ['label', 'box_2d'],
            },
        },
    },
    required: ['objects'],
} as any;

const LOCATE_PROMPT = `Jsi přesný detektor objektů na fotografii. Najdi VŠECHNY výskyty toho, co uživatel popíše (i malé, částečně zakryté nebo na více lidech). Pro každý výskyt vrať těsný obdélník box_2d = [ymin, xmin, ymax, xmax] normalizovaný na 0–1000 a krátký popisek. Když nic takového na fotce není, vrať prázdné pole. Nic si nevymýšlej.`;

export interface LocatedObject {
    label: string;
    /** Obdélník v pixelech předaného obrázku. */
    box: { x0: number; y0: number; x1: number; y1: number };
}

export const locateObjects = async (imageDataUrl: string, width: number, height: number, query: string): Promise<LocatedObject[]> => {
    const request = query.trim().slice(0, 200);
    if (!request) return [];
    return withRetry(async () => {
        const ai = getGenAI();
        const parsed = await generateCullingJson<{ objects: { label: string; box_2d: number[] }[] }>(
            (model) => ai.models.generateContent({
                model,
                contents: { parts: [{ text: `Najdi: ${request}` }, dataUrlToInlinePart(imageDataUrl)] },
                config: {
                    systemInstruction: LOCATE_PROMPT,
                    thinkingConfig: CULLING_THINKING,
                    // Detekce drobností (tetování, šperk) potřebuje víc detailu než culling.
                    mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json',
                    responseSchema: LOCATE_SCHEMA,
                },
            }),
            'Object location failed'
        );
        const clamp = (v: number) => Math.max(0, Math.min(1000, Number(v) || 0));
        return (parsed.objects || [])
            .filter((o) => Array.isArray(o.box_2d) && o.box_2d.length === 4)
            .slice(0, 24)
            .map((o) => {
                const [ymin, xmin, ymax, xmax] = o.box_2d.map(clamp);
                return {
                    label: typeof o.label === 'string' ? o.label.slice(0, 60) : '',
                    box: { x0: (xmin / 1000) * width, y0: (ymin / 1000) * height, x1: (xmax / 1000) * width, y1: (ymax / 1000) * height },
                };
            })
            .filter((o) => o.box.x1 - o.box.x0 > 2 && o.box.y1 - o.box.y0 > 2);
    });
};
