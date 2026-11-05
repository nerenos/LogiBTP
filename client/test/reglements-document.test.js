import { describe, it, expect } from 'vitest';
import { ecartsEcheancier, echeancesSousPointe } from '../src/app/documents/reglements-document.js';

// Onglet Règlements de la page document : contrôles de l'échéancier modifié (jamais bloquants).
describe('échéancier modifié', () => {
  const echeances = [
    { id: 1, montant: '600', nature: 'NORMALE' },
    { id: 2, montant: '300', nature: 'NORMALE' },
    { id: null, montant: '100', nature: 'NORMALE' },
    { id: 3, montant: '50', nature: 'RETENUE' },
  ];

  it('écarts au net à payer et à la retenue', () => {
    expect(ecartsEcheancier(echeances, { netAPayer: '1000', retenue: '50' })).toEqual([]);
    expect(ecartsEcheancier(echeances, { netAPayer: '1100', retenue: '60' })).toEqual([
      { nature: 'NORMALE', ecart: '-100' }, { nature: 'RETENUE', ecart: '-10' },
    ]);
  });

  it('échéance ramenée sous son pointé : signalée avec son rang (nouvelle échéance et pointé nul ignorés)', () => {
    const etat = new Map([[1, { pointe: '700' }], [2, { pointe: '300' }], [3, { pointe: '0' }]]);
    expect(echeancesSousPointe(echeances, etat)).toEqual([{ rang: 1, montant: '600', pointe: '700' }]);
  });

  it('avoir : comparaison en valeur absolue', () => {
    const avoir = [{ id: 5, montant: '-200', nature: 'NORMALE' }];
    expect(echeancesSousPointe(avoir, new Map([[5, { pointe: '-250' }]]))).toEqual([{ rang: 1, montant: '-200', pointe: '-250' }]);
    expect(echeancesSousPointe(avoir, new Map([[5, { pointe: '-150' }]]))).toEqual([]);
  });
});
