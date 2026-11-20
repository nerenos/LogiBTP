import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import {
  suffixe, patienterSurLimiteDebit, attendreDocument, attendreMessage, actionDocument, dialogue, attendreStatut, attendreTotalHt, onglet,
  enregistrer, ligneGrille, saisirCelluleVerifiee,
} from './outils/documents';
import { ACHATS, creerPieceAchat, pieceOuverte, type PieceAchat } from './outils/achats';

/**
 * Lot de consultation d'une demande de prix : la demande est envoyée à plusieurs fournisseurs choisis en une fois
 * (une copie par fournisseur), les offres se retrouvent par le code du lot dans la liste des demandes de prix, se
 * comparent ligne à ligne, et l'offre retenue devient la commande (les autres passent « Non retenue »).
 * Fournisseurs de la démonstration : Matériaux Rhône-Alpes (demande d'origine), Aciers du Rhône, Métal Distribution.
 */
const AUTRES = Object.freeze(['Aciers du Rhône', 'Métal Distribution']);

test.describe.serial('Achats : lot de consultation multi-fournisseurs', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });

  const s = suffixe();
  const treillis = { libelle: `Treillis soudé e2e ${s}`, qte: '10', unite: 'u', pv: '30' };
  const aciers = { libelle: `Aciers HA 12 e2e ${s}`, qte: '50', unite: 'u', pv: '8' };

  let page: Page;
  let demande: PieceAchat;
  /** Offres du lot par fournisseur : identifiant et numéro. */
  const offres = new Map<string, PieceAchat>();

  /** Fenêtre du lot de consultation ouverte depuis le menu du document affiché. */
  async function ouvrirLot() {
    // Icône du libellé personnalisable : action désignée par son texte
    const menu = page.locator('[data-menu-actions]:not([hidden])');
    if (!(await menu.count())) await page.locator('[data-ouvrir-actions]').filter({ visible: true }).last().click();
    await menu.getByRole('menuitem', { name: /Lot de consultation$/ }).click();
    const lot = dialogue(page);
    await expect(lot.getByRole('heading', { name: /Lot de consultation/ })).toBeVisible();
    return lot;
  }

  /** Ouvre une offre, change le PU d'une ligne (sauf null), enregistre et valide (statut Envoyé, sans approbation). */
  async function validerOffre(offre: PieceAchat, pv: string | null) {
    await page.goto(`/document/${offre.id}`);
    await attendreDocument(page);
    if (pv) {
      await onglet(page, 'Lignes');
      await saisirCelluleVerifiee(page, ligneGrille(page, aciers.libelle), 'PV', pv);
      await enregistrer(page);
    }
    await actionDocument(page, 'Valider');
    await attendreStatut(page, 'Envoyé');
  }

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Demande de prix d’origine : action et champ du lot de consultation', async () => {
    demande = await creerPieceAchat(page, 'A_DEVIS', { objet: `Consultation aciers e2e ${s}`, lignes: [treillis, aciers] });
    await attendreTotalHt(page, '700,00');
    offres.set(ACHATS.FOURNISSEUR, demande);
    // Type à lot de consultation : champ du lot dans l'entête (vide tant qu'aucun autre fournisseur n'est consulté)
    await expect(page.getByRole('textbox', { name: /Lot de consultation/ })).toHaveValue('');
    const lot = await ouvrirLot();
    await expect(lot.getByRole('button', { name: 'Ajouter des fournisseurs…' })).toBeVisible();
    await expect(lot.getByRole('button', { name: 'Copie sans fournisseur' })).toBeVisible();
  });

  test('Deux fournisseurs ajoutés en une fois : une demande par fournisseur', async () => {
    const lot = dialogue(page);
    await lot.getByRole('button', { name: 'Ajouter des fournisseurs…' }).click();
    const choix = dialogue(page);
    await expect(choix.getByRole('heading', { name: 'Fournisseurs à consulter' })).toBeVisible();
    // Sélection multiple : clic sur le premier, Ctrl + clic sur le second
    const premier = choix.locator('tbody tr').filter({ hasText: AUTRES[0] }).first();
    const second = choix.locator('tbody tr').filter({ hasText: AUTRES[1] }).first();
    await expect(premier).toBeVisible();
    await premier.click();
    await second.click({ modifiers: ['ControlOrMeta'] });
    await choix.getByRole('button', { name: 'Choisir', exact: true }).click();
    await attendreMessage(page, '2 demandes créées pour le lot, une par fournisseur');

    // Fenêtre du lot rouverte : la demande d'origine et les deux copies, chacune avec son fournisseur
    const rouvert = dialogue(page);
    await expect(rouvert.getByRole('heading', { name: `Lot de consultation ${demande.numero}` })).toBeVisible();
    const lignes = rouvert.locator('tbody tr');
    await expect(lignes).toHaveCount(3);
    for (const f of [ACHATS.FOURNISSEUR, ...AUTRES]) await expect(lignes.filter({ hasText: f })).toHaveCount(1);
    for (const f of AUTRES) {
      const lien = lignes.filter({ hasText: f }).getByRole('link');
      const id = Number(((await lien.getAttribute('href')) ?? '').split('/').pop());
      offres.set(f, { id, numero: (await lien.innerText()).trim() });
    }
    await rouvert.getByRole('button', { name: 'Fermer' }).click();

    // Code du lot (numéro de la demande d'origine) dans l'entête
    await expect(page.getByRole('textbox', { name: /Lot de consultation/ })).toHaveValue(demande.numero);
  });

  test('Copie : fournisseur, lignes et code du lot repris', async () => {
    const copie = offres.get(AUTRES[0])!;
    await page.goto(`/document/${copie.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Brouillon');
    await expect(page.getByRole('group', { name: 'Coordonnées du document' })).toContainText(AUTRES[0]);
    await expect(page.getByRole('textbox', { name: /Lot de consultation/ })).toHaveValue(demande.numero);
    await attendreTotalHt(page, '700,00');
  });

  test('Liste des demandes de prix : les offres du lot retrouvées par son code', async () => {
    await page.goto(`/liste/achats_ddp`);
    const recherche = page.getByRole('searchbox').first();
    await recherche.fill(demande.numero);
    const lignes = page.locator('tbody tr').filter({ hasText: `Consultation aciers e2e ${s}` });
    await expect(lignes).toHaveCount(3, { timeout: 15000 });
    await expect(page.getByRole('columnheader', { name: 'Lot' }).first()).toBeVisible();
  });

  test('Offres validées à des prix différents, comparées ligne à ligne', async () => {
    await validerOffre(demande, null); // 700,00
    await validerOffre(offres.get(AUTRES[0])!, '7'); // 650,00 : moins-disant
    await validerOffre(offres.get(AUTRES[1])!, '9'); // 750,00

    await page.goto(`/consultation/comparatif?id=${demande.id}`);
    await expect(page.getByRole('heading', { name: /Comparatif/ }).first()).toBeVisible();
    const total = page.locator('tfoot tr').first();
    await expect(total).toContainText('650,00');
    await expect(total).toContainText('700,00');
    await expect(total).toContainText('750,00');
  });

  test('Offre retenue : commande créée, autres offres « Non retenue »', async () => {
    const retenue = offres.get(AUTRES[0])!;
    await page.locator(`[data-retenir="${retenue.id}"]`).click();
    const confirmation = dialogue(page);
    await confirmation.getByRole('button', { name: /Retenir/ }).click();
    // Fenêtre de transformation commune : commande fournisseur
    const transformation = dialogue(page);
    // La commande créée s'ouvre dans une autre fenêtre : elle est rouverte dans celle du scénario
    const [fenetre] = await Promise.all([page.context().waitForEvent('page'), transformation.getByRole('button', { name: /Commande fournisseur/ }).click()]);
    await attendreMessage(page, /2 offres non retenues/);
    await expect(fenetre).toHaveURL(/\/document\/\d+/);
    const url = fenetre.url();
    await fenetre.close();
    await page.goto(url);
    await attendreDocument(page);
    const commande = await pieceOuverte(page);
    expect(commande.numero).toMatch(/^CF\d{4}-\d+$/);
    await attendreTotalHt(page, '650,00');
    await expect(page.getByRole('group', { name: 'Coordonnées du document' })).toContainText(AUTRES[0]);

    for (const f of [ACHATS.FOURNISSEUR, AUTRES[1]]) {
      await page.goto(`/document/${offres.get(f)!.id}`);
      await attendreDocument(page);
      await attendreStatut(page, 'Non retenue');
    }
  });
});
