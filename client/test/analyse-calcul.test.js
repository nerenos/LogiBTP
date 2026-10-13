import { describe, it, expect } from 'vitest';
import { calculerDocument } from '../src/calcul/index.js';
import { DEFINITION_DEMO, DOCUMENT_DEMO } from '../src/app/demo.js';
import { feuillesAnalyse, agreger, forcerMontant, paEcart, elementsAnalyse, modificationsElement } from '../src/app/analyse-calcul.js';

// Onglet Analyse : un montant saisi est atteint au centime après recalcul par le moteur (coefficients des feuilles,
// absorption de l'arrondi par les plus fortes lignes, ligne d'écart en dernier recours).

const calculer = (saisie) => calculerDocument({ ...saisie, taux_tva: DEFINITION_DEMO.taux_tva });
const saisieDemo = () => structuredClone({ ...DOCUMENT_DEMO, variables: DOCUMENT_DEMO.variables ?? [] });

function forcer(saisie, filtre, cle, cible) {
  const r = calculer(saisie);
  const c = Number(r.document.ent_coef_fa ?? 1);
  const groupe = feuillesAnalyse(r, saisie).filter(filtre);
  const res = forcerMontant(groupe, cle, cible, { coefFa: c });
  expect(res.erreur).toBeUndefined();
  const champ = cle === 'rev' ? 'lig_coef_fg' : 'lig_coef_benef';
  for (const l of saisie.lignes) if (res.coefs.has(l.lig_id)) l[champ] = res.coefs.get(l.lig_id).toString();
  if (res.ecart !== null) {
    const ref = groupe[0].ligne;
    saisie.lignes.push({ lig_id: 99999, lig_ent_id: 0, lig_parent_id: groupe[0].tranches[0] ?? null, lig_ordre: 999, lig_tyl_id: 3, lig_qte: 1,
      lig_pa: paEcart(cle, res.ecart, c).toString(), lig_coef_fg: 1, lig_coef_benef: 1, lig_nat_id: res.nature, lig_tva_id: ref.lig_tva_id ?? 1, lig_proprietes: {} });
  }
  const apres = calculer(saisie);
  return { res, agregat: agreger(feuillesAnalyse(apres, saisie).filter((f) => f.ligne.lig_id === 99999 || filtre(f)), Number(apres.document.ent_coef_fa ?? 1)) };
}

describe('Analyse des coefficients : montants forcés', () => {
  it('revient de la main-d\'œuvre forcé au centime', () => {
    const { agregat } = forcer(saisieDemo(), (f) => f.nature === 1, 'rev', 47000.37);
    expect(Math.round(agregat.rev * 100) / 100).toBe(47000.37);
  });

  it('PV avant frais annexes des matériaux forcé au centime', () => {
    const { agregat } = forcer(saisieDemo(), (f) => f.nature === 2, 'pv', 70000);
    expect(Math.round(agregat.pv * 100) / 100).toBe(70000);
  });

  it('prix client d\'une tranche forcé au centime', () => {
    const tranche = DOCUMENT_DEMO.lignes.find((l) => l.lig_tyl_id === 1 && /Électricité/.test(l.lig_libelle_html)).lig_id;
    const { agregat } = forcer(saisieDemo(), (f) => f.tranches.includes(tranche), 'client', 7000.01);
    expect(Math.round(agregat.client * 100) / 100).toBe(7000.01);
  });

  it("dernier recours : ligne d'écart quand le pas du coefficient dépasse le centime", () => {
    // qt × PA = 1 000 000 : un pas de coefficient de 0,000001 vaut 1 €, le centime n'est pas atteignable.
    const ligne = { lig_id: 1, lig_tyl_id: 3, lig_qte_totale: '10000', lig_pa: '100', lig_pr: '110', lig_pv: '132', lig_coef_fg: '1.1', lig_nat_id: 2 };
    const f = { ligne, saisie: ligne, prix: ligne, chaine: [ligne], hors: false, nature: 2, tranches: [] };
    const res = forcerMontant([f], 'rev', 1234567.89);
    expect(res.coefs.get(1).toString()).toBe('1.234568'); // coefficient le plus proche : 1 234 568
    expect(Number(res.ecart)).toBeCloseTo(-0.11, 6);
    expect(res.nature).toBe(2);
  });

  it('marges : brute sur le prix client, nette sans frais annexes ni prorata', () => {
    // 10 × (PA 100, PR 110, PV 132), FA 1,05, prorata 1,1, remise 0,95 sur la ligne vendue.
    const ligne = { lig_id: 1, lig_tyl_id: 3, lig_qte_totale: '10', lig_pa: '100', lig_pr: '110', lig_pv: '132', lig_coef_prorata: '1.1', lig_coef_remise: '0.95' };
    const a = agreger([{ ligne, saisie: ligne, prix: ligne, chaine: [ligne], hors: false, nature: 2, tranches: [] }], 1.05);
    expect(a.client).toBeCloseTo(1320 * 1.05 * 1.1 * 0.95, 6);
    expect(a.margeBrute).toBeCloseTo(1320 * 1.05 * 1.1 * 0.95 - 1000, 6);
    expect(a.margeNette).toBeCloseTo(1320 * 0.95 - 1100, 6);
    expect(a.tauxNette).toBeCloseTo((1320 * 0.95 - 1100) / (1320 * 0.95), 9);
  });

  it('montant impossible : erreur sans modification', () => {
    const r = calculer(saisieDemo());
    const res = forcerMontant(feuillesAnalyse(r, saisieDemo()).filter((f) => f.nature === 1), 'rev', -10);
    expect(res.erreur).toMatch(/trop faible/);
  });
});

describe('Analyse : éléments regroupés par code et libellé', () => {
  it("regroupe les composantes « Main-d'œuvre », signale les valeurs divergentes et réécrit le PA sur toutes les lignes", () => {
    const saisie = saisieDemo();
    const r = calculer(saisie);
    const groupes = elementsAnalyse(feuillesAnalyse(r, saisie));
    const mo = groupes.find((g) => g.libelle === "Main-d'œuvre");
    expect(mo.feuilles.length).toBeGreaterThan(90);
    expect(mo.valeurs.pa.divergent).toBe(false);
    expect(mo.valeurs.fg.divergent).toBe(false);
    // Les coefficients de bénéfice des éléments diffèrent d'un lot à l'autre (pose des fenêtres 1,4).
    expect(groupes.find((g) => g.libelle === 'Pose').valeurs.pa.min).toBe(38);
    const { modifs } = modificationsElement(mo, 'pa', 45);
    for (const l of saisie.lignes) Object.assign(l, modifs.get(l.lig_id) ?? {});
    const apres = elementsAnalyse(feuillesAnalyse(calculer(saisie), saisie)).find((g) => g.libelle === "Main-d'œuvre");
    expect(apres.valeurs.pa).toMatchObject({ min: 45, max: 45, divergent: false });
  });

  it('PR saisi : coefficient de frais généraux recalculé ligne à ligne', () => {
    const ligne = { lig_id: 1, lig_tyl_id: 3, lig_pa: '80' };
    const { modifs } = modificationsElement({ feuilles: [{ ligne }], libelle: 'x' }, 'pr', 100);
    expect(modifs.get(1)).toEqual({ lig_coef_fg: 1.25 });
  });
});
