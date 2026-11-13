import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import {
  suffixe, patienterSurLimiteDebit, attendreMessage, attendreDocument, attendreStatut, attendreTotalHt, onglet, enregistrer, valider, transformer,
} from './outils/documents';
import { ACHATS, creerPieceAchat, pieceOuverte, saisirReferenceExterne, validerEtAccepter, reglerEcheance, echeanceOuverte, type PieceAchat } from './outils/achats';

/**
 * Cycle achats, partie 2 : de la commande au paiement du fournisseur.
 * Commande saisie directement → livraison complète → facture fournisseur (référence du fournisseur) → deux
 * règlements : acompte (payée partiellement) puis solde (payée).
 */
test.describe.serial('Cycle achats : commande, facture fournisseur et règlements', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 60000 });

  const s = suffixe();
  const bois = { libelle: `Bois de charpente e2e ${s}`, qte: '10', unite: 'm3', pv: '300' };
  const quincaillerie = { libelle: `Quincaillerie e2e ${s}`, qte: '1', unite: 'u', pv: '200' };
  const referenceFournisseur = `MRA-E2E-${s}`;
  const referenceReglement = `VIR-F-E2E-${s}`;

  let page: Page;
  let commande: PieceAchat;
  let facture: PieceAchat;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Création et validation d’une commande fournisseur', async () => {
    commande = await creerPieceAchat(page, 'A_COMMANDE', { objet: `Commande charpente e2e ${s}`, lignes: [bois, quincaillerie] });
    expect(commande.numero).toMatch(/^CF\d{4}-\d+$/);
    await attendreTotalHt(page, '3 200,00');
    // Commande envoyée au fournisseur, puis acceptée par lui (accusé de réception)
    await validerEtAccepter(page);
  });

  test('Livraison complète de la commande', async () => {
    await transformer(page, /Bon de livraison fournisseur/);
    await attendreTotalHt(page, '3 200,00');
    await valider(page);
    await attendreStatut(page, 'Validé');
  });

  test('Facture fournisseur de la livraison', async () => {
    await transformer(page, /Facture fournisseur/);
    facture = await pieceOuverte(page);
    expect(facture.numero).toMatch(/^FF\d{4}-\d+$/);
    await attendreTotalHt(page, '3 200,00');
    await saisirReferenceExterne(page, referenceFournisseur);
    await enregistrer(page);
    await valider(page);
    // Une facture fournisseur validée est acceptée d'office ; TVA à 20 % (taux par défaut)
    await attendreStatut(page, 'Validé');
    await expect(page.locator('#vue-entete table.totaux tr').filter({ hasText: 'Net à payer' }).locator('td')).toHaveText('3 840,00');

    // Commande d'origine : facturée
    await page.goto(`/document/${commande.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Facturé');
  });

  test('Premier règlement partiel de la facture', async () => {
    await page.goto(`/document/${facture.id}`);
    await attendreDocument(page);
    await onglet(page, 'Règlements');
    const reglements = page.locator('#vue-reglements');
    await expect(reglements).toContainText('Aucun règlement pointé.');
    await expect(reglements).toContainText('Reste à payer : 3 840,00');

    // Règlements du fournisseur (décaissements) : 1 000,00 pointés sur l'échéance de la facture
    await reglements.getByRole('link', { name: /Règlements du tiers/ }).click();
    await expect(page).toHaveURL(/\/reglements\?.*sens=D/);
    await reglerEcheance(page, facture.numero, '1000', `${referenceReglement}-1`);
    await expect(echeanceOuverte(page, facture.numero)).toContainText('2 840,00');

    await page.goto(`/document/${facture.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Payé partiellement');
    await onglet(page, 'Règlements');
    await expect(page.locator('#vue-reglements')).toContainText('Reste à payer : 2 840,00');
  });

  test('Second règlement soldant la facture', async () => {
    await onglet(page, 'Règlements');
    await page.locator('#vue-reglements').getByRole('link', { name: /Règlements du tiers/ }).click();
    await reglerEcheance(page, facture.numero, '2840', `${referenceReglement}-2`);
    // Échéance soldée : plus proposée
    await expect(echeanceOuverte(page, facture.numero)).toHaveCount(0);

    await page.goto(`/document/${facture.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Payé');
    await onglet(page, 'Règlements');
    await expect(page.locator('#vue-reglements')).toContainText('Reste à payer : 0,00');
  });
});
