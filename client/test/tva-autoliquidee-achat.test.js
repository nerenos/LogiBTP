import { describe, it, expect } from 'vitest';
import { tvaAutoliqueeParDefaut } from '../src/app/comptes.js';
import { ReglesBtp } from '../src/app/editeur-btp.js';

// Lot 5 (plan ne-plus-utiliser-tva) : TVA autoliquidée par défaut sur les lignes d'un fournisseur intracommunautaire.
const taux = [
  { ttv_id: 1, ttv_code: 'T20', ttv_categorie: 'N', ttv_defaut: true },
  { ttv_id: 4, ttv_code: 'AL20', ttv_categorie: 'A' },
];
const base = { famille: 'A', tvaIntracom: true, comptabiliteActive: true, tauxTva: taux };

describe('taux autoliqué par défaut', () => {
  it('fournisseur intracommunautaire, Comptabilité active : taux autoliqué', () => {
    expect(tvaAutoliqueeParDefaut(base)).toBe(4);
  });
  it('Comptabilité inactive, fournisseur ordinaire ou pièce de vente : rien', () => {
    expect(tvaAutoliqueeParDefaut({ ...base, comptabiliteActive: false })).toBeNull();
    expect(tvaAutoliqueeParDefaut({ ...base, tvaIntracom: false })).toBeNull();
    expect(tvaAutoliqueeParDefaut({ ...base, famille: 'V' })).toBeNull();
  });
  it('aucun taux autoliqué paramétré : rien', () => {
    expect(tvaAutoliqueeParDefaut({ ...base, tauxTva: [taux[0]] })).toBeNull();
  });
});

describe('nouvelle ligne d\'achat', () => {
  const regles = (id) => { const r = new ReglesBtp(); r.tvaAutoliquee = () => id; return r; };
  it('prend le taux autoliqué, modifiable ensuite', () => {
    expect(regles(4).tauxParDefaut([], 1, taux, null)).toBe(4);
  });
  it('sans taux autoliqué : taux par défaut du paramétrage', () => {
    expect(regles(null).tauxParDefaut([], 1, taux, null)).toBe(1);
  });
  it('le taux explicite du document reste prioritaire', () => {
    expect(regles(4).tauxParDefaut([], 1, taux, { ent_tva_id: 1 })).toBe(1);
  });
});
