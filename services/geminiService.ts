
import { GoogleGenAI, MediaResolution, ThinkingLevel } from '@google/genai';
import type {
    AnalysisResult,
    AutoCropResult,
    AutoCropSuggestion,
    CropCoordinates,
    CullingAiVerdict,
    CullingGenre,
    CullingMetrics,
    Language,
    QualityAssessment,
    YouTubeThumbnailTemplate,
} from '../types';
import { fileToBase64, base64ToFile, findMaskBoundingBox } from '../utils/imageProcessor';
import { sanitizeText } from '../utils/text';
import { getApiKey } from '../utils/apiKey';
import { recordUsage, type RawUsageMetadata } from './aiUsage';

const IMAGE_GENERATION_MODEL = 'gemini-3.1-flash-image-preview';

const THUMBNAIL_RESOLUTION_MAP = {
    '1K': { width: 1280, height: 720 },
    '2K': { width: 2048, height: 1152 },
    '4K': { width: 3840, height: 2160 },
} as const;

const THUMBNAIL_MIME_MAP = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
} as const;

const THUMBNAIL_EXTENSION_MAP = {
    jpeg: 'jpg',
    png: 'png',
    webp: 'webp',
} as const;

const THUMBNAIL_FONT_FAMILY = 'Impact, "Arial Black", sans-serif';

type ThumbnailOverlayStyle = {
    placement: 'top-center' | 'top-left' | 'bottom-left' | 'bottom-center';
    panel: 'full-top' | 'full-bottom' | 'boxed';
    align: 'left' | 'center';
    maxWidthRatio: number;
    maxLines: number;
    fillStyle: string;
    strokeStyle: string;
    shadowColor: string;
    accentColor?: string;
    accentStyle?: 'none' | 'left-bar' | 'underline';
};

type ThumbnailTemplateDefinition = {
    promptGuidance: string[];
    overlay: ThumbnailOverlayStyle;
};

const THUMBNAIL_TEMPLATE_CONFIG: Record<YouTubeThumbnailTemplate, ThumbnailTemplateDefinition> = {
    'shock-face': {
        promptGuidance: [
            'Compose it like a reaction thumbnail with one dominant subject occupying the center and lower-middle of frame.',
            'Reserve the upper third as a clean, darker headline zone with minimal clutter.',
            'Favor expressive emotion, luminous edge lighting, and strong depth separation.',
        ],
        overlay: {
            placement: 'top-center',
            panel: 'full-top',
            align: 'center',
            maxWidthRatio: 0.84,
            maxLines: 3,
            fillStyle: '#ffffff',
            strokeStyle: 'rgba(0, 0, 0, 0.92)',
            shadowColor: 'rgba(0, 0, 0, 0.45)',
            accentStyle: 'none',
        },
    },
    'authority-clean': {
        promptGuidance: [
            'Create a premium expert-style thumbnail with the main subject on the right third of the frame.',
            'Keep the lower-left area compositionally clean for a sharp headline overlay.',
            'Reduce visual clutter and favor trust, polish, and premium channel aesthetics over chaos.',
        ],
        overlay: {
            placement: 'bottom-left',
            panel: 'boxed',
            align: 'left',
            maxWidthRatio: 0.48,
            maxLines: 3,
            fillStyle: '#ffffff',
            strokeStyle: 'rgba(0, 0, 0, 0.9)',
            shadowColor: 'rgba(0, 0, 0, 0.35)',
            accentColor: '#58d0ff',
            accentStyle: 'left-bar',
        },
    },
    'split-drama': {
        promptGuidance: [
            'Create a high-tension thumbnail with contrast between two elements, sides, or states.',
            'Leave the upper-left area clean so an aggressive headline can sit there without fighting the subject.',
            'Push drama, separation, intensity, and contrast more than realism.',
        ],
        overlay: {
            placement: 'top-left',
            panel: 'boxed',
            align: 'left',
            maxWidthRatio: 0.5,
            maxLines: 3,
            fillStyle: '#fff06a',
            strokeStyle: 'rgba(0, 0, 0, 0.96)',
            shadowColor: 'rgba(0, 0, 0, 0.38)',
            accentColor: '#ff7a18',
            accentStyle: 'underline',
        },
    },
    'cinematic-poster': {
        promptGuidance: [
            'Build it like a cinematic poster with dramatic depth, atmosphere, and premium lighting.',
            'Keep the lower-center band readable so a title can sit there cleanly.',
            'Favor scale, mood, and polish over meme-like chaos.',
        ],
        overlay: {
            placement: 'bottom-center',
            panel: 'full-bottom',
            align: 'center',
            maxWidthRatio: 0.78,
            maxLines: 3,
            fillStyle: '#ffffff',
            strokeStyle: 'rgba(0, 0, 0, 0.9)',
            shadowColor: 'rgba(0, 0, 0, 0.42)',
            accentColor: '#f8b74c',
            accentStyle: 'underline',
        },
    },
};

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

const loadImageFromFile = (file: File): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();

        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };

        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Generated image could not be loaded'));
        };

        image.src = objectUrl;
    });
};

const normalizeThumbnailHeadline = (text: string) => text.replace(/\s+/g, ' ').trim();

const wrapHeadlineText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
    const words = normalizeThumbnailHeadline(text).split(' ').filter(Boolean);
    if (words.length === 0) {
        return [];
    }

    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth) {
            currentLine = candidate;
            continue;
        }

        if (!currentLine) {
            let shortened = word;
            while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) {
                shortened = shortened.slice(0, -1);
            }
            lines.push(`${shortened}…`);
            continue;
        }

        lines.push(currentLine);
        currentLine = word;
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines;
};

const truncateHeadlineLine = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
    if (ctx.measureText(text).width <= maxWidth) {
        return text;
    }

    let trimmed = text;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
        trimmed = trimmed.slice(0, -1);
    }

    return `${trimmed.trimEnd()}…`;
};

const getHeadlineDisplayText = (headlineText: string, template: YouTubeThumbnailTemplate) => {
    const normalized = normalizeThumbnailHeadline(headlineText);
    if (template === 'shock-face' || template === 'split-drama') {
        return normalized.toUpperCase();
    }
    return normalized;
};

const drawRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    fillStyle: string | CanvasGradient
) => {
    ctx.fillStyle = fillStyle;
    ctx.fillRect(x, y, width, height);
};

const layoutHeadlineText = (
    ctx: CanvasRenderingContext2D,
    headlineText: string,
    canvasWidth: number,
    canvasHeight: number,
    overlay: ThumbnailOverlayStyle
) => {
    const maxWidth = canvasWidth * overlay.maxWidthRatio;
    const maxLines = overlay.maxLines;
    const maxFontSize = Math.round(canvasHeight * 0.15);
    const minFontSize = Math.max(42, Math.round(canvasHeight * 0.062));
    const step = Math.max(4, Math.round(canvasHeight * 0.008));

    for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= step) {
        ctx.font = `900 ${fontSize}px ${THUMBNAIL_FONT_FAMILY}`;
        const lines = wrapHeadlineText(ctx, headlineText, maxWidth);
        if (lines.length > 0 && lines.length <= maxLines) {
            return { fontSize, lines };
        }
    }

    ctx.font = `900 ${minFontSize}px ${THUMBNAIL_FONT_FAMILY}`;
    const lines = wrapHeadlineText(ctx, headlineText, maxWidth).slice(0, maxLines);
    if (lines.length === maxLines) {
        lines[maxLines - 1] = truncateHeadlineLine(ctx, lines[maxLines - 1], maxWidth);
    }

    return { fontSize: minFontSize, lines };
};

const drawThumbnailHeadline = (
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    headlineText: string,
    template: YouTubeThumbnailTemplate
) => {
    const overlay = THUMBNAIL_TEMPLATE_CONFIG[template].overlay;
    const displayText = getHeadlineDisplayText(headlineText, template);
    if (!displayText) {
        return;
    }

    const { fontSize, lines } = layoutHeadlineText(ctx, displayText, canvasWidth, canvasHeight, overlay);
    if (lines.length === 0) {
        return;
    }

    const lineHeight = Math.round(fontSize * 0.9);
    const totalTextHeight = lines.length * lineHeight;
    const horizontalPadding = Math.round(canvasWidth * 0.055);
    const verticalPadding = Math.round(canvasHeight * 0.045);
    const boxPaddingX = Math.max(18, Math.round(fontSize * 0.24));
    const boxPaddingY = Math.max(14, Math.round(fontSize * 0.18));
    ctx.font = `900 ${fontSize}px ${THUMBNAIL_FONT_FAMILY}`;
    const measuredWidths = lines.map((line) => ctx.measureText(line).width);
    const maxLineWidth = measuredWidths.length ? Math.max(...measuredWidths) : 0;
    const boxWidth = Math.round(maxLineWidth + boxPaddingX * 2);
    const boxHeight = Math.round(totalTextHeight + boxPaddingY * 2);

    let textX = canvasWidth / 2;
    let textStartY = verticalPadding;

    if (overlay.panel === 'full-top') {
        const panelHeight = Math.round(totalTextHeight + canvasHeight * 0.12);
        const gradient = ctx.createLinearGradient(0, 0, 0, panelHeight);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.82)');
        gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.38)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        drawRect(ctx, 0, 0, canvasWidth, panelHeight, gradient);
        textX = canvasWidth / 2;
        textStartY = verticalPadding;
    } else if (overlay.panel === 'full-bottom') {
        const panelHeight = Math.round(totalTextHeight + canvasHeight * 0.14);
        const panelY = canvasHeight - panelHeight;
        const gradient = ctx.createLinearGradient(0, canvasHeight, 0, panelY);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.88)');
        gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.42)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        drawRect(ctx, 0, panelY, canvasWidth, panelHeight, gradient);
        textX = canvasWidth / 2;
        textStartY = canvasHeight - panelHeight + verticalPadding;
    } else {
        const boxX = horizontalPadding - Math.round(boxPaddingX * 0.55);
        const boxY = overlay.placement === 'top-left'
            ? verticalPadding - Math.round(boxPaddingY * 0.45)
            : canvasHeight - boxHeight - verticalPadding;
        drawRect(ctx, boxX, boxY, Math.min(boxWidth, canvasWidth - boxX - horizontalPadding), boxHeight, 'rgba(0, 0, 0, 0.64)');
        if (overlay.accentStyle === 'left-bar' && overlay.accentColor) {
            drawRect(ctx, boxX, boxY, Math.max(8, Math.round(fontSize * 0.12)), boxHeight, overlay.accentColor);
        }
        textX = horizontalPadding;
        textStartY = boxY + boxPaddingY;
    }

    ctx.textAlign = overlay.align;
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(6, Math.round(fontSize * 0.14));
    ctx.strokeStyle = overlay.strokeStyle;
    ctx.fillStyle = overlay.fillStyle;
    ctx.shadowColor = overlay.shadowColor;
    ctx.shadowBlur = Math.round(fontSize * 0.22);
    ctx.shadowOffsetY = Math.max(2, Math.round(fontSize * 0.08));

    lines.forEach((line, index) => {
        const y = textStartY + index * lineHeight;
        ctx.strokeText(line, textX, y);
        ctx.fillText(line, textX, y);
    });

    if (overlay.accentStyle === 'underline' && overlay.accentColor) {
        const underlineWidth = overlay.align === 'center'
            ? Math.min(canvasWidth * 0.28, maxLineWidth * 0.65)
            : Math.min(canvasWidth * 0.24, maxLineWidth * 0.8);
        const underlineHeight = Math.max(6, Math.round(fontSize * 0.08));
        const underlineY = textStartY + totalTextHeight + Math.round(fontSize * 0.2);
        const underlineX = overlay.align === 'center'
            ? (canvasWidth - underlineWidth) / 2
            : textX;
        drawRect(ctx, underlineX, underlineY, underlineWidth, underlineHeight, overlay.accentColor);
    }

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
};

const renderImageFile = async (
    sourceFile: File,
    baseName: string,
    format: keyof typeof THUMBNAIL_MIME_MAP,
    targetSize?: { width: number; height: number },
    headlineText?: string,
    template: YouTubeThumbnailTemplate = 'shock-face'
): Promise<File> => {
    const image = await loadImageFromFile(sourceFile);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        throw new Error('Canvas context unavailable');
    }

    canvas.width = targetSize?.width ?? image.naturalWidth;
    canvas.height = targetSize?.height ?? image.naturalHeight;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (headlineText) {
        drawThumbnailHeadline(ctx, canvas.width, canvas.height, headlineText, template);
    }

    const mimeType = THUMBNAIL_MIME_MAP[format];
    const extension = THUMBNAIL_EXTENSION_MAP[format];
    const quality = format === 'jpeg' || format === 'webp' ? 0.92 : undefined;

    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
            if (!result) {
                reject(new Error('Failed to render generated thumbnail'));
                return;
            }

            resolve(result);
        }, mimeType, quality);
    });

    return new File([blob], `${baseName}.${extension}`, { type: blob.type || mimeType });
};

const clampRect = (rect: CropCoordinates, width: number, height: number): CropCoordinates => {
    const x = Math.max(0, Math.min(width, rect.x));
    const y = Math.max(0, Math.min(height, rect.y));
    const w = Math.max(1, Math.min(width - x, rect.width));
    const h = Math.max(1, Math.min(height - y, rect.height));
    return { x, y, width: w, height: h };
};

const normalizeAutoCropResult = (result: AutoCropResult, width: number, height: number): AutoCropResult => {
    const safeZone = clampRect(result.safeZone, width, height);
    const mainSubject = clampRect(result.mainSubject, width, height);
    const facesBoundingBox = result.facesBoundingBox ? clampRect(result.facesBoundingBox, width, height) : null;
    const suggestedCrops = (result.suggestedCrops || [])
        .filter((item): item is AutoCropSuggestion => !!item?.rect)
        .map((item) => ({
            ...item,
            confidence: Math.max(0, Math.min(1, item.confidence ?? 0)),
            rect: clampRect(item.rect, width, height),
        }))
        .sort((a, b) => b.confidence - a.confidence);

    return {
        ...result,
        safeZone,
        mainSubject,
        facesBoundingBox,
        suggestedCrops,
    };
};

/**
 * Initializes and returns a GoogleGenAI instance.
 * 
 * SECURITY NOTE:
 * In this implementation, we are using a user-provided API key stored locally in the browser.
 * Access control is handled by the "Credit System" in the UI layer (App.tsx).
 * 
 * If the user has 0 credits, the UI blocks the call to these functions, ensuring
 * the API is not called unnecessarily.
 * 
 * For maximum security, this logic should eventually move to a backend proxy
 * where the key is never exposed to the client bundle.
 */
const getGenAI = () => {
    const apiKey = getApiKey();
    
    if (!apiKey) {
        console.error("API Key is missing in local storage.");
        throw new Error("API_KEY_MISSING");
    }

    return new GoogleGenAI({ apiKey });
};

/**
 * STANDALONE YouTube Thumbnail generator.
 */
export const generateYouTubeThumbnail = async (
    topic: string, 
    textOverlay: string, 
    options: {
        resolution: '1K' | '2K' | '4K',
        format: 'jpeg' | 'png' | 'webp',
        template: YouTubeThumbnailTemplate,
        referenceFile?: File
    }
): Promise<{ file: File }> => {
    return withRetry(async () => {
        const ai = getGenAI();
        const requestedSize = THUMBNAIL_RESOLUTION_MAP[options.resolution];
        const trimmedTopic = topic.trim();
        const trimmedText = textOverlay.trim();
        const templateConfig = THUMBNAIL_TEMPLATE_CONFIG[options.template];
        const parts: any[] = [];
        const promptLines = [
            'Create a polished, high-CTR YouTube thumbnail background image.',
            `Topic: ${trimmedTopic}.`,
            'Use one strong focal subject, dramatic lighting, bold contrast, saturated colors, cinematic depth, and premium creator aesthetics.',
            'Keep the composition readable on both mobile and desktop with a clear subject and strong visual hierarchy.',
            'Do not render any text, letters, captions, subtitles, or logos into the image.',
            'The output must look like a professional YouTube thumbnail visual, not a poster or generic concept art.',
            ...templateConfig.promptGuidance,
        ];

        if (trimmedText) {
            promptLines.push(`The planned headline concept is "${trimmedText}". Support that message visually with emotion, composition, and negative space, but do not draw the text itself.`);
        }

        if (options.referenceFile) {
            const base64Ref = await fileToBase64(options.referenceFile);
            parts.push({ inlineData: { data: base64Ref, mimeType: options.referenceFile.type } });
            promptLines.push('Use the attached image as a visual reference. Preserve the main subject or composition cues, but restyle it into a premium YouTube thumbnail.');
        }

        parts.push({ text: promptLines.join(' ') });

        const response = await ai.models.generateContent({
            model: IMAGE_GENERATION_MODEL,
            contents: { parts },
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: {
                    aspectRatio: '16:9',
                    imageSize: options.resolution,
                },
            },
        });

        const imagePart = getInlineImageData(response);
        const generatedFile = await base64ToFile(
            imagePart.data,
            `yt_thumb_raw_${Date.now()}`,
            imagePart.mimeType || 'image/png'
        );
        const finalFile = await renderImageFile(
            generatedFile,
            `yt_thumb_${Date.now()}`,
            options.format,
            requestedSize,
            trimmedText,
            options.template
        );

        return { 
            file: finalFile,
        };
    });
};

export const analyzeImage = async (file: File, language: Language = 'cs'): Promise<AnalysisResult> => {
  return withRetry(async () => {
    const ai = getGenAI();
    const base64Image = await fileToBase64(file);
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: file.type, data: base64Image } },
          { text: 'Analyzuj tuto fotografii. Vrať popis, doporučení a technické informace. Odpověz česky.' },
        ],
      },
      config: { responseMimeType: 'application/json' }
    });
    return safeJsonParse<AnalysisResult>(response.text, 'Image analysis failed');
  });
};

export const autopilotImage = async (file: File): Promise<{ file: File }> => {
    return withRetry(async () => {
        const ai = getGenAI();
        const base64Image = await fileToBase64(file);
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Image, mimeType: file.type } },
                    { text: "Vylepši tuto fotografii profesionálně se zaměřením na barvy a dynamický rozsah." },
                ],
            }
        });
        const imagePart = getInlineImageData(response);
        return { file: await base64ToFile(imagePart.data, `auto_${file.name}`, imagePart.mimeType) };
    });
};

export const generateImage = async (prompt: string): Promise<string> => {
  return withRetry(async () => {
    const ai = getGenAI();
    const response = await ai.models.generateContent({ 
        model: 'gemini-3.1-flash-image-preview', 
        contents: { parts: [{ text: prompt }] } 
    });
    const imagePart = getInlineImageData(response);
    return imagePart.data;
  });
};

export const removeBackground = async (file: File): Promise<{ file: File }> => {
    return withRetry(async () => {
        const ai = getGenAI();
        const base64Image = await fileToBase64(file);
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Image, mimeType: file.type } },
                    { text: 'Odstraň pozadí. Hlavní subjekt ponech ostrý. Výstup s transparentním pozadím.' }
                ]
            }
        });
        const imagePart = getInlineImageData(response);
        return { file: await base64ToFile(imagePart.data, `bg_removed_${file.name.replace(/\\.[^/.]+$/, '')}.png`, 'image/png') };
    });
};

export const replaceBackground = async (file: File, description: string): Promise<{ file: File }> => {
    return withRetry(async () => {
        const ai = getGenAI();
        const base64Image = await fileToBase64(file);
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Image, mimeType: file.type } },
                    { text: `Nahraď pozadí za: ${description}. Subjekt ponech beze změn a zachovej realistické světlo.` }
                ]
            }
        });
        const imagePart = getInlineImageData(response);
        return { file: await base64ToFile(imagePart.data, `bg_replaced_${file.name}`, imagePart.mimeType) };
    });
};

export const enhanceFaces = async (file: File): Promise<{ file: File }> => {
    return withRetry(async () => {
        const ai = getGenAI();
        const base64Image = await fileToBase64(file);
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Image, mimeType: file.type } },
                    { text: 'Jemné vylepšení obličeje: sjednotit pleť, rozjasnit oči, redukovat nedokonalosti, zachovat přirozenost.' }
                ]
            }
        });
        const imagePart = getInlineImageData(response);
        return { file: await base64ToFile(imagePart.data, `face_enhanced_${file.name}`, imagePart.mimeType) };
    });
};

export const analyzeForAutoCrop = async (
    file: File,
    imageSize: { width: number; height: number }
): Promise<AutoCropResult> => {
    return withRetry(async () => {
        const ai = getGenAI();
        const base64Image = await fileToBase64(file);
        const { width, height } = imageSize;
        const prompt = `Analyzuj obrázek pro optimální ořez.
Vrať pouze JSON. Použij pixelové souřadnice v původním prostoru (0..width/height).
Velikost obrázku: ${width}x${height}.
Požadavky:
1) Urči bounding box hlavního subjektu
2) Vrať safe zónu, kde musí zůstat důležitý obsah
3) Navrhni ořez pro poměry: 1:1, 4:3, 3:2, 16:9
4) Uveď confidence 0-1 pro každý návrh
JSON tvar:
{
  "mainSubject": { "x": number, "y": number, "width": number, "height": number },
  "facesBoundingBox": { "x": number, "y": number, "width": number, "height": number } | null,
  "suggestedCrops": [
    { "aspectRatio": "1:1", "rect": { "x": number, "y": number, "width": number, "height": number }, "confidence": number },
    { "aspectRatio": "4:3", "rect": { "x": number, "y": number, "width": number, "height": number }, "confidence": number },
    { "aspectRatio": "3:2", "rect": { "x": number, "y": number, "width": number, "height": number }, "confidence": number },
    { "aspectRatio": "16:9", "rect": { "x": number, "y": number, "width": number, "height": number }, "confidence": number }
  ],
  "safeZone": { "x": number, "y": number, "width": number, "height": number },
  "composition": "centered" | "rule-of-thirds" | "golden-ratio"
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Image, mimeType: file.type } },
                    { text: prompt }
                ],
            },
            config: { responseMimeType: 'application/json' }
        });

        const parsed = safeJsonParse<AutoCropResult>(response.text, 'Autocrop analysis failed');
        return normalizeAutoCropResult(parsed, width, height);
    });
};

export const assessQuality = async (file: File): Promise<QualityAssessment> => {
    return withRetry(async () => {
        const ai = getGenAI();
        const base64Image = await fileToBase64(file);
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Image, mimeType: file.type } },
                    { text: "Ohodnoť technickou kvalitu fotografie 0-100 a vrať flagy jako Rozmazané, Ostré, Šum apod." }
                ]
            },
            config: { responseMimeType: 'application/json' }
        });
        return safeJsonParse<QualityAssessment>(response.text, 'Quality assessment failed');
    });
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

// Standardní inpainting: celá fotka + maska v jednom podporovaném API volání.
// Odmítnutí modelu se respektuje stejně jako u prompt retuše.
export const retouchWithMask = async (file: File, maskBase64: string): Promise<{ file: File }> => {
    const maskBbox = await findMaskBoundingBox(maskBase64);
    if (!maskBbox) {
        throw new Error('EMPTY_MASK');
    }

    return withRetry(async () => {
        const ai = getGenAI();
        const base64Image = await fileToBase64(file);
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Image, mimeType: file.type } },
                    { inlineData: { data: maskBase64, mimeType: 'image/png' } },
                    { text: 'The second image is a mask. White areas mark regions to retouch. Remove or fix content in white mask areas using intelligent inpainting. Match surrounding texture and lighting. Result must look natural. Return ONLY the edited image.' }
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
