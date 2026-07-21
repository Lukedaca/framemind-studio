// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import type { CullingMetrics } from '../types';
import {
  getTasteProfile,
  isTasteReady,
  personalScore,
  recordTasteSample,
  resetTaste,
  tasteHintForAi,
} from '../services/tasteEngine';

const metrics: CullingMetrics = {
  hash: '',
  meanLuma: 0.5,
  sharpnessScore: 0.95,
  exposureScore: 0.9,
  highlightClipping: 0,
  shadowClipping: 0,
  contrastScore: 0.85,
  noiseScore: 0.9,
  compositionScore: 0.9,
};

describe('tasteEngine', () => {
  beforeEach(() => {
    localStorage.clear();
    resetTaste();
  });

  it('ignoruje review a aktivuje profil až po 12 Keep/Reject rozhodnutích', () => {
    recordTasteSample(metrics, 'review');
    expect(getTasteProfile().samples).toBe(0);

    for (let index = 0; index < 11; index += 1) recordTasteSample(metrics, 'reject');
    expect(isTasteReady()).toBe(false);
    expect(personalScore(metrics)).toBeNull();

    recordTasteSample(metrics, 'reject');
    expect(isTasteReady()).toBe(true);
    expect(personalScore(metrics)).not.toBeNull();
    expect(tasteHintForAi()).toContain('naučeno z 12');
  });

  it('reset vrátí profil do neutrálního stavu', () => {
    for (let index = 0; index < 12; index += 1) recordTasteSample(metrics, 'keep');
    expect(getTasteProfile().samples).toBe(12);
    resetTaste();
    expect(getTasteProfile().samples).toBe(0);
    expect(isTasteReady()).toBe(false);
  });
});
