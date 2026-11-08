import { describe, it, expect } from 'vitest';
import { reprendreCoutMoyen } from '../src/app/ressources/cout-moyen.js';

describe('reprise du coût par heure comme coût moyen', () => {
  it('confirmée : la fiche reçoit le coût', async () => {
    let appels = 0;
    expect(await reprendreCoutMoyen({ confirmer: async () => true, reprendre: async () => { appels++; }, message: 'm' })).toBe(true);
    expect(appels).toBe(1);
  });
  it('annulée : fiche inchangée', async () => {
    let appels = 0;
    expect(await reprendreCoutMoyen({ confirmer: async () => false, reprendre: async () => { appels++; }, message: 'm' })).toBe(false);
    expect(appels).toBe(0);
  });
});
