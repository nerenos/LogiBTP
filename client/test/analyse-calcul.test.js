import { describe, it, expect } from 'vitest';
import { calculerDocument } from '../src/calcul/index.js';
import { DEFINITION_DEMO, DOCUMENT_DEMO } from '../src/app/demo.js';
import { feuillesAnalyse, agreger, forcerMontant, paEcart, elementsAnalyse, modificationsElement, repartirQuantite } from '../src/app/analyse-calcul.js';

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

describe("Analyse : quantité totale d'un groupe d'éléments reventilée", () => {
  it("reventile au prorata, quantités des composantes ramenées à l'unité de l'ouvrage", () => {
    const saisie = saisieDemo();
    const r = calculer(saisie);
    const groupe = elementsAnalyse(feuillesAnalyse(r, saisie)).find((g) => g.libelle === "Main-d'œuvre");
    const avant = groupe.qt;
    const res = repartirQuantite(groupe, 1000, r);
    expect(res.erreur).toBeUndefined();
    for (const l of saisie.lignes) if (res.qtes.has(l.lig_id)) l.lig_qte = res.qtes.get(l.lig_id);
    const apres = elementsAnalyse(feuillesAnalyse(calculer(saisie), saisie)).find((g) => g.libelle === "Main-d'œuvre");
    expect(Math.abs(apres.qt - 1000)).toBeLessThan(0.0005);
    // Prorata conservé (à l'arrondi près) : la plus forte ligne reste la plus forte.
    const part = (g, f) => Number(f.ligne.lig_qte_totale) / g.qt;
    const max = (g) => g.feuilles.reduce((m, f) => (Number(f.ligne.lig_qte_totale) > Number(m.ligne.lig_qte_totale) ? f : m));
    expect(max(apres).ligne.lig_id).toBe(max(groupe).ligne.lig_id);
    expect(part(apres, max(apres))).toBeCloseTo(part(groupe, max(groupe)), 3);
    expect(avant).not.toBe(1000);
  });

  it("une ligne issue d'un métré prend la quantité saisie (métré désactivé)", () => {
    const saisie = saisieDemo();
    const r = calculer(saisie);
    const murs = feuillesAnalyse(r, saisie).find((f) => f.saisie.lig_qte_source === 'M');
    const res = repartirQuantite({ feuilles: [murs], libelle: 'murs' }, 60, r);
    expect(res.metres).toBe(1);
    const l = saisie.lignes.find((x) => x.lig_id === murs.ligne.lig_id);
    Object.assign(l, { lig_qte: res.qtes.get(l.lig_id), lig_qte_source: 'S' });
    const apres = calculer(saisie).lignes.find((x) => x.lig_id === l.lig_id);
    expect(Number(apres.lig_qte_totale)).toBe(60);
    expect(l.lig_mtr_id).toBe(100); // métré conservé, désactivé
  });

  it('quantité totale avec coefficient de perte et quantité de l’ouvrage parent', () => {
    // Béton C25/30 : 0,15 m³ par m² de dalle (120 m²), perte 1,05, précision 4.
    const saisie = saisieDemo();
    const r = calculer(saisie);
    const groupe = elementsAnalyse(feuillesAnalyse(r, saisie)).find((g) => g.libelle === 'Béton C25/30');
    expect(groupe.qt).toBeCloseTo(0.1575 * 120, 6); // quantité totale affichée : perte et ouvrage compris
    const res = repartirQuantite(groupe, 20, r);
    const id = groupe.feuilles[0].ligne.lig_id;
    // 20 / 120 / 1,05 = 0,15873 → 0,1587 donne 19,992 m³ ; 0,1588 donne 20,004 m³, plus proche : retenu.
    expect(res.qtes.get(id)).toBeCloseTo(0.1588, 4);
    for (const l of saisie.lignes) if (res.qtes.has(l.lig_id)) l.lig_qte = res.qtes.get(l.lig_id);
    const apres = elementsAnalyse(feuillesAnalyse(calculer(saisie), saisie)).find((g) => g.libelle === 'Béton C25/30');
    expect(Math.abs(apres.qt - 20)).toBeLessThan((0.0001 * 120) / 2); // au plus un demi-pas (précision × quantité de l'ouvrage)
  });
});
