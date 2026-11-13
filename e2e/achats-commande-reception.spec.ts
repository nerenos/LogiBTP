import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import {
  suffixe, patienterSurLimiteDebit, attendreDocument, actionDocument, dialogue, saisirCellule, attendreStatut, attendreTotalHt, onglet, enregistrer, valider, transformer, ligneGrille, texteCellule,
} from './outils/documents';
import { ACHATS, creerPieceAchat, pieceOuverte, validerEtAccepter, transformerPartiellement, ligneATransformer, type PieceAchat } from './outils/achats';

/**
 * Cycle achats, partie 1 : de la demande de prix aux réceptions.
 * Demande de prix → commande fournisseur → réception partielle → réception soldée (reste abandonné).
 */
test.describe.serial('Cycle achats : demande de prix, commande et réceptions', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 60000 });

  const s = suffixe();
  const parpaings = { libelle: `Parpaings 20 e2e ${s}`, qte: '100', unite: 'u', pv: '2,5' };
  const ciment = { libelle: `Ciment 35 kg e2e ${s}`, qte: '20', unite: 'u', pv: '12' };

  let page: Page;
  let demande: PieceAchat;
  let commande: PieceAchat;
  let reception1: PieceAchat;
  let reception2: PieceAchat;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Création d’une demande de prix fournisseur', async () => {
    demande = await creerPieceAchat(page, 'A_DEVIS', { objet: `Demande de prix gros œuvre e2e ${s}`, lignes: [parpaings, ciment] });
    expect(demande.numero).toMatch(/^DF\d{4}-\d+$/);
    await attendreTotalHt(page, '490,00');
    await validerEtAccepter(page);
  });

  test('Transformation de la demande de prix en commande fournisseur', async () => {
    await transformer(page, /Commande fournisseur/);
    commande = await pieceOuverte(page);
    expect(commande.numero).toMatch(/^CF\d{4}-\d+$/);
    await attendreStatut(page, 'Brouillon');
    await attendreTotalHt(page, '490,00');
    // Fournisseur, chantier et adresse de livraison repris de la demande de prix
    await expect(page.getByRole('group', { name: 'Rattachement' }).getByRole('textbox', { name: 'Chantier', exact: true })).toHaveValue(ACHATS.CHANTIER);
    await expect(page.getByRole('group', { name: 'Coordonnées du document' })).toContainText(ACHATS.FOURNISSEUR);
    await enregistrer(page);
    await valider(page);
    await attendreStatut(page, 'Validé');
  });

  test('Réception partielle de la commande', async () => {
    // 60 parpaings sur 100, ciment laissé en reliquat (ligne décochée)
    await transformerPartiellement(page, /Bon de livraison fournisseur/, { [parpaings.libelle]: '60', [ciment.libelle]: null });
    reception1 = await pieceOuverte(page);
    expect(reception1.numero).toMatch(/^RF\d{4}-\d+$/);
    await attendreTotalHt(page, '150,00');
    // Une réception validée est validée d'office (pas d'envoi au fournisseur)
    await valider(page);
    await attendreStatut(page, 'Validé');

    // Reste de la ligne : 40 parpaings, ligne non soldée ; la ligne de ciment n'est pas reprise
    await onglet(page, 'Lignes');
    const ligne = ligneGrille(page, parpaings.libelle);
    expect(await texteCellule(page, ligne, 'Qté')).toBe('60,00');
    expect(await texteCellule(page, ligne, 'Reste')).toBe('40,00');
    expect(await texteCellule(page, ligne, 'Soldé')).toBe('');
    await expect(ligneGrille(page, ciment.libelle)).toHaveCount(0);
  });

  test('Réception du reliquat avec solde de la ligne', async () => {
    // Commande : toujours validée, reliquat de 40 parpaings et 20 sacs de ciment proposé
    await page.goto(`/document/${commande.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Validé');
    await actionDocument(page, 'Transformer…');
    await dialogue(page).getByRole('checkbox', { name: 'Choisir les lignes et les quantités' }).check();
    await dialogue(page).getByRole('button', { name: /Bon de livraison fournisseur/ }).click();
    await expect(ligneATransformer(page, parpaings.libelle)).toContainText('40,00');
    await expect(ligneATransformer(page, ciment.libelle)).toContainText('20,00');
    await dialogue(page).getByRole('button', { name: 'Annuler', exact: true }).click();

    // Deuxième livraison : 30 parpaings (les 10 manquants ne seront pas livrés : ligne soldée) et tout le ciment
    await transformerPartiellement(page, /Bon de livraison fournisseur/, { [parpaings.libelle]: '30' });
    reception2 = await pieceOuverte(page);
    await attendreTotalHt(page, '315,00');
    await onglet(page, 'Lignes');
    const ligne = ligneGrille(page, parpaings.libelle);
    expect(await texteCellule(page, ligne, 'Reste')).toBe('10,00');
    await saisirCellule(page, ligne, 'Soldé', 'Soldée');
    await expect.poll(() => texteCellule(page, ligne, 'Soldé')).not.toBe('');
    await enregistrer(page);
    await valider(page);

    // Commande entièrement livrée ou soldée : statut Soldé
    await page.goto(`/document/${commande.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Soldé');
  });
});
