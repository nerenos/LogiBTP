import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import {
  suffixe, patienterSurLimiteDebit, attendreDocument, attendreStatut, attendreTotalHt, onglet, enregistrer, valider, transformer,
  ligneGrille, saisirCellule, texteCellule, idDocument,
} from './outils/documents';
import { creerPieceAchat, pieceOuverte, saisirReferenceExterne, validerEtAccepter, type PieceAchat } from './outils/achats';

/**
 * Cycle achats, partie 4 : situations fournisseur (facturation à l'avancement d'une commande).
 * Commande → situation n° 1 (30 %) → situation n° 2 (80 % cumulés : période de 50 %).
 */
test.describe.serial('Cycle achats : situations fournisseur', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 60000 });

  const s = suffixe();
  const charpente = { libelle: `Charpente bois posée e2e ${s}`, qte: '1', unite: 'ens', pv: '12000' };

  let page: Page;
  let commande: PieceAchat;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  /** Situation fournisseur de la commande : avancement cumulé, référence du fournisseur, validée. */
  async function situation(pourcent: string, reference: string) {
    if (idDocument(page) !== commande.id) {
      await page.goto(`/document/${commande.id}`);
      await attendreDocument(page);
    }
    await transformer(page, /Situation fournisseur/);
    const piece = await pieceOuverte(page);
    await saisirReferenceExterne(page, reference);
    await onglet(page, 'Lignes');
    await saisirCellule(page, ligneGrille(page, charpente.libelle), '% cumul', pourcent);
    await enregistrer(page);
    await valider(page);
    await attendreStatut(page, 'Validé');
    return piece;
  }

  test('Commande de charpente acceptée par le fournisseur', async () => {
    commande = await creerPieceAchat(page, 'A_COMMANDE', { objet: `Commande charpente posée e2e ${s}`, lignes: [charpente] });
    await attendreTotalHt(page, '12 000,00');
    await validerEtAccepter(page);
  });

  test('Situation fournisseur n° 1 à 30 %', async () => {
    const s1 = await situation('30', `SIT1-${s}`);
    expect(s1.numero).toMatch(/^SF\d{4}-\d+$/);
    await attendreTotalHt(page, '3 600,00');
    await onglet(page, 'Lignes');
    const ligne = ligneGrille(page, charpente.libelle);
    expect(await texteCellule(page, ligne, '% préc.')).toBe('0,00');
    expect(await texteCellule(page, ligne, 'Montant cumul')).toBe('3 600,00');
  });

  test('Situation fournisseur n° 2 à 80 % : période de 50 %', async () => {
    await situation('80', `SIT2-${s}`);
    // Période = 80 % − 30 % de 12 000 €
    await attendreTotalHt(page, '6 000,00');
    await onglet(page, 'Lignes');
    const ligne = ligneGrille(page, charpente.libelle);
    expect(await texteCellule(page, ligne, '% préc.')).toBe('30,00');
    expect(await texteCellule(page, ligne, 'Montant cumul')).toBe('9 600,00');

    // Commande en cours de facturation
    await page.goto(`/document/${commande.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'En facturation');
  });
});
