import { describe, expect, it } from 'vitest';
import {
  computeFinalScore,
  deriveHeuristicDecision,
  computeSimilarityGroups,
  computeSetSharpnessContext,
  classifySharpness,
  selectAiCandidates,
  getVerdictSource,
  reconcileAiDecision,
  AUDIT_MIN,
  AUDIT_MAX,
  SHARPNESS_CONTEXT_MIN_SAMPLES,
  SIMILARITY_EXACT_LIMIT,
  type SimilarityInput,
} from '../utils/cullingEngine';
import type { CullingMetrics, CullingResult } from '../types';

const metrics = (overrides: Partial<CullingMetrics> = {}): CullingMetrics => ({
  hash: '',
  meanLuma: 0.5,
  sharpnessScore: 0.8,
  exposureScore: 0.8,
  highlightClipping: 0,
  shadowClipping: 0,
  contrastScore: 0.7,
  noiseScore: 0.8,
  compositionScore: 0.7,
  nativeSharpness: 0,
  ...overrides,
});

describe('ostrost v kontextu sady', () => {
  const evenSet = Array.from({ length: 20 }, (_, i) => 900 + i * 10); // 900–1090

  it('vyrovnaná sada nevyřadí nic — práh je relativní, ne kvóta', () => {
    const context = computeSetSharpnessContext(evenSet);
    expect(context).not.toBeNull();

    for (const value of evenSet) {
      expect(classifySharpness(value, context)).toBe('normal');
    }
  });

  it('snímek výrazně měkčí než sada je vada, mírně měkčí je riziko', () => {
    const context = computeSetSharpnessContext(evenSet)!;
    // medián ≈ 995 → soft pod ~448, bad pod ~219
    expect(classifySharpness(150, context)).toBe('bad');
    expect(classifySharpness(300, context)).toBe('soft');
    expect(classifySharpness(800, context)).toBe('normal');
  });

  it('hlásí rozsah a počty pod prahem, aby šlo poznat proč se nic nevyřadilo', () => {
    // 18 vyrovnaných snímků + 2 zjevně měkké
    const withOutliers = [...evenSet, 120, 300];
    const context = computeSetSharpnessContext(withOutliers)!;

    expect(context.min).toBe(120);
    expect(context.max).toBe(1090);
    expect(context.badCount).toBe(1); // jen 120 je pod ~0,22 mediánu
    expect(context.softCount).toBe(2); // 120 i 300 jsou pod ~0,45 mediánu
    expect(context.p10).toBeLessThan(context.median);

    // Vyrovnaná sada nesmí hlásit nic pod prahem — to je signál pro UI.
    const evenContext = computeSetSharpnessContext(evenSet)!;
    expect(evenContext.softCount).toBe(0);
    expect(evenContext.badCount).toBe(0);
  });

  it('u malé sady se relativní pravidlo vypne', () => {
    const tooFew = evenSet.slice(0, SHARPNESS_CONTEXT_MIN_SAMPLES - 1);
    expect(computeSetSharpnessContext(tooFew)).toBeNull();
    expect(classifySharpness(1, null)).toBe('unknown');
  });

  it('nezměřená ostrost nikdy nevyrobí vadu', () => {
    const context = computeSetSharpnessContext(evenSet)!;
    expect(classifySharpness(0, context)).toBe('unknown');
    expect(classifySharpness(undefined, context)).toBe('unknown');
  });

  it('měkký snímek propadne na reject i s jinak slušným skóre', () => {
    const context = computeSetSharpnessContext(evenSet)!;
    const good = metrics({ nativeSharpness: 1000 });
    const soft = metrics({ nativeSharpness: 100 });

    // Stejné skóre i žánr, liší se jen ostrost proti sadě.
    const keepDecision = deriveHeuristicDecision(good, 80, 'sport', { sharpnessContext: context });
    const rejectDecision = deriveHeuristicDecision(soft, 80, 'sport', { sharpnessContext: context });

    expect(keepDecision.decision).toBe('keep');
    expect(rejectDecision.decision).toBe('reject');
    expect(rejectDecision.risks).toContain('cull_risk_soft_vs_set');
  });

  it('bez kontextu se chová jako dřív — žádná regrese na starých datech', () => {
    const soft = metrics({ nativeSharpness: 100 });
    expect(deriveHeuristicDecision(soft, 80, 'sport', {}).decision).toBe('keep');
  });

  it('AI "keep" nepřebije měření na plném rozlišení', () => {
    const context = computeSetSharpnessContext(evenSet)!;
    const result = {
      metrics: metrics({ nativeSharpness: 100 }),
      finalScore: 80,
      decision: 'reject',
      reasons: [],
      risks: [],
      aspectRatio: 1.5,
      aiStatus: 'idle',
      genre: 'sport',
    } as unknown as CullingResult;

    const verdict = {
      decision: 'keep',
      genre: 'sport',
      aiScore: 85,
      summary: '',
      reasons: [],
      risks: [],
    } as CullingResult['ai'] & { decision: 'keep' };

    const reconciled = reconcileAiDecision(result, verdict as never, context);
    expect(reconciled.decision).toBe('review');
    expect(reconciled.disagreement).toBe(true);
  });
});

describe('computeFinalScore', () => {
  it('kvalitní fotka skóruje vysoko, rozmazaná nízko', () => {
    const good = computeFinalScore(metrics(), 'other');
    const blurry = computeFinalScore(metrics({ sharpnessScore: 0.1 }), 'other');
    expect(good).toBeGreaterThan(70);
    expect(blurry).toBeLessThan(good);
  });

  it('clipping penalizuje skóre', () => {
    const clean = computeFinalScore(metrics(), 'landscape');
    const clipped = computeFinalScore(metrics({ highlightClipping: 0.1 }), 'landscape');
    expect(clipped).toBeLessThan(clean);
  });

  it('žánr mění váhy (šum bolí produktovku víc než sport)', () => {
    const noisy = metrics({ noiseScore: 0.05 });
    const product = computeFinalScore(noisy, 'product');
    const sport = computeFinalScore(noisy, 'sport');
    expect(product).toBeLessThan(sport);
  });

  it('neznámý/null žánr padá na other', () => {
    expect(computeFinalScore(metrics(), null)).toBe(computeFinalScore(metrics(), 'other'));
  });
});

describe('deriveHeuristicDecision', () => {
  it('silná fotka bez rizik = keep', () => {
    const m = metrics({ sharpnessScore: 0.9, exposureScore: 0.85, compositionScore: 0.8 });
    const decision = deriveHeuristicDecision(m, computeFinalScore(m, 'other'), 'other', {});
    expect(decision.decision).toBe('keep');
    expect(decision.reasons).toContain('cull_reason_sharp');
  });

  it('velká neostrost = major risk = reject', () => {
    const m = metrics({ sharpnessScore: 0.1 });
    const decision = deriveHeuristicDecision(m, computeFinalScore(m, 'other'), 'other', {});
    expect(decision.decision).toBe('reject');
    expect(decision.risks).toContain('cull_risk_blur');
  });

  it('slabší člen duplicity bez rizik = review, se slabým skóre = reject', () => {
    const solid = metrics({ sharpnessScore: 0.7, exposureScore: 0.7 });
    const solidScore = computeFinalScore(solid, 'other');
    const inGroup = deriveHeuristicDecision(solid, solidScore, 'other', {
      duplicateGroupId: 'G1',
      isBestInGroup: false,
    });
    expect(inGroup.decision).toBe('review');

    const weakInGroup = deriveHeuristicDecision(solid, 40, 'other', {
      duplicateGroupId: 'G1',
      isBestInGroup: false,
    });
    expect(weakInGroup.decision).toBe('reject');
  });

  it('zavřené oči jsou major risk u portrétu, ne u sportu', () => {
    const m = metrics({ sharpnessScore: 0.9, exposureScore: 0.85, compositionScore: 0.8 });
    const portrait = deriveHeuristicDecision(m, computeFinalScore(m, 'portrait'), 'portrait', {
      faceCount: 1,
      eyeBlink: 0.8,
    });
    const sport = deriveHeuristicDecision(m, computeFinalScore(m, 'sport'), 'sport', {
      faceCount: 1,
      eyeBlink: 0.8,
    });
    expect(portrait.decision).toBe('reject');
    expect(portrait.risks).toContain('cull_risk_closed_eyes');
    expect(sport.risks).not.toContain('cull_risk_closed_eyes');
  });
});

describe('reconcileAiDecision', () => {
  const verdict = {
    decision: 'keep' as const,
    genre: 'portrait' as const,
    aiScore: 90,
    summary: '',
    reasons: [],
    risks: [],
  };

  it('extrémní technický fail + AI keep posílá do review', () => {
    const result: CullingResult = {
      metrics: metrics({ sharpnessScore: 0.1 }),
      finalScore: 35,
      decision: 'reject',
      reasons: [],
      risks: ['cull_risk_blur'],
      aspectRatio: 1.5,
      aiStatus: 'pending',
    };
    expect(reconcileAiDecision(result, verdict)).toEqual({ decision: 'review', disagreement: true });
  });

  it('běžný AI verdikt zůstává autoritativní', () => {
    const result: CullingResult = {
      metrics: metrics({ sharpnessScore: 0.3 }),
      finalScore: 40,
      decision: 'reject',
      reasons: [],
      risks: [],
      aspectRatio: 1.5,
      aiStatus: 'pending',
    };
    expect(reconcileAiDecision(result, verdict)).toEqual({ decision: 'keep', disagreement: false });
  });
});

describe('selectAiCandidates', () => {
  const item = (id: string, decision: 'keep' | 'review' | 'reject', finalScore: number) => ({
    id,
    decision,
    finalScore,
  });

  it('safe mode posílá do AI všechno včetně rejectů', () => {
    const items = [item('a', 'keep', 80), item('b', 'reject', 20), item('c', 'review', 55)];
    const selection = selectAiCandidates(items, 'safe');
    expect(selection.candidateIds).toEqual(['a', 'b', 'c']);
    expect(selection.skippedRejectIds).toEqual([]);
    expect(selection.auditIds).toEqual([]);
  });

  it('economy mode audituje 5–20 (~10 %) rejectů, zbytek přeskočí', () => {
    const items = [
      ...Array.from({ length: 30 }, (_, i) => item(`r${String(i).padStart(2, '0')}`, 'reject' as const, i)),
      item('keep1', 'keep', 90),
    ];
    const selection = selectAiCandidates(items, 'economy');
    expect(selection.auditIds.length).toBe(AUDIT_MIN); // round(30*0.1)=3 → min 5
    expect(selection.skippedRejectIds.length).toBe(30 - AUDIT_MIN);
    expect(selection.candidateIds).toContain('keep1');
    for (const id of selection.auditIds) expect(selection.candidateIds).toContain(id);
    for (const id of selection.skippedRejectIds) expect(selection.candidateIds).not.toContain(id);
  });

  it('economy: méně než 5 rejectů = audit všech', () => {
    const items = [item('r1', 'reject', 10), item('r2', 'reject', 20), item('k', 'keep', 90)];
    const selection = selectAiCandidates(items, 'economy');
    expect(selection.auditIds.sort()).toEqual(['r1', 'r2']);
    expect(selection.skippedRejectIds).toEqual([]);
  });

  it('economy: audit má strop 20', () => {
    const items = Array.from({ length: 500 }, (_, i) =>
      item(`r${String(i).padStart(3, '0')}`, 'reject' as const, i % 42)
    );
    const selection = selectAiCandidates(items, 'economy');
    expect(selection.auditIds.length).toBe(AUDIT_MAX);
  });

  it('výběr je deterministický', () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      item(`r${String(i).padStart(3, '0')}`, 'reject' as const, (i * 7) % 100)
    );
    const first = selectAiCandidates(items, 'economy');
    const second = selectAiCandidates(items, 'economy');
    expect(first).toEqual(second);
  });
});

describe('getVerdictSource', () => {
  const base: CullingResult = {
    metrics: metrics(),
    finalScore: 70,
    decision: 'keep',
    reasons: [],
    risks: [],
    aspectRatio: 1.5,
    aiStatus: 'idle',
  };

  it('rozlišuje manual > ai > heuristic', () => {
    expect(getVerdictSource(base)).toBe('heuristic');
    expect(
      getVerdictSource({
        ...base,
        aiStatus: 'done',
        ai: { decision: 'keep', genre: 'other', aiScore: 80, summary: '', reasons: [], risks: [] },
      })
    ).toBe('ai');
    expect(getVerdictSource({ ...base, manualDecision: 'reject' })).toBe('manual');
    expect(getVerdictSource(undefined)).toBeNull();
  });
});

// --- Similarity groups ---

const HASH_LENGTH = 256;

const zeroHash = () => '0'.repeat(HASH_LENGTH);

const flipBits = (hash: string, positions: number[]): string => {
  const chars = hash.split('');
  for (const position of positions) {
    chars[position] = chars[position] === '0' ? '1' : '0';
  }
  return chars.join('');
};

// Deterministický PRNG pro syntetickou velkou sadu.
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const randomHash = (rng: () => number) =>
  Array.from({ length: HASH_LENGTH }, () => (rng() < 0.5 ? '0' : '1')).join('');

const input = (id: string, hash: string, finalScore: number, aspectRatio = 1.5): SimilarityInput => ({
  id,
  hash,
  aspectRatio,
  finalScore,
});

describe('computeSimilarityGroups', () => {
  it('identické hashe skončí ve skupině, vítěz podle skóre', () => {
    const groups = computeSimilarityGroups([
      input('a', zeroHash(), 60),
      input('b', zeroHash(), 90),
    ]);
    expect(groups.get('a')?.duplicateGroupId).toBeDefined();
    expect(groups.get('a')?.duplicateGroupId).toBe(groups.get('b')?.duplicateGroupId);
    expect(groups.get('b')?.isBestInGroup).toBe(true);
    expect(groups.get('a')?.isBestInGroup).toBe(false);
  });

  it('podobné hashe (≤20 bitů) grupuje, vzdálené (>20 bitů) ne', () => {
    const near = flipBits(zeroHash(), [1, 30, 77, 130, 200]);
    const far = flipBits(zeroHash(), Array.from({ length: 30 }, (_, i) => i * 8));
    const groups = computeSimilarityGroups([
      input('base', zeroHash(), 80),
      input('near', near, 70),
      input('far', far, 60),
    ]);
    expect(groups.get('base')?.duplicateGroupId).toBeDefined();
    expect(groups.get('base')?.duplicateGroupId).toBe(groups.get('near')?.duplicateGroupId);
    expect(groups.get('far')?.duplicateGroupId).toBeUndefined();
  });

  it('odlišný poměr stran zabrání grupování i při shodném hashi', () => {
    const groups = computeSimilarityGroups([
      input('landscape', zeroHash(), 80, 1.5),
      input('square', zeroHash(), 70, 1.0),
    ]);
    expect(groups.get('landscape')?.duplicateGroupId).toBeUndefined();
    expect(groups.get('square')?.duplicateGroupId).toBeUndefined();
  });

  it('velká syntetická sada (LSH cesta) najde všechny páry', () => {
    const rng = mulberry32(42);
    const items: SimilarityInput[] = [];
    const pairCount = 600; // 1200 fotek > SIMILARITY_EXACT_LIMIT
    for (let i = 0; i < pairCount; i += 1) {
      const base = randomHash(rng);
      const twin = flipBits(base, [3, 47, 101, 199, 250]);
      const id = String(i).padStart(4, '0');
      items.push(input(`p${id}a`, base, 80));
      items.push(input(`p${id}b`, twin, 60));
    }
    expect(items.length).toBeGreaterThan(SIMILARITY_EXACT_LIMIT);

    const groups = computeSimilarityGroups(items);
    for (let i = 0; i < pairCount; i += 1) {
      const id = String(i).padStart(4, '0');
      const a = groups.get(`p${id}a`);
      const b = groups.get(`p${id}b`);
      expect(a?.duplicateGroupId, `pár ${id}`).toBeDefined();
      expect(a?.duplicateGroupId).toBe(b?.duplicateGroupId);
      expect(a?.isBestInGroup).toBe(true);
    }
    // Náhodné hashe se navzájem negrupují — počet skupin = počet párů.
    const groupIds = new Set(
      Array.from(groups.values())
        .map((assignment) => assignment.duplicateGroupId)
        .filter(Boolean)
    );
    expect(groupIds.size).toBe(pairCount);
  });

  it('výsledek je deterministický', () => {
    const rng = mulberry32(7);
    const items: SimilarityInput[] = [];
    for (let i = 0; i < 550; i += 1) {
      const base = randomHash(rng);
      const id = String(i).padStart(4, '0');
      items.push(input(`x${id}`, base, (i * 13) % 100));
      items.push(input(`y${id}`, flipBits(base, [5, 60]), (i * 17) % 100));
    }
    const first = computeSimilarityGroups(items);
    const second = computeSimilarityGroups(items);
    expect(first).toEqual(second);
  });
});
