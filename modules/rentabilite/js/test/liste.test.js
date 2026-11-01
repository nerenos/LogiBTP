import { describe, it, expect } from 'vitest';
import { arbreListe, lignesListe, clesJusqua, valeursColonnes, lignesDetail, COLONNES_LISTE, COUT, INDICATEUR, COMPOSANTE, NIVEAU_LISTE, arrondiAffiche } from '../src/index.js';

const A = (cha_id, indicateur, pa, pr, pv, { ordre_id = null, composante = COMPOSANTE.VENTE, heures = null, periode = null } = {}) => ({
  cha_id, ordre_id, indicateur, composante, pa, pr, pv, heures,
  pa_periode: periode?.pa ?? 0, pr_periode: periode?.pr ?? 0, pv_periode: periode?.pv ?? 0, heures_periode: periode?.heures ?? null,
});
const CHANTIERS = [
  { id: 1, code: 'CH1', libelle: 'Maison', affaire_id: null, charge_id: 7, charge: 'Alice Martin' },
  { id: 2, code: 'CH2', libelle: 'Bât. A', affaire_id: 10, affaire_code: 'AFF1', affaire: 'Résidence', charge_id: 7, charge: 'Alice Martin' },
  { id: 3, code: 'CH3', libelle: 'Bât. B', affaire_id: 10, affaire_code: 'AFF1', affaire: 'Résidence', charge_id: null },
];
const AGREGATS = [
  A(1, INDICATEUR.BUDGET, 100, 110, 200),
  A(2, INDICATEUR.BUDGET, 500, 550, 1000, { ordre_id: 90, periode: { pa: 500, pr: 550, pv: 1000 } }),
  A(2, INDICATEUR.ENGAGE, 120, 132, 0, { ordre_id: 90, composante: COMPOSANTE.ACHAT }),
  A(2, INDICATEUR.DEBOURSE, 200, 220, 0, { composante: COMPOSANTE.MO, heures: 8, periode: { pa: 50, pr: 55, heures: 2 } }),
  A(2, INDICATEUR.FACTURE, 0, 0, 400, { ordre_id: 90, periode: { pv: 100 } }),
  A(2, INDICATEUR.ACOMPTE_PAYE, 0, 0, 300),
  A(2, INDICATEUR.ACOMPTE_UTILISE, 0, 0, 120),
  A(3, INDICATEUR.BUDGET, 10, 11, 20),
  A(99, INDICATEUR.BUDGET, 1, 1, 1), // chantier hors de la liste : ignoré
];
const ORDRES = [{ cha_id: 2, id: 90, numero: 'OE-1', libelle: 'Gros œuvre' }];

describe('Liste multi-origine', () => {
  it('affaire › chantier › ordre, sans affaire en dernier, total en pied', () => {
    const r = arbreListe({ chantiers: CHANTIERS, agregats: AGREGATS, ordres: ORDRES, niveau: NIVEAU_LISTE.AFFAIRE });
    expect(r.enfants.map((n) => n.type + n.cle)).toEqual(['affaireaffaire10', 'affaireaffaire0']);
    expect(r.valeurs.budget_pv.toString()).toBe('1220');
    const ch2 = r.enfants[0].enfants[0];
    expect(ch2.enfants.map((n) => n.type)).toEqual(['ordre', 'sans_ordre']);
    expect(ch2.enfants[0].libelle).toBe('OE-1 – Gros œuvre');
    expect(ch2.enfants[1].valeurs.debourse.toString()).toBe('220');
    expect(r.enfants[1].enfants[0].enfants).toEqual([]); // chantier sans ordre : pas de détail
  });

  it('chargé d\'affaires › affaire › chantier, clés uniques par chargé', () => {
    const r = arbreListe({ chantiers: CHANTIERS, agregats: AGREGATS, ordres: ORDRES, niveau: NIVEAU_LISTE.CHARGE });
    expect(r.enfants.map((n) => n.libelle)).toEqual(['Alice Martin', expect.any(String)]);
    expect(r.enfants[0].enfants.map((n) => n.cle)).toEqual(['ch7-affaire10', 'ch7-affaire0']);
    expect(r.enfants[1].enfants.map((n) => n.cle)).toEqual(['ch0-affaire10']);
    expect(r.enfants[0].chantiers).toEqual([1, 2]);
  });

  it('acomptes, rapports et heures', () => {
    const v = arbreListe({ chantiers: CHANTIERS, agregats: AGREGATS, ordres: ORDRES }).valeurs;
    expect(v.acompte_reste.toString()).toBe('180');
    expect(v.heures.toString()).toBe('8');
    expect(arrondiAffiche(v.pct_facture, 2).toString()).toBe('32.79');
    expect(arrondiAffiche(v.pct_depense, 0)).toBeNull(); // pas de budget d'exécution
  });

  it('période : flux sur la période, engagé et restes au cumul', () => {
    const v = valeursColonnes(AGREGATS.filter((a) => a.cha_id === 2), COUT.PR, { periode: true, colonnes: COLONNES_LISTE });
    expect(v.budget_pv.toString()).toBe('1000');
    expect(v.facture.toString()).toBe('100');
    expect(v.debourse.toString()).toBe('55');
    expect(v.heures.toString()).toBe('2');
    expect(v.engage.toString()).toBe('132');
    expect(v.depense.toString()).toBe('352'); // cumul : 132 + 220
    expect(v.reste_facturer.toString()).toBe('600'); // cumul : 1000 − 400
  });

  it('lignes ouvertes et ouverture jusqu\'aux chantiers', () => {
    const r = arbreListe({ chantiers: CHANTIERS, agregats: AGREGATS, ordres: ORDRES });
    expect(lignesListe(r).length).toBe(2);
    const ouverts = new Set(clesJusqua(r, 'affaire'));
    const l = lignesListe(r, ouverts);
    expect(l.map((x) => `${x.profondeur}${x.type}`)).toEqual(['0affaire', '1chantier', '1chantier', '0affaire', '1chantier']);
    expect(l[1].feuille).toBe(false);
    expect(lignesListe(r, new Set([...ouverts, 'c2'])).length).toBe(7);
  });

  it('production : réalisé sans acomptes, FAE et PCA au cumul', () => {
    const faits = [
      A(2, INDICATEUR.FACTURE, 0, 0, 400, { periode: { pv: 100 } }),
      A(2, INDICATEUR.FACTURE, 0, 0, 200, { composante: COMPOSANTE.ACOMPTE }),
      A(2, INDICATEUR.PRODUCTION, 0, 0, 550, { periode: { pv: 60 } }),
      A(3, INDICATEUR.FACTURE, 0, 0, 300),
      A(3, INDICATEUR.PRODUCTION, 0, 0, 250),
    ];
    const v2 = valeursColonnes(faits.filter((a) => a.cha_id === 2), COUT.PR, { colonnes: COLONNES_LISTE });
    expect(v2.realise.toString()).toBe('400');
    expect(v2.fae.toString()).toBe('150');
    expect(v2.pca.toString()).toBe('0');
    const v3 = valeursColonnes(faits.filter((a) => a.cha_id === 3), COUT.PR, { colonnes: COLONNES_LISTE });
    expect(v3.pca.toString()).toBe('50');
    const p2 = valeursColonnes(faits.filter((a) => a.cha_id === 2), COUT.PR, { colonnes: COLONNES_LISTE, periode: true });
    expect(p2.production.toString()).toBe('60');
    expect(p2.fae.toString()).toBe('150');
  });

  it('le Détail ignore les acomptes', () => {
    const l = lignesDetail({ agregats: AGREGATS.filter((a) => a.cha_id === 2).map((a) => ({ ...a, nat_id: null })), natures: [] });
    expect(l.map((x) => x.type)).toEqual(['total', 'non_ventile']);
  });
});
