import { test, expect, type Page } from '@playwright/test';
import { seConnecter } from './outils/connexion';
import {
  TIERS, suffixe, patienterSurLimiteDebit, attendreMessage, attendreDocument, idDocument, numeroDocument, attendreStatut,
  attendreTotalHt, onglet, enregistrer, valider, saisirObjet, ajouterIntervenant, ajouterLigne, vueColonnes,
} from './outils/documents';

/**
 * Cycle commercial, partie 3 : facture directe et encaissement.
 * Facture sans commande, avec un tiers payeur distinct du client → règlement saisi et pointé sur la facture.
 */
test.describe.serial('Cycle commercial : facture directe avec tiers payeur et règlement', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });
  test.describe.configure({ timeout: 90000 });

  const s = suffixe();
  const objet = `Facture travaux supplémentaires e2e ${s}`;
  const ligne = { libelle: `Travaux supplémentaires e2e ${s}`, qte: '2', unite: 'u', pv: '150' };
  const reference = `VIR-E2E-${s}`;

  let page: Page;
  let facture = { id: 0, numero: '' };

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Création d’une facture directe avec un tiers payeur', async () => {
    // Nouvelle facture (menu Ventes › Factures, bouton ＋)
    await page.goto('/document/nouveau?type=V_FACTURE');
    await attendreDocument(page);
    await expect(page.locator('#vue-entete .entete-titre')).toContainText('Facture');
    await saisirObjet(page, objet);

    // Client puis payeur : intervenant de fonction « Payeur »
    await ajouterIntervenant(page, TIERS.CLIENT);
    await ajouterIntervenant(page, TIERS.PAYEUR, 'Payeur');
    const coordonnees = page.getByRole('group', { name: 'Coordonnées du document' });
    await expect(coordonnees).toContainText(new RegExp(`Client ⟳\\s*${TIERS.CLIENT}`));
    await expect(coordonnees).toContainText(new RegExp(`Payeur ⟳\\s*${TIERS.PAYEUR}`));

    // Ligne saisie dans la vue complète (la vue par défaut d'une facture ne montre pas le prix de vente)
    await onglet(page, 'Lignes');
    await vueColonnes(page, /^Complet/);
    await ajouterLigne(page, ligne);
    await enregistrer(page);
    await attendreTotalHt(page, '300,00');

    // Une facture validée est envoyée au client (statut « Envoyé »)
    await valider(page);
    await attendreStatut(page, 'Envoyé');
    facture = { id: idDocument(page), numero: (await numeroDocument(page)).numero };
    expect(facture.numero).toMatch(/^FA\d{4}-\d+$/);

    // Le payeur est conservé dans les coordonnées figées de la facture validée
    await expect(page.getByRole('group', { name: 'Coordonnées du document' })).toContainText(TIERS.PAYEUR);
  });

  test('Saisie du règlement de la facture', async () => {
    // Onglet Règlements : échéance unique, rien de pointé
    await onglet(page, 'Règlements');
    const reglements = page.locator('#vue-reglements');
    await expect(reglements).toContainText('Aucun règlement pointé.');
    await expect(reglements).toContainText('Reste à payer : 300,00');

    // Règlements du tiers : nouveau règlement pointé sur l'échéance de la facture
    await reglements.getByRole('link', { name: /Règlements du tiers/ }).click();
    await expect(page).toHaveURL(/\/reglements\?/);
    const echeance = page.getByRole('row').filter({ hasText: facture.numero });
    await expect(echeance).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Montant', exact: true }).first().fill('300');
    await page.getByRole('textbox', { name: 'Référence', exact: true }).first().fill(reference);
    await echeance.getByRole('textbox').fill('300');
    await page.getByRole('button', { name: 'Enregistrer le règlement', exact: true }).click();
    await attendreMessage(page, 'Règlement enregistré');

    // Le règlement apparaît, pointé sur la facture, et l'échéance soldée disparaît de la liste
    const reglement = page.getByRole('row').filter({ hasText: reference });
    await expect(reglement).toContainText('300,00');
    await expect(reglement).toContainText(facture.numero);
    await expect(page.getByRole('row').filter({ hasText: facture.numero }).filter({ hasNotText: reference })).toHaveCount(0);

    // Facture : payée, plus rien à payer
    await page.goto(`/document/${facture.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Payé');
    await onglet(page, 'Règlements');
    await expect(page.locator('#vue-reglements')).toContainText('Reste à payer : 0,00');
  });
});
