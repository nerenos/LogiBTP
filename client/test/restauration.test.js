import { describe, it, expect } from 'vitest';
import { saisieRestauree } from '../src/app/documents/restauration.js';

// Restauration d'une version précédente d'un document : instantané de l'historique posé sur la saisie courante.
const L = (id, parent, ordre, champs = {}) => ({ lig_id: id, lig_parent_id: parent, lig_ordre: ordre, lig_tyl_id: 3, lig_libelle_html: `Ligne ${id}`, ...champs });

const courante = {
  document: { ent_id: 5, ent_tyd_id: 1, ent_numero: 'DV-5', ent_version: 7, ent_std_id: 2, ent_indice: 'B', ent_objet: 'Aujourd\'hui', ent_champ_recent: 'x' },
  lignes: [L(1, null, 1, { lig_libelle_html: 'Nouveau libellé', lig_champ_recent: 'y' }), L(3, null, 2)],
  metres: [], variables: [], ventilations: [{ vfr_id: 8, vfr_ent_id: 5, vfr_source_lig_id: 3, vfr_cible: 'LIGNE', vfr_lig_id: 1 }],
  echeances: [{ ech_rang: 1 }],
};
const instantane = {
  document: { ent_id: 5, ent_tyd_id: 1, ent_numero: 'DV-4', ent_version: 4, ent_std_id: 1, ent_indice: 'A', ent_objet: 'Version 4' },
  lignes: [L(1, null, 1, { lig_libelle_html: 'Ancien libellé' }), L(2, 1, 1)],
  metres: [{ mtr_id: 6, mtr_lig_id: 2, mtr_script: 'Renvoyer 3' }],
  variables: [],
  ventilations: [{ vfr_id: 9, vfr_ent_id: 5, vfr_source_lig_id: null, vfr_cible: 'LIGNE', vfr_lig_id: 2 }],
};

describe('saisieRestauree', () => {
  const s = saisieRestauree(instantane, courante);

  it("garde l'identité actuelle du document et reprend les champs saisis de la version", () => {
    expect(s.document).toMatchObject({ ent_id: 5, ent_numero: 'DV-5', ent_version: 7, ent_std_id: 2, ent_indice: 'B', ent_objet: 'Version 4' });
    // Champ absent de l'instantané (ajouté depuis) : valeur actuelle.
    expect(s.document.ent_champ_recent).toBe('x');
  });

  it('remplace les lignes, recrée en provisoire celles supprimées depuis et retire les nouvelles', () => {
    const ids = s.lignes.map((l) => l.lig_id);
    expect(ids).toContain(1);
    expect(ids).not.toContain(3);
    expect(s.lignes.find((l) => l.lig_id === 1)).toMatchObject({ lig_libelle_html: 'Ancien libellé', lig_champ_recent: 'y' });
    const recreee = s.lignes.find((l) => l.lig_id < 0);
    expect(recreee).toMatchObject({ lig_parent_id: 1, lig_libelle_html: 'Ligne 2', lig_ent_id: 5 });
  });

  it('suit les références des compléments vers les lignes recréées', () => {
    const recreee = s.lignes.find((l) => l.lig_id < 0).lig_id;
    expect(s.metres).toEqual([expect.objectContaining({ mtr_lig_id: recreee, mtr_script: 'Renvoyer 3' })]);
    expect(s.metres[0].mtr_id).toBeLessThan(0);
    expect(s.ventilations).toEqual([expect.objectContaining({ vfr_lig_id: recreee, vfr_ent_id: 5 })]);
    expect(s.ventilations[0].vfr_id).toBeLessThan(0);
  });

  it('instantané sans compléments (version ancienne) : tables vides', () => {
    const r = saisieRestauree({ document: { ent_objet: 'Vide' }, lignes: [] }, courante);
    expect(r.lignes).toEqual([]);
    expect(r.ventilations).toEqual([]);
    expect(r.document.ent_numero).toBe('DV-5');
  });
});
