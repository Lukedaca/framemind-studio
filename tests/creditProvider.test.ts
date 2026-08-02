// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalDemoCreditProvider, isBillingConnected } from '../services/creditProvider';

beforeEach(() => {
  localStorage.clear();
});

describe('LocalDemoCreditProvider', () => {
  it('billing není připojen — jen demo', () => {
    expect(isBillingConnected()).toBe(false);
  });

  it('nový profil startuje s 50 demo kredity', async () => {
    const provider = new LocalDemoCreditProvider();
    expect(await provider.getBalance()).toBe(50);
  });

  it('consume odečte při dostatku a vrátí true', async () => {
    const provider = new LocalDemoCreditProvider();
    expect(await provider.consume(10, 'test-op')).toBe(true);
    expect(await provider.getBalance()).toBe(40);
  });

  it('consume při nedostatku vrátí false a zůstatek nemění', async () => {
    const provider = new LocalDemoCreditProvider();
    expect(await provider.consume(1000, 'test-op')).toBe(false);
    expect(await provider.getBalance()).toBe(50);
  });

  it('addDemoCredits přičte demo kredity', async () => {
    const provider = new LocalDemoCreditProvider();
    expect(await provider.addDemoCredits(150)).toBe(200);
    expect(await provider.getBalance()).toBe(200);
  });

  it('záporné množství nic nepřičte', async () => {
    const provider = new LocalDemoCreditProvider();
    await provider.addDemoCredits(-30);
    expect(await provider.getBalance()).toBe(50);
  });
});
