// Kreditní abstrakce. Aktuálně existuje JEN lokální demo implementace —
// kredity žijí v localStorage, nejde o skutečný billing a UI to musí říkat
// (Demo kredity / Billing zatím není připojen). Žádné obchodní rozhodnutí
// nesmí spoléhat na hodnotu z localStorage.
//
// Budoucí serverový billing implementuje stejné rozhraní (CreditProvider)
// a nahradí demoCreditProvider v App.tsx — jediný integrační bod.

import { getUserProfile, updateCredits, checkIsAdmin } from './userProfileService';

export interface CreditProvider {
  getBalance(): Promise<number>;
  consume(amount: number, operation: string): Promise<boolean>;
  purchase?(productId: string): Promise<void>;
}

/** Serverový billing zatím neexistuje — vždy false. */
export const isBillingConnected = (): boolean => false;

export class LocalDemoCreditProvider implements CreditProvider {
  async getBalance(): Promise<number> {
    if (checkIsAdmin()) return 9999;
    return getUserProfile().credits;
  }

  async consume(amount: number, _operation: string): Promise<boolean> {
    if (checkIsAdmin()) return true;
    if (amount <= 0) return true;
    const balance = getUserProfile().credits;
    if (balance < amount) return false;
    updateCredits(-amount);
    return true;
  }

  /** Demo režim: přidá demo kredity bez jakékoli platby. */
  async addDemoCredits(amount: number): Promise<number> {
    return updateCredits(Math.max(0, amount));
  }
}

export const demoCreditProvider = new LocalDemoCreditProvider();
