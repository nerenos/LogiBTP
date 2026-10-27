import { describe, it, expect } from 'vitest';
import { valeursArticle, contenuOuvrage, prixArticle } from '../src/app/bibliotheque/appel.js';
import { calculerOuvrage } from '../src/app/bibliotheque/bibliotheque.js';
import { bibliothequeDemo } from './bibliotheque-demo.js';
import { valeursDepuisLigne } from '../src/app/bibliotheque/envoi.js';

// Appel de la bibliothèque dans les documents : valeurs d'une ligne d'article, contenu d'un ouvrage, codes d'appel.
describe('appel de la bibliothèque', () => {
  const biblio = bibliothequeDemo();

  // Coefficients non imposés : ceux de la nature ou globaux en vigueur à la date du jour.
  it('article : unité de vente, PA converti, code sans préfixe dans la bibliothèque du document', async () => {
    const e = await biblio.appelCode('HA10', 'GEN');
    const v = valeursArticle(e, 'GEN');
    const c = biblio.coefficients({ nat_id: 2 });
    expect(v).toMatchObject({ lig_code: 'HA10', lig_art_id: 1, lig_unt_code: 'kg', lig_pa: 1.15, lig_coef_fg: Number(c.coef_fg), lig_coef_benef: Number(c.coef_benef), lig_nat_id: 2 });
    expect(v.lig_proprietes.element).toMatchObject({ id: 1, bib: 'GEN', code: 'HA10', unite: 'kg' });
    // Depuis une autre bibliothèque : préfixe BIB:CODE.
    expect(valeursArticle(e, 'FAB').lig_code).toBe('GEN:HA10');
  });

  it('BIB:CODE, bibliothèque par défaut, code inconnu', async () => {
    expect((await biblio.appelCode('fab:BA13')).code).toBe('BA13');
    expect((await biblio.appelCode('MOMAC')).bib_code).toBe('GEN');
    await expect(biblio.appelCode('BA13', 'GEN')).rejects.toMatchObject({ code: 'INTROUVABLE' });
  });

  it('PV fixe et remise repris dans l\'unité de la ligne', () => {
    const p = prixArticle({ unite_stock: 'u', unite_vente: 'pal', unites: [{ unite: 'pal', formule: '60' }], donnees: {}, pa: '1.5', coef_fg: '1', coef_benef: '1', pv: '2', pv_fixe: true, coef_remise: '0.9' });
    expect(p).toMatchObject({ lig_unt_code: 'pal', lig_pa: 90, lig_pv: 120, lig_pv_fixe: true, lig_coef_remise: 0.9 });
  });

  it('ouvrage : racine appelée, composantes et métrés copiés', async () => {
    const e = await biblio.appelCode('DAL15');
    const c = contenuOuvrage(e, 'FAB', { quantite: 12 });
    const racine = c.lignes.find((l) => l.lig_id === c.racines[0]);
    expect(racine).toMatchObject({ lig_code: 'GEN:DAL15', lig_art_id: 7, lig_qte: 12, lig_unt_code: 'm2', lig_coef_fg: Number(biblio.coefficients({ nat_id: 5 }).coef_fg) });
    expect(c.lignes.filter((l) => l.lig_parent_id === racine.lig_id)).toHaveLength(3);
    expect(c.metres).toHaveLength(1);
    expect(c.metres[0].mtr_script).toContain('Renvoyer');
    expect(racine.lig_pv_fixe).toBe(false);
  });

  it("ouvrage à PV fixe : prix imposé, coefficient de bénéfice déduit, repris à l'appel et à l'envoi", async () => {
    const e = await biblio.appelCode('DAL15');
    const libre = calculerOuvrage(e.composition, e);
    const fixe = calculerOuvrage(e.composition, { ...e, pv_fixe: true, pv: '99.5', coef_remise: '0.9' });
    expect([fixe.pa, fixe.pr, fixe.pv, fixe.pv_net]).toEqual([libre.pa, libre.pr, '99.5', '89.55']);
    expect(Number(fixe.coef_benef)).toBeCloseTo(99.5 / Number(libre.pr), 5);
    expect(libre.coef_benef).toBeUndefined();
    const racine = contenuOuvrage({ ...e, pv_fixe: true, pv: '99.5' }, 'GEN').lignes.find((l) => l.lig_parent_id === null);
    expect(racine).toMatchObject({ lig_pv_fixe: true, lig_pv: 99.5 });
    expect(valeursDepuisLigne({ lig_tyl_id: 2, lig_libelle_html: 'Dalle', lig_pv_fixe: true, lig_pv: 99.5, lig_coef_fg: 1.1, lig_coef_benef: 1.2 }, 'OUVRAGE'))
      .toMatchObject({ pv_fixe: true, pv: '99.5', coef_fg_impose: true });
    expect(valeursDepuisLigne({ lig_tyl_id: 1, lig_libelle_html: 'Lot', lig_pv_fixe: true, lig_pv: 10 }, 'ENSEMBLE').pv_fixe).toBe(false);
  });
});
