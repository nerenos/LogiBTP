import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { completerRattachement, controlerIntervenants } from '../src/app/structure/structure.js';
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

  it('contrôle les intervenants comme le serveur (Intervenants.Controler)', () => {
    const f = FONCTIONS_INTERVENANT;
    expect(controlerIntervenants([{ fonction: 'CLIENT', per_id: 1 }, { fonction: 'SOUS_TRAITANT', per_id: 2, paiement_direct: true }], f, 'S')).toEqual([]);
    expect(controlerIntervenants([
      { fonction: 'PAYEUR', per_id: 1 }, { fonction: 'PAYEUR', ind_id: 3 }, { fonction: 'BC', per_id: 4, paiement_direct: true },
      { fonction: 'LIVRAISON', per_id: 5 }, { fonction: 'ARCHITECTE' }, { fonction: 'XX', per_id: 1 },
    ], f, 'S')).toEqual([
      'Un seul intervenant « Payeur »', 'Intervenant 3 : paiement direct réservé aux sous-traitants',
      'Intervenant 4 : fonction « Contact de livraison » non proposée ici', 'Intervenant 5 : tiers ou contact à choisir',
      'Intervenant 6 : fonction inconnue',
    ]);
    expect(controlerIntervenants([{ fonction: 'ARCHITECTE', per_id: 1 }], f, 'D')).toHaveLength(1);
  });

  it('réplique les fonctions de db/162_intervenants.sql', () => {
    const sql = fs.readFileSync(new URL('../../db/162_intervenants.sql', import.meta.url), 'utf8');
    const lignes = [...sql.matchAll(/^\('([A-Z_]+)', '((?:[^']|'')*)', '([STD])', (TRUE|FALSE), (TRUE|FALSE), (\d+)\)/gm)]
      .map((m) => ({ code: m[1], libelle: m[2].replace(/''/g, "'"), portee: m[3], unique: m[4] === 'TRUE', paiement_direct: m[5] === 'TRUE', ordre: Number(m[6]) }));
    expect(lignes).toEqual(FONCTIONS_INTERVENANT);
  });
});
