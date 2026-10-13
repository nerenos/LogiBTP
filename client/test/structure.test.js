import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { completerRattachement, controlerIntervenants, FournisseurStructureMemoire } from '../src/app/structure/structure.js';
import { FONCTIONS_INTERVENANT } from '../src/app/structure/donnees.js';
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

  it('contrôle les intervenants comme le serveur (Intervenants.Controler)', () => {
    const f = FONCTIONS_INTERVENANT;
    expect(controlerIntervenants([{ fonction: 'CLIENT', per_id: 1 }, { fonction: 'SOUS_TRAITANT', per_id: 2, paiement_direct: true, montant_ht: 10 }], f, 'S')).toEqual([]);
    expect(controlerIntervenants([
      { fonction: 'PAYEUR', per_id: 1 }, { fonction: 'PAYEUR', ind_id: 3 }, { fonction: 'BC', per_id: 4, paiement_direct: true },
      { fonction: 'LIVRAISON', per_id: 5 }, { fonction: 'ARCHITECTE' }, { fonction: 'XX', per_id: 1 }, { fonction: 'SOUS_TRAITANT', per_id: 2, montant_ht: -1 },
    ], f, 'S')).toEqual([
      'Un seul intervenant « Payeur »', 'Intervenant 3 : paiement direct réservé aux sous-traitants',
      'Intervenant 4 : fonction « Contact de livraison » non proposée ici', 'Intervenant 5 : tiers ou contact à choisir',
      'Intervenant 6 : fonction inconnue', 'Intervenant 7 : montant négatif',
    ]);
    expect(controlerIntervenants([{ fonction: 'ARCHITECTE', per_id: 1 }], f, 'D')).toHaveLength(1);
  });

  it('réplique les fonctions de db/162_intervenants.sql', () => {
    const sql = fs.readFileSync(new URL('../../db/162_intervenants.sql', import.meta.url), 'utf8');
    const lignes = [...sql.matchAll(/^\('([A-Z_]+)', '((?:[^']|'')*)', '([STD])', (TRUE|FALSE), (TRUE|FALSE), (\d+)\)/gm)]
      .map((m) => ({ code: m[1], libelle: m[2].replace(/''/g, "'"), portee: m[3], unique: m[4] === 'TRUE', paiement_direct: m[5] === 'TRUE', ordre: Number(m[6]) }));
    expect(lignes).toEqual(FONCTIONS_INTERVENANT);
  });

  it("lit et remplace les intervenants d'une fiche hors ligne", async () => {
    const s = new FournisseurStructureMemoire({ annuaire: { personnes: [{ id: 14, raison_sociale: 'SCI Les Érables' }], individus: [{ id: 13, prenom: 'Paul', nom: 'Garnier' }] } });
    const g = s.geres('chantier');
    const { intervenants } = await g.lire({ id: 2 });
    expect(intervenants[0]).toMatchObject({ fonction: 'CLIENT', per_id: 14, tiers: 'SCI Les Érables', contact: 'Paul Garnier', principal: true });
    await expect(g.valider({ id: 2 }, { intervenants: [{ fonction: 'CLIENT', per_id: 1 }, { fonction: 'CLIENT', per_id: 2 }] })).rejects.toMatchObject({ code: 'VALIDATION' });
    await g.ecrire({ id: 2 }, { intervenants: [{ fonction: 'BC', per_id: 13 }] });
    expect((await g.lire({ id: 2 })).intervenants.map((x) => x.fonction)).toEqual(['BC']);
    expect((await s.intervenants('chantier', 1)).length).toBeGreaterThan(0);
  });
});
