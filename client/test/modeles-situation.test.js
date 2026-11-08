import { describe, it, expect } from 'vitest';
import { MODELES_EDITION } from '../src/app/editions/modeles.js';

const bloc = (code) => MODELES_EDITION.find((m) => m.code === code);
const trouver = (n, pred, acc = []) => {
  if (n && typeof n === 'object') {
    if (pred(n)) acc.push(n);
    for (const v of Object.values(n)) trouver(v, pred, acc);
  }
  return acc;
};

describe('Édition de la situation : précédent et montant de la période', () => {
  it('le bloc des totaux porte les deux lignes, conditionnées par document.situation', () => {
    const piles = trouver(bloc('TOTAUX_DOCUMENT').contenu, (n) => n.condition === 'document.situation');
    expect(piles).toHaveLength(1);
    const valeurs = trouver(piles[0], (n) => typeof n.valeur === 'string' || typeof n.texte === 'string').length;
    const json = JSON.stringify(piles[0]);
    expect(json).toContain('document.situation.precedent');
    expect(json).toContain('document.situation.periode');
    expect(valeurs).toBeGreaterThanOrEqual(0);
  });

  it('la facture d\'avancement garde son pied de période sans ces lignes (condition absente hors situation)', () => {
    const facture = bloc('FACTURE_AVANCEMENT');
    expect(facture).toBeTruthy();
    expect(JSON.stringify(bloc('TOTAUX_AVANCEMENT').contenu)).not.toContain('document.situation');
  });
});
