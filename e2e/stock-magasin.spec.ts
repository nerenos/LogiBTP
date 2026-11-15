import { test, expect, type Page, type Locator } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreMessage } from './outils/documents';
import { creerDepot, pieceStockValidee, quantiteEnStock, STOCK, type Lieu } from './outils/stock';

/**
 * Stock, partie 3 : magasin d'un dépôt créé pour le passage.
 * Entrée de 10 m² de parpaings (100 u) → sortie au magasin de 20 u pour un chantier (pièce de sortie validée d'office)
 * → retour de 5 u du chantier → état du stock : 85 u.
 */
test.describe.serial('Stock : sortie et retour au magasin', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });

  const s = suffixe();
  let page: Page;
  let depot: Lieu;

  /** Combo du socle : saisie du code puis option « code – libellé ». */
  async function choisir(combo: Locator, code: string) {
    await combo.click();
    await combo.fill(code);
    await page.getByRole('option', { name: new RegExp(`^${code} – `) }).first().click();
  }

  /** Mouvement du magasin (sortie ou retour) : dépôt, chantier bénéficiaire, un article et sa quantité. */
  async function mouvement(mode: 'sortie' | 'retour', quantite: string) {
    await page.goto(`/stock/magasin?lieu=${depot.id}`);
    const corps = page.locator('body');
    await expect(corps.locator('[data-valider]')).toBeVisible({ timeout: 15000 });
    await corps.locator(`[data-mode="${mode}"]`).click();
    await corps.locator('input[name="benef"][value="chantier"]').check();
    await choisir(corps.locator('[data-beneficiaire] input').first(), STOCK.CHANTIER);
    await choisir(corps.locator('[data-article] input').first(), STOCK.PARPAING.code);
    await corps.locator('[data-quantite]').fill(quantite);
    await corps.locator('[data-ajouter]').click();
    await expect(corps.locator('[data-panier] tr[data-i]')).toHaveCount(1);
    await corps.locator('[data-commentaire]').fill(`Magasin e2e ${s}`);
    await corps.locator('[data-valider]').click();
    await attendreMessage(page, mode === 'sortie' ? /Sortie/i : /Retour/i);
    await expect(corps.locator('[data-resultat] a[data-doc]').first()).toBeVisible();
  }

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Dépôt approvisionné', async () => {
    depot = await creerDepot(page, `Dépôt magasin e2e ${s}`);
    await pieceStockValidee(page, 'S_ENTREE', {
      objet: `Entrée magasin e2e ${s}`, lieux: { Destination: depot.code }, lignes: [{ ...STOCK.PARPAING, qte: '10' }],
    });
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/100\s*u/);
  });

  test('Sortie au magasin pour un chantier', async () => {
    await mouvement('sortie', '20');
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/80\s*u/);
  });

  test('Retour au magasin du chantier', async () => {
    await mouvement('retour', '5');
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/85\s*u/);
  });
});
