import { describe, it, expect } from 'vitest';
import { fusionner, copieLocale, egal } from '../src/app/hors-ligne/fusion.js';

// Mode hors ligne, lot 4 : fusion à trois voies (départ, saisie locale, serveur) par entité et par champ.
const L = (id, parent, ordre, champs = {}) => ({ lig_id: id, lig_parent_id: parent, lig_ordre: ordre, lig_tyl_id: 2, lig_libelle_html: `Ligne ${id}`, lig_qte: '1', ...champs });
const doc = (champs = {}) => ({ ent_id: 9, ent_tyd_id: 1, ent_numero: 'DV-9', ent_version: 3, ent_std_id: 1, ent_objet: 'Départ', ent_tiers_id: 4, ...champs });
const contenu = (document, lignes, metres = []) => ({ document, lignes, metres, variables: [], ventilations: [] });

const depart = contenu(doc(), [L(1, null, 1), L(2, null, 2), L(3, 1, 1), L(4, null, 3)], [{ mtr_id: 7, mtr_lig_id: 2, mtr_script: 'Renvoyer 2' }]);

describe('fusion à trois voies', () => {
  it("prend d'office ce qui n'a changé que d'un côté", () => {
    const local = contenu(doc({ ent_objet: 'Maison Martin' }), [L(1, null, 1, { lig_qte: '5' }), L(2, null, 2), L(3, 1, 1), L(4, null, 3), L(-1, null, 4)], depart.metres);
    const serveur = contenu(doc({ ent_version: 4, ent_tiers_id: 8 }), [L(1, null, 1), L(2, null, 2, { lig_pv: '12', lig_pv_fixe: true }), L(3, 1, 1), L(4, null, 3), L(20, null, 4)], depart.metres);
    const { saisie, conflits, changements } = fusionner({ depart, local, serveur });
    expect(conflits).toEqual([]);
    expect(saisie.document).toMatchObject({ ent_version: 4, ent_objet: 'Maison Martin', ent_tiers_id: 8 });
    const l = new Map(saisie.lignes.map((x) => [x.lig_id, x]));
    expect(l.get(1).lig_qte).toBe('5');
    expect(l.get(2)).toMatchObject({ lig_pv: '12', lig_pv_fixe: true });
    expect([...l.keys()].sort((a, b) => a - b)).toEqual([-1, 1, 2, 3, 4, 20]);
    // Ordre renuméroté sous la racine : 1, 2, 4, puis les deux ajouts (ordre 4 : provisoire avant serveur).
    expect(saisie.lignes.filter((x) => x.lig_parent_id === null).sort((a, b) => a.lig_ordre - b.lig_ordre).map((x) => x.lig_id)).toEqual([1, 2, 4, -1, 20]);
    expect(changements.map((c) => `${c.table}:${c.id}:${c.nature}:${c.cote}`).sort()).toEqual(
      ['document:9:MODIFICATION:deux', 'lignes:-1:AJOUT:ici', 'lignes:1:MODIFICATION:ici', 'lignes:2:MODIFICATION:serveur', 'lignes:20:AJOUT:serveur'].sort());
  });

  it('signale le même champ changé des deux côtés et applique le choix', () => {
    const local = contenu(doc({ ent_objet: 'Ici' }), [L(1, null, 1, { lig_qte: '5' }), L(2, null, 2), L(3, 1, 1), L(4, null, 3)], depart.metres);
    const serveur = contenu(doc({ ent_objet: 'Là-bas', ent_version: 4 }), [L(1, null, 1, { lig_qte: '6' }), L(2, null, 2), L(3, 1, 1), L(4, null, 3)], depart.metres);
    const f = fusionner({ depart, local, serveur });
    expect(f.conflits.map((c) => [c.cle, c.local, c.serveur, c.choix])).toEqual([['document:9:ent_objet', 'Ici', 'Là-bas', 'local'], ['lignes:1:lig_qte', '5', '6', 'local']]);
    expect(f.saisie.document.ent_objet).toBe('Ici');
    const g = fusionner({ depart, local, serveur }, { choix: new Map([['lignes:1:lig_qte', 'serveur']]) });
    expect(g.saisie.lignes.find((x) => x.lig_id === 1).lig_qte).toBe('6');
    // Montant calculé différent : jamais un conflit (recalculé par le moteur).
    const h = fusionner({ depart, local: { ...local, lignes: local.lignes.map((x) => ({ ...x, lig_montant_ht: '1' })) }, serveur });
    expect(h.conflits.some((c) => c.champ === 'lig_montant_ht')).toBe(false);
  });

  it('suppression et modification croisées : ligne gardée, ré-identifiée si le serveur l’a supprimée', () => {
    // Ici : ligne 4 supprimée, ligne 2 modifiée (son métré suit) ; serveur : ligne 4 modifiée, ligne 2 supprimée.
    const local = contenu(doc(), [L(1, null, 1), L(2, null, 2, { lig_qte: '9' }), L(3, 1, 1)], [{ mtr_id: 7, mtr_lig_id: 2, mtr_script: 'Renvoyer 9' }]);
    const serveur = contenu(doc({ ent_version: 4 }), [L(1, null, 1), L(3, 1, 1), L(4, null, 3, { lig_qte: '4' })], []);
    const f = fusionner({ depart, local, serveur });
    expect(f.conflits.map((c) => [c.cle, c.nature, c.choix])).toEqual([['lignes:2:*', 'SUPPRIME_SERVEUR', 'local'], ['lignes:4:*', 'SUPPRIME_ICI', 'serveur']]);
    const gardee = f.saisie.lignes.find((x) => x.lig_qte === '9');
    expect(gardee.lig_id).toBeLessThan(0);
    expect(f.saisie.metres).toEqual([expect.objectContaining({ mtr_lig_id: gardee.lig_id, mtr_script: 'Renvoyer 9' })]);
    expect(f.saisie.metres[0].mtr_id).toBeLessThan(0);
    expect(f.saisie.lignes.some((x) => x.lig_id === 4)).toBe(true);
    // Choix inverses : ligne 2 abandonnée (et son métré), ligne 4 supprimée.
    const g = fusionner({ depart, local, serveur }, { choix: new Map([['lignes:2:*', 'serveur'], ['lignes:4:*', 'local']]) });
    expect(g.saisie.lignes.map((x) => x.lig_id).sort()).toEqual([1, 3]);
    expect(g.saisie.metres).toEqual([]);
  });

  it('restaure le parent supprimé sur le serveur d’une ligne ajoutée ici', () => {
    const local = contenu(doc(), [...depart.lignes, L(-5, 4, 1)], depart.metres);
    const serveur = contenu(doc({ ent_version: 4 }), depart.lignes.filter((x) => x.lig_id !== 4), depart.metres);
    const { saisie } = fusionner({ depart, local, serveur });
    const enfant = saisie.lignes.find((x) => x.lig_id === -5);
    const parent = saisie.lignes.find((x) => x.lig_id === enfant.lig_parent_id);
    expect(parent.lig_libelle_html).toBe('Ligne 4');
    expect(parent.lig_id).toBeLessThan(0);
  });

  it('sans version de départ, toute différence est un conflit', () => {
    const local = contenu(doc({ ent_objet: 'Ici' }), [L(1, null, 1)]);
    const serveur = contenu(doc({ ent_objet: 'Là-bas' }), [L(1, null, 1), L(2, null, 2)]);
    const f = fusionner({ depart: null, local, serveur });
    expect(f.conflits.map((c) => c.cle)).toEqual(['document:9:ent_objet', 'lignes:2:*']);
  });

  it('écraser : la saisie locale entière sur la version du serveur', () => {
    const local = contenu(doc({ ent_objet: 'Ici' }), [L(1, null, 1), L(4, null, 2)]);
    const serveur = contenu(doc({ ent_objet: 'Là-bas', ent_version: 5 }), [L(1, null, 1), L(30, null, 2)]);
    const { saisie } = fusionner({ depart, local, serveur }, { mode: 'ecraser' });
    expect(saisie.document).toMatchObject({ ent_objet: 'Ici', ent_version: 5 });
    expect(saisie.lignes.map((x) => x.lig_id)).toEqual([1, -1]);
  });

  it('copie en brouillon : tout en identifiants provisoires, sans numéro', () => {
    const c = copieLocale(depart, -99);
    expect(c.document).toMatchObject({ ent_id: -99, ent_numero: null, ent_version: 1, ent_objet: 'Départ', ent_std_id: 1 });
    expect(c.lignes.every((x) => x.lig_id < 0 && x.lig_ent_id === -99)).toBe(true);
    const parents = new Set(c.lignes.map((x) => x.lig_id));
    expect(c.lignes.every((x) => x.lig_parent_id === null || parents.has(x.lig_parent_id))).toBe(true);
    expect(parents.has(c.metres[0].mtr_lig_id)).toBe(true);
  });

  it('compare les valeurs comme les enregistrerait le serveur', () => {
    expect(egal('1.50', 1.5)).toBe(true);
    expect(egal(null, undefined)).toBe(true);
    expect(egal({ a: 1, b: [1] }, { b: [1], a: 1 })).toBe(true);
    expect(egal('', null)).toBe(false);
  });
});
