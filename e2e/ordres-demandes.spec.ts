import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API, identifiantCompte } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreStatut, attendreTotalHt, enregistrer, valider } from './outils/documents';
import { ACHATS } from './outils/achats';
import { validerCommandeDansMarche, SOUS_TRAITANCE } from './outils/sous-traitance';
import { creerDepot, pieceStockValidee, quantiteEnStock, choisirLieu, STOCK, type Lieu } from './outils/stock';
import {
  creerOrdre, transformerVers, garderLignes, ouvrir, validerEtape, controlerEtape, attendreEtatExecution, choisirTiers, saisirPrix, transmettreEtPrendreEnCharge, validerEtAccepterPiece, accepterSiEnvoyee,
  type Piece,
} from './outils/execution';

/**
 * Ordres, parcours 2 : des demandes saisies sur un chantier, sans lien avec un devis ni un marché.
 * - Demande d'approvisionnement du chantier CH-2026-001 (parpaings du stock, location de nacelle, visserie), prise en
 *   charge, puis répartie : visserie → demande d'achat → demande de prix → commande fournisseur ; nacelle → commande
 *   fournisseur directe ; parpaings → réservation sur un dépôt approvisionné → transfert vers le chantier ;
 * - ordre de sous-traitance du chantier CH-2026-002 → appel d'offres → commande de sous-traitance validée dans un
 *   marché de sous-traitance lié au marché de vente du chantier ;
 * - liste des ordres du chantier.
 * Aucune pièce de ces demandes ne reprend de client : la demande n'en a pas, les pièces d'achat ont leur fournisseur.
 */
test.describe.serial('Ordres : demandes sans devis', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  const nacelle = { libelle: `Location nacelle e2e ${s}`, qte: '5', unite: 'j', nature: 'LOC' };
  const visserie = { libelle: `Visserie inox e2e ${s}`, qte: '200', unite: 'u', nature: 'MAT' };
  const etancheite = { libelle: `Reprise étanchéité e2e ${s}`, qte: '1', unite: 'ens', nature: 'ST' };

  let page: Page;
  let depot: Lieu;
  let dap: Piece;
  let dac: Piece;
  let ost: Piece;
  const pieces: Piece[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Préparation : dépôt approvisionné en parpaings', async () => {
    depot = await creerDepot(page, `Dépôt demandes e2e ${s}`);
    await pieceStockValidee(page, 'S_ENTREE', { objet: `Entrée demandes e2e ${s}`, lieux: { Destination: depot.code }, lignes: [{ ...STOCK.PARPAING, qte: '100' }] });
  });

  test('Demande d’approvisionnement saisie sur le chantier, prise en charge', async () => {
    dap = await creerOrdre(page, 'E_DAP', {
      objet: `Approvisionnement façade e2e ${s}`, chantier: ACHATS.CHANTIER, besoins: [nacelle, visserie], articles: [{ ...STOCK.PARPAING, qte: '30' }],
    });
    expect(dap.numero).toMatch(/^DAP\d{4}-\d+$/);
    await transmettreEtPrendreEnCharge(page);
    await validerEtape(page, 'Expression du besoin');
    await attendreEtatExecution(page, /En cours/);
  });

  test('Visserie : demande d’achat, demande de prix acceptée, commande fournisseur', async () => {
    await ouvrir(page, dap.id);
    dac = await transformerVers(page, /Demande d'achat/);
    expect(dac.numero).toMatch(/^DAC\d{4}-\d+$/);
    await garderLignes(page, [visserie.libelle]);
    await valider(page);
    await validerEtape(page, 'Consultation');

    const ddp = await transformerVers(page, /Demande de prix/);
    await choisirTiers(page, ACHATS.FOURNISSEUR);
    await saisirPrix(page, { [visserie.libelle]: '0,35' });
    await attendreTotalHt(page, '70,00');
    await validerEtAccepterPiece(page);
    pieces.push(ddp);

    const cf = await transformerVers(page, /Commande fournisseur/);
    await attendreTotalHt(page, '70,00');
    await validerEtAccepterPiece(page);
    pieces.push(cf);

    await ouvrir(page, dac.id);
    await validerEtape(page, 'Commande passée');
    await attendreEtatExecution(page, /Terminé/);
  });

  test('Nacelle : commande fournisseur directe depuis la demande', async () => {
    await ouvrir(page, dap.id);
    const cf = await transformerVers(page, /Commande fournisseur/);
    expect(cf.numero).toMatch(/^CF\d{4}-\d+$/);
    await garderLignes(page, [nacelle.libelle]);
    await choisirTiers(page, ACHATS.FOURNISSEUR);
    await saisirPrix(page, { [nacelle.libelle]: '180' });
    await attendreTotalHt(page, '900,00');
    await validerEtAccepterPiece(page);
    pieces.push(cf);
  });

  test('Parpaings : réservation au dépôt puis transfert vers le chantier', async () => {
    await ouvrir(page, dap.id);
    const rs = await transformerVers(page, /Réservation/);
    await garderLignes(page, [STOCK.PARPAING.libelle]);
    await choisirLieu(page, 'Dépôt réservé', depot.code);
    await enregistrer(page);
    await validerEtAccepterPiece(page);
    pieces.push(rs);

    pieces.push(await transformerVers(page, /Transfert/));
    await choisirLieu(page, 'Origine (vide : entrée)', depot.code);
    await enregistrer(page);
    await validerEtAccepterPiece(page);
    // 30 m² de parpaings = 300 unités sorties du dépôt
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/700\s*u/);

    await ouvrir(page, dap.id);
    await validerEtape(page, 'Commande passée');
    await attendreEtatExecution(page, /Terminé/);
  });

  test('Sous-traitance : ordre saisi sur le chantier, appel d’offres puis commande', async () => {
    ost = await creerOrdre(page, 'E_OST', { objet: `Étanchéité terrasse e2e ${s}`, chantier: SOUS_TRAITANCE.CHANTIER, besoins: [etancheite] });
    expect(ost.numero).toMatch(/^OST\d{4}-\d+$/);
    await transmettreEtPrendreEnCharge(page);
    await validerEtape(page, 'Consultation');

    const ao = await transformerVers(page, /Appel d'offres de sous-traitance/);
    await choisirTiers(page, SOUS_TRAITANCE.SOUS_TRAITANT);
    await saisirPrix(page, { [etancheite.libelle]: '2500' });
    await attendreTotalHt(page, '2 500,00');
    await validerEtAccepterPiece(page);
    pieces.push(ao);

    const cst = await transformerVers(page, /Commande de sous-traitance/);
    expect(cst.numero).toMatch(/^CST\d{4}-\d+$/);
    await validerCommandeDansMarche(page, { venteLiee: SOUS_TRAITANCE.MARCHE_VENTE });
    await accepterSiEnvoyee(page);
    pieces.push(cst);

    await ouvrir(page, ost.id);
    await validerEtape(page, 'Attribution');
    await controlerEtape(page, 'Attribution', identifiantCompte('admin'));
    await attendreEtatExecution(page, /Terminé/);
  });

  test('Liste des ordres du chantier : demande d’approvisionnement et demande d’achat terminées', async () => {
    // Filtre par chantier de l'adresse : identifiant du chantier (la colonne Chantier porte « code – libellé »)
    await page.goto(`/liste/ordres?vue=1000&chantier=${ACHATS.CHANTIER}`);
    await expect(page.locator('.page-liste-filtre')).toContainText(ACHATS.CHANTIER);
    for (const o of [dap, dac]) {
      await page.getByPlaceholder('Rechercher…').fill(o.numero);
      await expect(page.locator('table tbody tr').filter({ hasText: o.numero })).toBeVisible({ timeout: 15000 });
    }
    await page.getByPlaceholder('Rechercher…').fill(ost.numero);
    await expect(page.getByText('Aucune ligne')).toBeVisible();
    expect(pieces).toHaveLength(7);
  });
});
