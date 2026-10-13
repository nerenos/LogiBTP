import { describe, it, expect } from 'vitest';
import { completerRattachement, FournisseurStructureMemoire } from '../src/app/structure/structure.js';
import { prochainCode, codeMarche } from '../src/app/fiches/fiche-structure.js';

describe('Structure des affaires', () => {
  it('propose le code suivant de l\'année', () => {
    expect(prochainCode('projet', ['PRJ-2026-001', 'PRJ-2026-004', 'PRJ-2025-009'], 2026)).toBe('PRJ-2026-005');
    expect(prochainCode('chantier', [], 2027)).toBe('CH-2027-001');
  });

  it('code un marché d\'après son chantier', () => {
    const ch = { id: 2, code: 'CH-2026-002' };
    expect(codeMarche(ch, [{ code: 'M-2026-002-1' }, { code: 'M-2026-003-1' }])).toBe('M-2026-002-2');
  });

  it('complète le rattachement : marché → chantier → affaire', () => {
    const refs = { chantiers: [{ id: 2, aff_id: 1 }], marches: [{ id: 5, cha_id: 2 }] };
    expect(completerRattachement({ ent_marche_id: 5 }, refs)).toEqual({ ent_projet_id: null, ent_affaire_id: 1, ent_chantier_id: 2, ent_marche_id: 5 });
    expect(completerRattachement({ ent_projet_id: 3 }, refs)).toEqual({ ent_projet_id: 3, ent_affaire_id: null, ent_chantier_id: null, ent_marche_id: null });
  });

  it('calcule le facturé et le reste à facturer des marchés (hors ligne)', () => {
    const docs = [
      { type_element: 'V_FACTURE_AVT', total_ht: 1000, ent_marche_id: 1 },
      { type_element: 'V_AVOIR', total_ht: 200, ent_marche_id: 1 },
      { type_element: 'V_DEVIS', total_ht: 5000, ent_marche_id: 1 },
    ];
    const s = new FournisseurStructureMemoire({ documents: () => docs });
    const m = s.lignesListe('marches').find((x) => x.id === 1);
    expect(m.facture_ht).toBe(800);
    expect(m.reste_a_facturer).toBe(Number(m.montant_ht) - 800);
  });
});
