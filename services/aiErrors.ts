// Centrální mapování chyb Gemini na bezpečné, lokalizované uživatelské hlášky.
// Nikdy nelogovat obsah fotografie ani celý prompt — jen kód chyby.

import type { Language } from '../types';

export type AiErrorCode =
  | 'API_KEY_MISSING'
  | 'RATE_LIMITED'
  | 'SAFETY_BLOCKED'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'EMPTY_MASK'
  | 'UNKNOWN';

export function mapAiError(error: unknown): AiErrorCode {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();

  if (message.includes('API_KEY_MISSING') || lower.includes('invalid api key') || lower.includes('api key')) {
    return 'API_KEY_MISSING';
  }
  if (message.startsWith('SAFETY_BLOCKED:')) return 'SAFETY_BLOCKED';
  if (message.startsWith('EMPTY_MASK')) return 'EMPTY_MASK';
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota') || lower.includes('resource_exhausted')) {
    return 'RATE_LIMITED';
  }
  if (lower.includes('invalid json') || lower.includes('empty response') || lower.includes('no content')) {
    return 'INVALID_RESPONSE';
  }
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('failed to load') || lower.includes('timeout')) {
    return 'NETWORK_ERROR';
  }
  return 'UNKNOWN';
}

const MESSAGES: Record<AiErrorCode, Record<Language, string>> = {
  API_KEY_MISSING: {
    cs: 'Chybí nebo je neplatný API klíč. Nastav ho v Nastavení API klíče.',
    en: 'API key is missing or invalid. Set it in the API key settings.',
  },
  RATE_LIMITED: {
    cs: 'API limit vyčerpán. Počkej chvíli a zkus to znovu.',
    en: 'API rate limit reached. Wait a moment and try again.',
  },
  SAFETY_BLOCKED: {
    cs: 'AI tuto úpravu odmítla kvůli bezpečnostním pravidlům poskytovatele. Původní fotografie zůstala beze změny — použij ruční úpravy nebo masku.',
    en: 'The AI declined this edit due to the provider\'s safety policy. Your original photo is unchanged — use manual edits or the mask tool instead.',
  },
  INVALID_RESPONSE: {
    cs: 'AI vrátila neplatnou odpověď. Zkus to znovu.',
    en: 'The AI returned an invalid response. Please try again.',
  },
  NETWORK_ERROR: {
    cs: 'Chyba sítě při komunikaci s AI. Zkontroluj připojení.',
    en: 'Network error while contacting the AI. Check your connection.',
  },
  EMPTY_MASK: {
    cs: 'Maska je prázdná. Namaluj štětcem přes oblast k retuši a zkus to znovu.',
    en: 'The mask is empty. Paint over the area to retouch and try again.',
  },
  UNKNOWN: {
    cs: 'AI operace se nepovedla. Zkus to znovu.',
    en: 'The AI operation failed. Please try again.',
  },
};

export function getAiErrorMessage(code: AiErrorCode, language: Language): string {
  return MESSAGES[code][language] ?? MESSAGES[code].en;
}

export function describeAiError(error: unknown, language: Language): { code: AiErrorCode; message: string } {
  const code = mapAiError(error);
  return { code, message: getAiErrorMessage(code, language) };
}
