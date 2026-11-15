import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreMessage } from './outils/documents';
import { creerDepot, pieceStockValidee, quantiteEnStock, STOCK, type Lieu } from './outils/stock';

/**
 * Stock, partie 2 : inventaire d'un dépôt créé pour le passage.
 * Entrée de 100 m² de parpaings (1 000 u) → lot d'inventaire (articles du lieu) → comptage de 980 u → bordereau
 * enregistré, écart de −20 u → lot validé : pièce d'inventaire, stock ramené à 980 u.
 */
test.describe.serial('Stock : inventaire d’un dépôt et écart de comptage', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });

  const s = suffixe();
  let page: Page;
  let depot: Lieu;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Dépôt approvisionné', async () => {
    depot = await creerDepot(page, `Dépôt inventaire e2e ${s}`);
    await pieceStockValidee(page, 'S_ENTREE', {
      objet: `Entrée inventaire e2e ${s}`, lieux: { Destination: depot.code }, lignes: [{ ...STOCK.PARPAING, qte: '100' }],
    });
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/1\s000\s*u/);
  });

  test('Lot d’inventaire généré sur les articles du dépôt', async () => {
    await page.goto(`/stock/inventaires?lieu=${depot.id}`);
    await page.locator('[data-nouveau]').click();
    await page.locator('[data-creation] [data-libelle]').fill(`Inventaire e2e ${s}`);
    await page.locator('[data-creation] [data-creer]').click();
    await expect(page).toHaveURL(/\/stock\/inventaire\/\d+/, { timeout: 15000 });
    await page.locator('[data-generer]').click();
    const ligne = page.locator('section[data-bor] tr[data-i]').filter({ hasText: STOCK.PARPAING.libelle });
    await expect(ligne).toBeVisible({ timeout: 15000 });
    // Quantité théorique : le stock du dépôt à la date du comptage
    await expect(ligne.locator('td.theorique')).toHaveText(/1\s000/);
  });

  test('Comptage saisi : écart de −20 u', async () => {
    const ligne = page.locator('section[data-bor] tr[data-i]').filter({ hasText: STOCK.PARPAING.libelle });
    await ligne.locator('[data-c="quantite"]').fill('980');
    await ligne.locator('[data-c="quantite"]').press('Tab');
    await page.locator('section[data-bor] [data-enr]').first().click();
    await attendreMessage(page, /Bordereau enregistré/);
    await page.locator('[data-onglet="ecarts"]').click();
    const ecart = page.locator('[data-contenu] tr').filter({ hasText: STOCK.PARPAING.libelle });
    await expect(ecart).toContainText(/-\s?20|−\s?20/, { timeout: 15000 });
  });

  test('Lot validé : pièce d’inventaire et stock recalé', async () => {
    await page.locator('[data-valider]').click();
    await attendreMessage(page, /Lot validé/);
    await expect(page.locator('[data-valider]')).toHaveCount(0);
    await expect(page.locator('a[data-piece]').first()).toBeVisible();
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/980\s*u/);
  });
});
