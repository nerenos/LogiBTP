import { describe, it, expect } from 'vitest';
import { PressePapiersBtp } from '../src/app/editeur-btp.js';

// Copier-coller de lignes : les clés de ventilation des frais annexes sont recréées sur les nouvelles lignes.

const saisie = () => ({
  document: { ent_id: 5 },
  lignes: [
    { lig_id: 1, lig_parent_id: null, lig_tyl_id: 11, lig_ordre: 1 },
    { lig_id: 2, lig_parent_id: 1, lig_tyl_id: 1, lig_ordre: 1, lig_type_prix: 'F' },
    { lig_id: 3, lig_parent_id: 2, lig_tyl_id: 3, lig_ordre: 1 },
    { lig_id: 4, lig_parent_id: 1, lig_tyl_id: 3, lig_ordre: 2 },
    { lig_id: 5, lig_parent_id: 1, lig_tyl_id: 3, lig_ordre: 3 },
  ],
  metres: [],
  variables: [],
  ventilations: [
    { vfr_id: 10, vfr_ent_id: 5, vfr_source_lig_id: 2, vfr_cible: 'LIGNE', vfr_lig_id: 4, vfr_element: null, vfr_nat_id: null, vfr_mode: 'P', vfr_valeur: 40 },
    { vfr_id: 11, vfr_ent_id: 5, vfr_source_lig_id: 2, vfr_cible: 'NATURE', vfr_lig_id: null, vfr_element: null, vfr_nat_id: 3, vfr_mode: 'P', vfr_valeur: 20 },
    { vfr_id: 12, vfr_ent_id: 5, vfr_source_lig_id: null, vfr_cible: 'NATURE', vfr_lig_id: null, vfr_element: null, vfr_nat_id: 4, vfr_mode: 'P', vfr_valeur: 10 },
  ],
});

const coller = (s, ids, cible) => {
  const pp = new PressePapiersBtp();
  const copie = pp.renumeroter(pp.extraire(s, ids, { entId: s.document.ent_id, coupe: false }), -100);
  cible.lignes.push(...copie.lignes);
  pp.insererComplements(cible, copie);
  return copie;
};

describe('Presse-papiers BTP : clés de ventilation', () => {
  it('ligne copiée dans le même document : nouvelle clé sur la même tranche de frais', () => {
    const s = saisie();
    const copie = coller(s, [4], s);
    const nouvelle = s.ventilations.find((k) => k.vfr_lig_id === copie.racines[0]);
    expect(nouvelle).toMatchObject({ vfr_source_lig_id: 2, vfr_cible: 'LIGNE', vfr_mode: 'P', vfr_valeur: 40, vfr_ent_id: 5 });
    expect(nouvelle.vfr_id).toBeLessThan(0);
    expect(nouvelle).not.toHaveProperty('_source_externe');
    expect(s.ventilations).toHaveLength(4);
  });

  it('ligne copiée dans un autre document : la clé de la tranche restée dans l\'origine n\'est pas reprise', () => {
    const autre = { document: { ent_id: 9 }, lignes: [{ lig_id: 2, lig_parent_id: null, lig_tyl_id: 1 }], metres: [], variables: [] };
    coller(saisie(), [4], autre);
    expect(autre.ventilations ?? []).toEqual([]);
  });

  it('section copiée avec sa tranche de frais : clés renumérotées vers les copies, clé globale inchangée', () => {
    const s = saisie();
    const autre = { document: { ent_id: 9 }, lignes: [], metres: [], variables: [] };
    const copie = coller(s, [1], autre);
    const id = (ancien) => copie.lignes[s.lignes.findIndex((l) => l.lig_id === ancien)].lig_id;
    expect(autre.ventilations.map((k) => [k.vfr_source_lig_id, k.vfr_cible, k.vfr_lig_id, k.vfr_nat_id, k.vfr_ent_id])).toEqual([
      [id(2), 'LIGNE', id(4), null, 9],
      [id(2), 'NATURE', null, 3, 9],
    ]);
  });

  it('tranche de frais copiée sans ses lignes visées : seules ses clés d\'élément et de nature suivent', () => {
    const s = saisie();
    const copie = coller(s, [2], s);
    const recues = s.ventilations.filter((k) => k.vfr_source_lig_id === copie.racines[0]);
    expect(recues.map((k) => [k.vfr_cible, k.vfr_nat_id])).toEqual([['NATURE', 3]]);
  });
});
