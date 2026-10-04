// Volitelná vrstva Gemini: úprava fotky textem a hledání objektů pro chytré laso.
// Všechno ostatní (retuš štětcem, úpravy, technický culling) běží lokálně
// bez API — viz services/localInpaint.ts a utils/autoAdjust.ts.

import { GoogleGenAI, MediaResolution, ThinkingLevel } from '@google/genai';
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

// Structured object location for the editor's smart lasso.
const OBJECT_LOCATION_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'] as const;
const OBJECT_LOCATION_THINKING = { thinkingLevel: ThinkingLevel.LOW };

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

async function generateObjectLocationJson<T>(
    generate: (model: string) => Promise<{ text?: string; usageMetadata?: RawUsageMetadata }>,
    fallbackError: string
): Promise<T> {
    let lastError: Error | null = null;

    for (let index = 0; index < OBJECT_LOCATION_MODELS.length; index += 1) {
        const model = OBJECT_LOCATION_MODELS[index];
        try {
            const response = await generate(model);
            // Spotřebu zapisujeme i u odpovědi, která se pak neparsuje — zaplacená
            // byla stejně a bez ní by účet vycházel opticky nižší, než jaký přijde.
            recordUsage(model, response.usageMetadata);
            return safeJsonParse<T>(response.text, fallbackError);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const hasFallback = index < OBJECT_LOCATION_MODELS.length - 1;
            if (!hasFallback || (!isModelUnavailable(error) && !isStructuredOutputFailure(error))) {
                throw lastError;
            }
        }
    }

    throw lastError || new Error(fallbackError);
}

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
        const parsed = await generateObjectLocationJson<{ objects: { label: string; box_2d: number[] }[] }>(
            (model) => ai.models.generateContent({
                model,
                contents: { parts: [{ text: `Najdi: ${request}` }, dataUrlToInlinePart(imageDataUrl)] },
                config: {
                    systemInstruction: LOCATE_PROMPT,
                    thinkingConfig: OBJECT_LOCATION_THINKING,
                    // Drobné objekty (tetování, šperk) potřebují vysoké rozlišení.
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
