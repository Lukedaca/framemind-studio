// Editor object-location regression, independent of local culling.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent }; },
  ThinkingLevel: { LOW: 'LOW' }, MediaResolution: { MEDIA_RESOLUTION_HIGH: 'HIGH' },
}));
vi.mock('../utils/apiKey', () => ({ getApiKey: () => 'test-api-key' }));
import { locateObjects } from '../services/geminiService';
const response = JSON.stringify({ objects: [{ label: 'tattoo', box_2d: [100, 200, 300, 400] }] });

describe('object location remains isolated from local culling', () => {
  beforeEach(() => generateContent.mockReset());
  it('preserves high-resolution location and pixel coordinates', async () => {
    generateContent.mockResolvedValueOnce({ text: response });
    expect(await locateObjects('data:image/jpeg;base64,AA==', 1000, 500, 'tattoo'))
      .toEqual([{ label: 'tattoo', box: { x0: 200, y0: 50, x1: 400, y1: 150 } }]);
    expect(generateContent.mock.calls[0][0].config.mediaResolution).toBe('HIGH');
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });
  it('preserves unavailable-model fallback', async () => {
    generateContent.mockRejectedValueOnce(Object.assign(new Error('model not found'), { status: 404 })).mockResolvedValueOnce({ text: response });
    await locateObjects('data:image/jpeg;base64,AA==', 1000, 500, 'tattoo');
    expect(generateContent.mock.calls.map(([r]) => r.model)).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash']);
  });
  it('preserves structured-output fallback and empty-query short circuit', async () => {
    expect(await locateObjects('data:image/jpeg;base64,AA==', 1000, 500, ' ')).toEqual([]);
    expect(generateContent).not.toHaveBeenCalled();
    generateContent.mockResolvedValueOnce({ text: 'not-json' }).mockResolvedValueOnce({ text: response });
    await locateObjects('data:image/jpeg;base64,AA==', 1000, 500, 'tattoo');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
