// Měření spotřeby AI za běh cullingu. Bez čísel z reálného provozu je jakákoli
// optimalizace jen odhad — tenhle modul sbírá usageMetadata z každé odpovědi
// a spočítá odhad ceny podle sazeb konkrétního modelu.
//
// Ceny jsou v USD za 1M tokenů, podle https://ai.google.dev/gemini-api/docs/pricing.
// Thinking tokeny účtuje Gemini jako výstup, takže spadají pod output sazbu.

export interface ModelRate {
  input: number;
  output: number;
  cachedInput: number;
}

// Ověřeno 2026-08-01. Neznámý model se počítá jako nejdražší známý Flash, aby
// odhad radši nadstřelil než uživatele příjemně překvapil špatným směrem.
export const MODEL_RATES: Record<string, ModelRate> = {
  'gemini-3.6-flash': { input: 1.5, output: 7.5, cachedInput: 0.15 },
  'gemini-3.5-flash': { input: 1.5, output: 9.0, cachedInput: 0.15 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cachedInput: 0.03 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cachedInput: 0.03 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cachedInput: 0.01 },
};

const FALLBACK_RATE: ModelRate = { input: 1.5, output: 9.0, cachedInput: 0.15 };

export function rateForModel(model: string): ModelRate {
  return MODEL_RATES[model] || FALLBACK_RATE;
}

/** Tvar, který vrací @google/genai v response.usageMetadata. */
export interface RawUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
}

export interface UsageTotals {
  calls: number;
  promptTokens: number;
  outputTokens: number; // odpověď + thinking, tak jak se účtuje
  thoughtTokens: number; // podmnožina outputTokens, jen pro diagnostiku
  cachedTokens: number; // podmnožina promptTokens účtovaná levněji
  costUsd: number;
  byModel: Record<string, number>; // model → počet volání
}

function emptyTotals(): UsageTotals {
  return {
    calls: 0,
    promptTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
    byModel: {},
  };
}

let totals = emptyTotals();
const listeners = new Set<(snapshot: UsageTotals) => void>();

function num(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

/**
 * Spočítá cenu jednoho volání. Cachovaná část promptu se účtuje zvlášť nižší
 * sazbou, proto se od běžného vstupu odečítá.
 */
export function estimateCallCost(model: string, usage: RawUsageMetadata): number {
  const rate = rateForModel(model);
  const cached = num(usage.cachedContentTokenCount);
  const prompt = Math.max(0, num(usage.promptTokenCount) - cached);
  // thoughtsTokenCount bývá vykázaný mimo candidatesTokenCount — účtuje se jako výstup.
  const output = num(usage.candidatesTokenCount) + num(usage.thoughtsTokenCount);

  return (prompt * rate.input + cached * rate.cachedInput + output * rate.output) / 1_000_000;
}

export function recordUsage(model: string, usage: RawUsageMetadata | undefined): void {
  if (!usage) return;

  const cached = num(usage.cachedContentTokenCount);
  totals = {
    calls: totals.calls + 1,
    promptTokens: totals.promptTokens + num(usage.promptTokenCount),
    outputTokens:
      totals.outputTokens + num(usage.candidatesTokenCount) + num(usage.thoughtsTokenCount),
    thoughtTokens: totals.thoughtTokens + num(usage.thoughtsTokenCount),
    cachedTokens: totals.cachedTokens + cached,
    costUsd: totals.costUsd + estimateCallCost(model, usage),
    byModel: { ...totals.byModel, [model]: (totals.byModel[model] || 0) + 1 },
  };

  for (const listener of listeners) listener(totals);
}

export function getUsageTotals(): UsageTotals {
  return totals;
}

export function resetUsage(): void {
  totals = emptyTotals();
  for (const listener of listeners) listener(totals);
}

export function subscribeUsage(listener: (snapshot: UsageTotals) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
