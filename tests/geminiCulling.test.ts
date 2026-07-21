import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

vi.mock('../utils/apiKey', () => ({
  getApiKey: () => 'test-api-key',
}));

import { getCullingVerdict } from '../services/geminiService';
import type { CullingMetrics } from '../types';

const metrics: CullingMetrics = {
  hash: '',
  meanLuma: 0.5,
  sharpnessScore: 0.8,
  exposureScore: 0.75,
  highlightClipping: 0,
  shadowClipping: 0,
  contrastScore: 0.7,
  noiseScore: 0.8,
  compositionScore: 0.72,
};

const responseText = JSON.stringify({
  decision: 'keep',
  genre: 'portrait',
  aiScore: 88,
  summary: 'Silný portrét.',
  reasons: ['Ostré oči'],
  risks: [],
});

describe('Gemini culling configuration', () => {
  beforeEach(() => {
    generateContent.mockReset();
  });

  it('používá Gemini 3.5, system instruction a adaptivní thinking', async () => {
    generateContent.mockResolvedValueOnce({ text: responseText });

    await getCullingVerdict('data:image/jpeg;base64,AA==', {
      filename: 'portrait.jpg',
      metrics,
      heuristicScore: 80,
      genre: 'portrait',
      faceCount: 1,
      eyeBlink: 0.12,
      taste: 'Tento fotograf vybírá přísněji.',
    });

    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe('gemini-3.5-flash');
    expect(request.config.systemInstruction).toContain('expert na fotografický culling');
    expect(request.config.systemInstruction).toContain('rozhoduje vrchol akce');
    expect(request.config.systemInstruction).toContain('selhává v tom, na čem v daném žánru záleží');
    expect(request.config.temperature).toBe(0);
    expect(request.config.thinkingConfig).toEqual({ thinkingBudget: -1 });
    expect(request.contents.parts[0].text).toContain('faces detected: 1');
    expect(request.contents.parts[0].text).toContain('Osobní profil vkusu');
  });

  it('při nedostupném 3.5 modelu použije 2.5 fallback', async () => {
    generateContent
      .mockRejectedValueOnce(Object.assign(new Error('model not found'), { status: 404 }))
      .mockResolvedValueOnce({ text: responseText });

    const verdict = await getCullingVerdict('data:image/jpeg;base64,AA==', {
      filename: 'portrait.jpg',
      metrics,
      heuristicScore: 80,
    });

    expect(verdict.decision).toBe('keep');
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      'gemini-3.5-flash',
      'gemini-2.5-flash',
    ]);
  });

  it('nevalidní strukturovaný výstup primárního modelu také přepne na fallback', async () => {
    generateContent
      .mockResolvedValueOnce({ text: 'not-json' })
      .mockResolvedValueOnce({ text: responseText });

    await getCullingVerdict('data:image/jpeg;base64,AA==', {
      filename: 'portrait.jpg',
      metrics,
      heuristicScore: 80,
    });

    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      'gemini-3.5-flash',
      'gemini-2.5-flash',
    ]);
  });
});
