import { describe, expect, it } from 'vitest';
import { mapAiError, getAiErrorMessage, describeAiError } from '../services/aiErrors';

describe('mapAiError', () => {
  it('mapuje chybějící/neplatný API klíč', () => {
    expect(mapAiError(new Error('API_KEY_MISSING'))).toBe('API_KEY_MISSING');
    expect(mapAiError(new Error('Invalid API key provided'))).toBe('API_KEY_MISSING');
  });

  it('mapuje safety block', () => {
    expect(mapAiError(new Error('SAFETY_BLOCKED: IMAGE_SAFETY'))).toBe('SAFETY_BLOCKED');
    expect(mapAiError(new Error('SAFETY_BLOCKED: model refused'))).toBe('SAFETY_BLOCKED');
  });

  it('mapuje rate limit / kvótu', () => {
    expect(mapAiError(new Error('429 Too Many Requests'))).toBe('RATE_LIMITED');
    expect(mapAiError(new Error('Quota exceeded'))).toBe('RATE_LIMITED');
    expect(mapAiError(new Error('RESOURCE_EXHAUSTED'))).toBe('RATE_LIMITED');
  });

  it('mapuje neplatnou odpověď a síť', () => {
    expect(mapAiError(new Error('Culling verdict failed: Invalid JSON from AI'))).toBe('INVALID_RESPONSE');
    expect(mapAiError(new Error('fetch failed'))).toBe('NETWORK_ERROR');
  });

  it('mapuje prázdnou masku a fallback UNKNOWN', () => {
    expect(mapAiError(new Error('EMPTY_MASK'))).toBe('EMPTY_MASK');
    expect(mapAiError(new Error('something exploded'))).toBe('UNKNOWN');
    expect(mapAiError(undefined)).toBe('UNKNOWN');
  });
});

describe('getAiErrorMessage', () => {
  it('vrací lokalizované hlášky pro oba jazyky', () => {
    const cs = getAiErrorMessage('SAFETY_BLOCKED', 'cs');
    const en = getAiErrorMessage('SAFETY_BLOCKED', 'en');
    expect(cs).toMatch(/odmítla/);
    expect(en).toMatch(/declined/);
    expect(cs).not.toBe(en);
  });

  it('safety hláška říká, že originál zůstal, a nabízí ruční úpravy', () => {
    expect(getAiErrorMessage('SAFETY_BLOCKED', 'cs')).toMatch(/Původní fotografie zůstala/);
    expect(getAiErrorMessage('SAFETY_BLOCKED', 'cs')).toMatch(/ruční|masku/);
  });
});

describe('describeAiError', () => {
  it('vrací kód i hlášku', () => {
    const { code, message } = describeAiError(new Error('SAFETY_BLOCKED: X'), 'en');
    expect(code).toBe('SAFETY_BLOCKED');
    expect(message).toBe(getAiErrorMessage('SAFETY_BLOCKED', 'en'));
  });
});
