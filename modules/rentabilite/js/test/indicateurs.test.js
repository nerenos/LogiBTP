import { describe, it, expect } from 'vitest';
import { lignesDetail, valeursColonnes, anomalie, SENS, COUT, filtrerOrdre, regrouperFaits, INDICATEUR, COMPOSANTE } from '../src/index.js';

const A = (indicateur, nat_id, pa, pr, pv, { ordre_id = null, composante = COMPOSANTE.VENTE } = {}) => ({ ordre_id, nat_id, indicateur, composante, pa, pr, pv, heures: null, nb: 1 });
const NATURES = [
  { id: 2, code: 'MAT', libelle: 'Matériaux', groupe: 'MATERIAUX', groupe_libelle: 'Matériaux', groupe_ordre: 1 },
  { id: 11, code: 'MO_POSE', libelle: 'Pose', groupe: 'MO', groupe_libelle: "Main-d'œuvre", groupe_ordre: 2 },
];
// Chantier fictif du lot 1 (scénario de RentabiliteBtp rejoué sur une base de test).
const AGREGATS = [
  A(INDICATEUR.BUDGET, 2, 200, 220, 400, { ordre_id: 9002 }),
  A(INDICATEUR.BUDGET, 11, 300, 330, 600, { ordre_id: 9002 }),
  A(INDICATEUR.BUDGET, null, 0, 0, -100, { composante: COMPOSANTE.POSTE }),
  A(INDICATEUR.BUDGET_EXECUTION, 2, 300, 330, '454.545455', { ordre_id: 9002 }),
  A(INDICATEUR.ENGAGE, 2, 120, 132, 0, { ordre_id: 9002, composante: COMPOSANTE.ACHAT }),
  A(INDICATEUR.DEBOURSE, 2, 192, '211.2', 0, { ordre_id: 9002, composante: COMPOSANTE.ACHAT }),
  A(INDICATEUR.DEBOURSE, null, 20, 22, 0, { ordre_id: 9002, composante: COMPOSANTE.ACHAT }),
  A(INDICATEUR.FACTURE, 2, 0, 0, 160, { ordre_id: 9002 }),
];

describe('Détail d\'un chantier', () => {
  it('total en haut, regroupements, natures, non ventilé et postes', () => {
    const l = lignesDetail({ agregats: AGREGATS, natures: NATURES, cout: COUT.PR });
    expect(l.map((x) => x.type)).toEqual(['total', 'groupe', 'nature', 'groupe', 'nature', 'non_ventile', 'postes']);
    expect(l[0].valeurs.budget_pv.toString()).toBe('900');
    expect(l[0].valeurs.depense.toString()).toBe('365.2');
    expect(l[0].valeurs.reste_depenser.toString()).toBe('-35.2');
    expect(l[0].valeurs.reste_facturer.toString()).toBe('740');
    expect(l.find((x) => x.type === 'non_ventile').natures).toEqual([0]);
    expect(l.find((x) => x.type === 'postes').valeurs.budget_pv.toString()).toBe('-100');
  });

  it('PA ou PR sur les coûts, PV inchangé', () => {
    const pa = valeursColonnes(AGREGATS, COUT.PA);
    expect(pa.budget.toString()).toBe('500');
    expect(pa.budget_pv.toString()).toBe('900');
    expect(valeursColonnes(AGREGATS, COUT.PR).budget.toString()).toBe('550');
  });

  it('ordre : tout, sans ordre, un ordre', () => {
    expect(filtrerOrdre(AGREGATS, null)).toHaveLength(AGREGATS.length);
    expect(filtrerOrdre(AGREGATS, 0)).toHaveLength(1);
    expect(filtrerOrdre(AGREGATS, '9002')).toHaveLength(7);
  });

  it('montants anormaux selon le sens de la colonne', () => {
    expect(anomalie('-0.01', SENS.POSITIF)).toBe('negatif');
    expect(anomalie('0', SENS.POSITIF)).toBeNull();
    expect(anomalie('5', SENS.NEGATIF)).toBe('positif');
    expect(anomalie('-5', SENS.NEGATIF)).toBeNull();
    expect(anomalie('1', SENS.NUL)).toBe('non_nul');
    expect(anomalie('-3', SENS.LIBRE)).toBeNull();
  });
});

describe('Faits d\'un chiffre', () => {
  const faits = [
    { afa_ent_id: 1, afa_source_type: 'DOCUMENT', afa_montant_pa: '10', afa_montant_pr: '11', afa_montant_pv: '0', afa_heures: null },
    { afa_ent_id: 1, afa_source_type: 'DOCUMENT', afa_montant_pa: '5', afa_montant_pr: '5.5', afa_montant_pv: '0', afa_heures: null },
    { afa_ent_id: 2, afa_source_type: 'DOCUMENT', afa_montant_pa: '-10', afa_montant_pr: '-11', afa_montant_pv: '0', afa_heures: null },
    { afa_ent_id: null, afa_source_type: 'POINTAGE', afa_montant_pa: '30', afa_montant_pr: '33', afa_montant_pv: '0', afa_heures: '1.5' },
  ];
  const pieces = { 1: { annulee: false }, 2: { annulee: true } };

  it('sous-totaux par pièce, annulées masquées mais comptées', () => {
    const r = regrouperFaits(faits, pieces);
    expect(r.groupes.map((g) => g.cle)).toEqual(['p1', 'sPOINTAGE']);
    expect(r.groupes[0].totaux.pa.toString()).toBe('15');
    expect(r.masques).toBe(1);
    expect(r.total.pa.toString()).toBe('35');
    expect(regrouperFaits(faits, pieces, { annulees: true }).groupes).toHaveLength(3);
  });

  it('un total par indicateur quand le chiffre en mêle plusieurs', () => {
    const avecIndicateurs = faits.map((f, i) => ({ ...f, afa_indicateur: i < 3 ? INDICATEUR.ENGAGE : INDICATEUR.DEBOURSE }));
    const r = regrouperFaits(avecIndicateurs, pieces);
    expect(r.parIndicateur.map((x) => [x.indicateur, x.totaux.pa.toString()])).toEqual([[INDICATEUR.ENGAGE, '5'], [INDICATEUR.DEBOURSE, '30']]);
    expect(regrouperFaits(avecIndicateurs.slice(0, 2), pieces).parIndicateur).toEqual([]);
  });
});
