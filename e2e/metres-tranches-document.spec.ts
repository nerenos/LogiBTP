import { test, expect, type Page, type Locator } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import {
  suffixe, patienterSurLimiteDebit, enregistrer, onglet, ligneGrille, cellule, ouvrirEditeur, saisirCellule,
  saisirCelluleVerifiee, texteCellule, creerDevis, attendreTotalHt,
} from './outils/documents';

/**
 * Métrés de tranche et métré du document (plan metres-tranches-document, lot 8) :
 * - métré du document (bouton « Métré » de la barre d'outils) qui déclare `hsp`, publiée en `$$hsp` ;
 * - ligne « Cloison » dont le métré lit `$$hsp` (2,5 × 4 = 10) ;
 * - tranche « Étage » dont le métré renvoie 3 : la cloison est multipliée (10 × 10 € × 3 = 300 € HT) ;
 * - quantité et PU de la tranche affichés dans la grille, totaux conservés après rechargement.
 */
test.describe.serial('Métrés de tranche et du document', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 180000 });

  const s = suffixe();
  const cloison = `Cloison e2e ${s}`;
  const etage = `Étage e2e ${s}`;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  const panneau = () => page.locator('#metre');

  /** Script saisi dans l'éditeur du panneau Métré (pause de saisie = enregistrement dans le document). */
  async function saisirScript(script: string) {
    const editeur = panneau().locator('.metre-editeur .cm-content');
    await expect(editeur).toBeVisible({ timeout: 15000 });
    await editeur.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(script);
    await page.waitForTimeout(600);
    await panneau().locator('[data-action="valider"]').click();
  }

  /** Métré d'une ligne ouvert par F4 depuis sa quantité. */
  async function ouvrirMetre(ligne: Locator) {
    await (await cellule(page, ligne, 'Qté')).click();
    await page.keyboard.press('F4');
    await expect(panneau()).toBeVisible({ timeout: 15000 });
  }

  test('Métré du document, tranche par métré et ligne qui lit $$hsp', async () => {
    await creerDevis(page, { objet: `Métrés de tranche e2e ${s}`, ligne: { libelle: cloison, qte: '1', unite: 'M2', pv: '10' } });
    await attendreTotalHt(page, '10,00');

    // Métré du document : variable du document $$hsp.
    await onglet(page, 'Lignes');
    await page.locator('[data-action="metre-document"]').click();
    await panneau().locator('[data-action="creer-document"]').click();
    await saisirScript('hsp est un numérique = 2.5');

    // Tranche « Étage » au-dessus de la cloison, qui devient sa ligne.
    await ligneGrille(page, 'Pied du document').locator('td.col-libelle').click();
    await page.keyboard.press('Control+Shift+Enter');
    await page.keyboard.press('Escape');
    const nouvelle = page.locator('#vue-lignes div.grille:not(.metre-variables) > table tbody tr.courante').first();
    await (await ouvrirEditeur(page, await cellule(page, nouvelle, 'Libellé'))).fill(etage);
    await page.keyboard.press('Enter');
    const tranche = ligneGrille(page, etage);
    await expect(tranche).toBeVisible();
    await saisirCellule(page, tranche, 'Type', 'Titre');
    await (await cellule(page, tranche, 'Libellé')).click();
    await page.keyboard.press('Control+ArrowUp');
    await (await cellule(page, ligneGrille(page, cloison), 'Libellé')).click();
    await page.keyboard.press('Control+ArrowRight');

    // Métré de la cloison : $$hsp × 4 = 10.
    await ouvrirMetre(ligneGrille(page, cloison));
    await saisirScript('Renvoyer $$hsp * 4');
    await expect(async () => {
      expect(await texteCellule(page, ligneGrille(page, cloison), 'Qté')).toContain('10');
    }).toPass({ timeout: 15000 });

    // Métré de la tranche : 3 étages, la cloison est multipliée.
    await ouvrirMetre(ligneGrille(page, etage));
    await saisirScript('Renvoyer 3');
    await expect(async () => {
      expect(await texteCellule(page, ligneGrille(page, etage), 'Qté')).toContain('3');
    }).toPass({ timeout: 15000 });
    await enregistrer(page);
    await attendreTotalHt(page, '300,00');
  });

  test('Quantité de tranche saisie à la place du métré, totaux après rechargement', async () => {
    await page.reload();
    await attendreTotalHt(page, '300,00');
    await onglet(page, 'Lignes');
    // PU de la tranche pour une unité : 100 € (300 € ÷ 3).
    expect(await texteCellule(page, ligneGrille(page, etage), 'PV')).toContain('100');
    // Quantité saisie à la place du métré : 2 étages.
    await saisirCelluleVerifiee(page, ligneGrille(page, etage), 'Qté', '2');
    await enregistrer(page);
    await attendreTotalHt(page, '200,00');
  });
});
