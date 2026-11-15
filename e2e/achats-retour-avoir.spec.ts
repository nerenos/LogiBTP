import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import {
  suffixe, patienterSurLimiteDebit, attendreDocument, attendreStatut, attendreTotalHt, onglet, enregistrer, valider, transformer,
  actionDocument, dialogue, ligneGrille, texteCellule, attendreMessage,
} from './outils/documents';
import {
  creerPieceAchat, pieceOuverte, saisirReferenceExterne, validerEtAccepter, transformerPartiellement, ligneATransformer, reglerEcheance, echeanceOuverte, type PieceAchat,
} from './outils/achats';

/**
 * Cycle achats, partie 3 : retour et avoir fournisseur.
 * Commande → livraison complète (commande soldée) → bon de retour partiel (le reliquat de la commande se rouvre) →
 * facture de la livraison → avoir fournisseur partiel de la facture → avoir imputé sur la facture, solde réglé.
 */
test.describe.serial('Cycle achats : retour et avoir fournisseur', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 60000 });

  const s = suffixe();
  const plaques = { libelle: `Plaques de plâtre BA13 e2e ${s}`, qte: '50', unite: 'u', pv: '8' };

  let page: Page;
  let commande: PieceAchat;
  let livraison: PieceAchat;
  let facture: PieceAchat;
  let avoir: PieceAchat;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Commande livrée en totalité', async () => {
    commande = await creerPieceAchat(page, 'A_COMMANDE', { objet: `Commande plâtrerie e2e ${s}`, lignes: [plaques] });
    await attendreTotalHt(page, '400,00');
    await validerEtAccepter(page);
    await transformer(page, /Bon de livraison fournisseur/);
    livraison = await pieceOuverte(page);
    await attendreTotalHt(page, '400,00');
    await valider(page);
    await attendreStatut(page, 'Validé');

    // Tout est livré : la commande est soldée
    await page.goto(`/document/${commande.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Soldé');
  });

  test('Bon de retour partiel de la livraison', async () => {
    await page.goto(`/document/${livraison.id}`);
    await attendreDocument(page);
    // 5 plaques cassées renvoyées au fournisseur
    await transformerPartiellement(page, /Bon de retour fournisseur/, { [plaques.libelle]: '5' });
    const retour = await pieceOuverte(page);
    expect(retour.numero).toMatch(/^RR\d{4}-\d+$/);
    await attendreTotalHt(page, '40,00');
    await valider(page);
    await attendreStatut(page, 'Validé');
    await onglet(page, 'Lignes');
    const ligne = ligneGrille(page, plaques.libelle);
    expect(await texteCellule(page, ligne, 'Qté')).toBe('5,00');
    expect(await texteCellule(page, ligne, 'Reste')).toBe('45,00');

    // Le retour rouvre le reliquat de la commande : 5 plaques à livrer de nouveau
    await page.goto(`/document/${commande.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Validé');
    await actionDocument(page, 'Transformer…');
    await dialogue(page).getByRole('checkbox', { name: 'Choisir les lignes et les quantités' }).check();
    await dialogue(page).getByRole('button', { name: /Bon de livraison fournisseur/ }).click();
    await expect(ligneATransformer(page, plaques.libelle)).toContainText('5,00');
    await dialogue(page).getByRole('button', { name: 'Annuler', exact: true }).click();
  });

  test('Facture de la livraison', async () => {
    await page.goto(`/document/${livraison.id}`);
    await attendreDocument(page);
    // Le fournisseur facture la quantité livrée ; le retour se règle par un avoir
    await transformer(page, /Facture fournisseur/);
    facture = await pieceOuverte(page);
    await attendreTotalHt(page, '400,00');
    await saisirReferenceExterne(page, `F-PLA-${s}`);
    await enregistrer(page);
    await valider(page);
    await attendreStatut(page, 'Validé');
  });

  test('Avoir fournisseur partiel de la facture', async () => {
    // Avoir reçu pour 2 plaques (les 3 autres seront relivrées)
    await transformerPartiellement(page, /Avoir fournisseur/, { [plaques.libelle]: '2' });
    avoir = await pieceOuverte(page);
    expect(avoir.numero).toMatch(/^AF\d{4}-\d+$/);
    await attendreTotalHt(page, '16,00');
    await expect(page.locator('#vue-entete table.totaux tr').filter({ hasText: 'Total TTC' }).locator('td')).toHaveText('19,20');
    // Référence de l'avoir du fournisseur : obligatoire et unique
    await saisirReferenceExterne(page, `AV-PLA-${s}`);
    await enregistrer(page);
    await valider(page);
    await attendreStatut(page, 'Validé');
    await onglet(page, 'Lignes');
    const ligne = ligneGrille(page, plaques.libelle);
    expect(await texteCellule(page, ligne, 'Qté')).toBe('2,00');
    expect(await texteCellule(page, ligne, 'Qté parent')).toBe('50,00');
  });

  test('Imputation de l’avoir sur la facture puis règlement du solde', async () => {
    // Avoir : crédit chez le fournisseur, échéance négative dans les règlements
    await onglet(page, 'Règlements');
    await expect(page.locator('#vue-reglements')).toContainText('Reste à payer : -19,20');

    // Facture : l'avoir s'impute sur son échéance (montant proposé : le reste de l'avoir)
    await page.goto(`/document/${facture.id}`);
    await attendreDocument(page);
    await onglet(page, 'Règlements');
    const reglements = page.locator('#vue-reglements');
    await expect(reglements).toContainText('Reste à payer : 480,00');
    await reglements.getByRole('button', { name: /Imputer/ }).click();
    const d = dialogue(page);
    // Avoirs ouverts du fournisseur (ceux des passages précédents aussi) : celui de ce passage
    const combo = d.getByRole('combobox');
    await combo.click();
    await combo.fill(avoir.numero);
    await page.getByRole('option', { name: new RegExp(avoir.numero) }).click();
    await expect(combo).toHaveValue(new RegExp(`${avoir.numero} · reste -19,20`));
    await expect(d.getByRole('textbox').first()).toHaveValue('19,20');
    await d.getByRole('button', { name: 'Imputer', exact: true }).click();
    await attendreMessage(page, 'Imputation enregistrée');
    await expect(reglements).toContainText('Reste à payer : 460,80');
    await page.reload();
    await attendreDocument(page);
    await attendreStatut(page, 'Payé partiellement');

    // Solde par virement depuis les règlements du fournisseur
    await onglet(page, 'Règlements');
    await page.locator('#vue-reglements').getByRole('link', { name: /Règlements du tiers/ }).click();
    await expect(echeanceOuverte(page, avoir.numero)).toHaveCount(0);
    await reglerEcheance(page, facture.numero, '460,8', `VIR-PLA-${s}`);
    await expect(echeanceOuverte(page, facture.numero)).toHaveCount(0);

    await page.goto(`/document/${facture.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Payé');
    await page.goto(`/document/${avoir.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Payé');
  });
});
