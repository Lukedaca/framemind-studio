import { describe, expect, it } from 'vitest';

import {
  buildAutopilotPrompt,
  MAX_AUTOPILOT_INSTRUCTION_LENGTH,
  normalizeAutopilotInstruction,
} from '../services/aiAutopilot';

describe('AI Autopilot custom instruction', () => {
  it('ke standardnímu autopilotu nepřidává vlastní zadání', () => {
    const prompt = buildAutopilotPrompt('portrait');

    expect(prompt).toContain('Přirozené pleťové tóny');
    expect(prompt).not.toContain('Přesně proveď zadání fotografa');
    expect(prompt).toContain('Vrať pouze upravenou fotografii');
  });

  it('dá přesnému zadání fotografa přednost a chrání ostatní části snímku', () => {
    const instruction = 'Zesvětli obličej, odstraň kelímek vlevo a neměň kompozici.';
    const prompt = buildAutopilotPrompt('cinematic', instruction);

    expect(prompt).toContain(JSON.stringify(instruction));
    expect(prompt).toContain('Zadání fotografa má před automatickým režimem přednost');
    expect(prompt).toContain('Měň jen to, co zadání výslovně požaduje');
    expect(prompt).toContain('Vrať pouze upravenou fotografii bez vysvětlení');
  });

  it('zadání ořízne na bezpečnou délku a odstraní okolní mezery', () => {
    const normalized = normalizeAutopilotInstruction(`  ${'x'.repeat(900)}  `);

    expect(normalized).toHaveLength(MAX_AUTOPILOT_INSTRUCTION_LENGTH);
    expect(normalized).toBe('x'.repeat(MAX_AUTOPILOT_INSTRUCTION_LENGTH));
  });
});
