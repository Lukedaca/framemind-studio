import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  estimateCallCost,
  getUsageTotals,
  rateForModel,
  recordUsage,
  resetUsage,
  subscribeUsage,
} from '../services/aiUsage';

describe('aiUsage', () => {
  beforeEach(() => {
    resetUsage();
  });

  it('počítá cenu podle sazby modelu a odděluje cachovaný vstup', () => {
    // 1000 vstupních tokenů, z toho 400 cachovaných, 200 výstupních.
    // 3.6 Flash: (600 * 1.5 + 400 * 0.15 + 200 * 7.5) / 1e6
    const cost = estimateCallCost('gemini-3.6-flash', {
      promptTokenCount: 1000,
      cachedContentTokenCount: 400,
      candidatesTokenCount: 200,
    });

    expect(cost).toBeCloseTo((600 * 1.5 + 400 * 0.15 + 200 * 7.5) / 1_000_000, 12);
  });

  it('účtuje thinking tokeny výstupní sazbou', () => {
    const withoutThinking = estimateCallCost('gemini-3.6-flash', {
      promptTokenCount: 100,
      candidatesTokenCount: 100,
    });
    const withThinking = estimateCallCost('gemini-3.6-flash', {
      promptTokenCount: 100,
      candidatesTokenCount: 100,
      thoughtsTokenCount: 500,
    });

    expect(withThinking - withoutThinking).toBeCloseTo((500 * 7.5) / 1_000_000, 12);
  });

  it('3.6 Flash vyjde na výstupu levněji než 3.5 Flash', () => {
    const usage = { promptTokenCount: 1000, candidatesTokenCount: 1000 };
    expect(estimateCallCost('gemini-3.6-flash', usage)).toBeLessThan(
      estimateCallCost('gemini-3.5-flash', usage)
    );
  });

  it('neznámý model spadne na nejdražší známou sazbu, ne na nulu', () => {
    const rate = rateForModel('gemini-neexistuje');
    expect(rate.output).toBe(9.0);
    expect(estimateCallCost('gemini-neexistuje', { candidatesTokenCount: 1000 })).toBeGreaterThan(0);
  });

  it('sčítá volání napříč modely a drží počty podle modelu', () => {
    recordUsage('gemini-3.6-flash', { promptTokenCount: 100, candidatesTokenCount: 50 });
    recordUsage('gemini-3.6-flash', {
      promptTokenCount: 200,
      candidatesTokenCount: 60,
      thoughtsTokenCount: 40,
    });
    recordUsage('gemini-3.5-flash', { promptTokenCount: 300, candidatesTokenCount: 70 });

    const totals = getUsageTotals();
    expect(totals.calls).toBe(3);
    expect(totals.promptTokens).toBe(600);
    expect(totals.outputTokens).toBe(50 + 60 + 40 + 70);
    expect(totals.thoughtTokens).toBe(40);
    expect(totals.byModel).toEqual({ 'gemini-3.6-flash': 2, 'gemini-3.5-flash': 1 });
    expect(totals.costUsd).toBeGreaterThan(0);
  });

  it('chybějící usageMetadata běh nerozbije ani nezapočítá', () => {
    recordUsage('gemini-3.6-flash', undefined);
    expect(getUsageTotals().calls).toBe(0);
  });

  it('reset vynuluje součty a upozorní odběratele', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUsage(listener);

    recordUsage('gemini-3.6-flash', { promptTokenCount: 100, candidatesTokenCount: 50 });
    expect(listener).toHaveBeenCalledTimes(1);

    resetUsage();
    expect(getUsageTotals().calls).toBe(0);
    expect(getUsageTotals().costUsd).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    recordUsage('gemini-3.6-flash', { promptTokenCount: 100, candidatesTokenCount: 50 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
