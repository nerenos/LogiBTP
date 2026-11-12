import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit } from './outils/documents';
import { creerDepot, pieceStockValidee, quantiteEnStock, STOCK, type Lieu } from './outils/stock';

/**
 * Stock, partie 1 : mouvements d'un dépôt créé pour le passage (stock de départ nul).
 * Entrée de 100 parpaings et 40 plaques → transfert de 30 parpaings vers un chantier (consommés) → sortie de 10
 * parpaings → état du stock : 60 parpaings, 40 plaques.
 */
test.describe.serial('Stock : entrée, transfert et sortie d’un dépôt', { tag: TAG_API }, () => {
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

  test('Nouveau dépôt de stock', async () => {
    depot = await creerDepot(page, `Dépôt e2e ${s}`);
    expect(depot.code).not.toBe('');
  });

  test('Entrée de stock dans le dépôt', async () => {
    await pieceStockValidee(page, 'S_ENTREE', {
      objet: `Entrée e2e ${s}`, lieux: { Destination: depot.code },
      lignes: [{ ...STOCK.PARPAING, qte: '100' }, { ...STOCK.PLAQUE, qte: '40' }],
    });
    // Lignes en unité de vente (m²) : le parpaing est tenu à l'unité (10 au m²), la plaque au m²
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/1\s000\s*u/);
    await expect(await quantiteEnStock(page, depot, STOCK.PLAQUE.libelle)).toContainText(/40,00\s*m2/);
  });

  test('Transfert du dépôt vers un chantier qui consomme', async () => {
    await pieceStockValidee(page, 'S_TRANSFERT', {
      objet: `Transfert e2e ${s}`, lieux: { 'Origine (vide : entrée)': depot.code, 'Destination (vide : sortie)': STOCK.CHANTIER },
      lignes: [{ ...STOCK.PARPAING, qte: '30' }],
    });
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/700\s*u/);
  });

  test('Sortie de stock du dépôt', async () => {
    await pieceStockValidee(page, 'S_SORTIE', {
      objet: `Sortie e2e ${s}`, lieux: { Origine: depot.code },
      lignes: [{ ...STOCK.PARPAING, qte: '10' }, { ...STOCK.PLAQUE, qte: '15' }],
    });
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/600\s*u/);
    await expect(await quantiteEnStock(page, depot, STOCK.PLAQUE.libelle)).toContainText(/25,00\s*m2/);
  });
});
