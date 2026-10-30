import { describe, it, expect } from 'vitest';
import { ReglesDocument } from '../ui/regles.js';
import { TL } from '../src/index.js';

// Taux de TVA de la saisie : taux d'une tranche imposé à sa descendance, taux par défaut du document.
describe('TVA de la saisie', () => {
  const taux = [{ ttv_id: 4, ttv_code: 'AL20' }, { ttv_id: 1, ttv_code: 'T20', ttv_defaut: true }, { ttv_id: 2, ttv_code: 'T10' }];
  const L = (lig_id, lig_parent_id, lig_tyl_id, lig_tva_id = null) => ({ lig_id, lig_parent_id, lig_tyl_id, lig_ordre: lig_id, lig_tva_id });
  const brouillon = () => ({
    document: { ent_tva_id: null },
    lignes: [L(1, null, TL.TITRE, 1), L(2, 1, TL.ELEMENT, 1), L(3, 1, TL.TITRE, 2), L(4, 3, TL.ELEMENT, 2),
      L(5, 3, TL.OUVRAGE, 1), L(6, 5, TL.ELEMENT), L(7, null, TL.ELEMENT, 1), L(8, null, TL.PIED_HT, 1)],
  });
  const regles = new ReglesDocument();
  const tva = (b) => Object.fromEntries(b.lignes.map((l) => [l.lig_id, l.lig_tva_id]));

  it('le taux modifié d\'un titre est imposé à ses sous-titres et à ses lignes de prix, pas aux composantes', () => {
    const b = brouillon();
    b.lignes[0].lig_tva_id = 2;
    regles.apresModification(b, 1, 'lig_tva_id');
    expect(tva(b)).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: null, 7: 1, 8: 1 });
  });

  it('un titre sans taux ne change pas sa descendance', () => {
    const b = brouillon();
    b.lignes[0].lig_tva_id = null;
    regles.apresModification(b, 1, 'lig_tva_id');
    expect(tva(b)).toMatchObject({ 2: 1, 3: 2, 4: 2 });
  });

  it('taux par défaut : titre, puis document, puis paramétrage, puis le premier', () => {
    const b = brouillon();
    expect(regles.tauxParDefaut(b.lignes, 4, taux, b.document)).toBe(2);
    expect(regles.tauxParDefaut(b.lignes, 7, taux, b.document)).toBe(1);
    expect(regles.tauxParDefaut(b.lignes, 7, taux, { ent_tva_id: 2 })).toBe(2);
    expect(regles.tauxParDefaut(b.lignes, 7, taux, { ent_tva_id: 99 })).toBe(1);
    expect(regles.tauxParDefaut(b.lignes, 7, taux.map(({ ttv_defaut, ...t }) => t))).toBe(4);
  });

  it('le taux du document est imposé aux titres et aux lignes de prix, pas aux composantes ni au pied', () => {
    const b = brouillon();
    regles.appliquerTauxDocument(b, 2);
    expect(tva(b)).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: null, 7: 2, 8: 1 });
  });
});
