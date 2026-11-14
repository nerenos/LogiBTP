import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreStatut, attendreTotalHt, enregistrer, valider, onglet, saisirCellule, ligneGrille } from './outils/documents';
import { validerCommandeDansMarche, SOUS_TRAITANCE } from './outils/sous-traitance';
import { creerDepot, pieceStockValidee, quantiteEnStock, choisirLieu, STOCK, type Lieu } from './outils/stock';
import {
  vendre, lancerOrdreExecution, transformerVers, garderLignes, libellesLignes, ouvrir, validerEtape, controlerEtape, celluleEtape,
  attendreEtatExecution, choisirTiers, type Vente, type Piece,
} from './outils/execution';
import { ACHATS } from './outils/achats';

/**
 * Ordres, parcours 1 : du devis vendu à l'exécution, ramifiée en cinq branches.
 * Devis de cinq lignes (menuiseries fabriquées, garde-corps achetés, parpaings du stock, plomberie sous-traitée, pose)
 * accepté → commande validée dans un nouveau marché → ordre d'exécution lancé depuis le marché, pris en charge, lancement
 * validé et contrôlé → une branche par ligne, chaque ordre suivant gardant sa ligne :
 * - fabrication : ordre de fabrication (étapes fabrication et contrôle qualité : terminé) → ordre de livraison ;
 * - achat : demande d'achat → commande fournisseur (fournisseur choisi : la pièce ne reprend pas le client de l'ordre) ;
 * - stock : demande d'approvisionnement → réservation sur un dépôt approvisionné → transfert vers le chantier ;
 * - sous-traitance : ordre de sous-traitance → commande de sous-traitance validée dans un marché de sous-traitance ;
 * - pose : ordre de pose (étapes pose et réception).
 * Enfin, la vue d'exécution du chantier montre les ordres et l'état des services.
 */
test.describe.serial('Ordres : devis, ordre d’exécution et ses branches', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  const menuiseries = { libelle: `Menuiseries bois e2e ${s}`, qte: '4', unite: 'u', pv: '1200', nature: 'FABAT' };
  const gardeCorps = { libelle: `Garde-corps alu e2e ${s}`, qte: '6', unite: 'ml', pv: '150', nature: 'MAT' };
  const plomberie = { libelle: `Plomberie e2e ${s}`, qte: '1', unite: 'ens', pv: '3000', nature: 'ST' };
  const pose = { libelle: `Pose menuiseries e2e ${s}`, qte: '2', unite: 'j', pv: '600', nature: 'MO_POSE' };
  const parpaings = { ...STOCK.PARPAING, qte: '20' };

  let page: Page;
  let depot: Lieu;
  let vente: Vente;
  let oe: Piece;
  let dac: Piece;
  let dap: Piece;
  let ost: Piece;
  const ordres: Record<string, Piece> = {};

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Préparation : dépôt approvisionné en parpaings', async () => {
    depot = await creerDepot(page, `Dépôt ordres e2e ${s}`);
    await pieceStockValidee(page, 'S_ENTREE', { objet: `Entrée ordres e2e ${s}`, lieux: { Destination: depot.code }, lignes: [{ ...STOCK.PARPAING, qte: '100' }] });
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/1\s000\s*u/);
  });

  test('Devis accepté, commande validée dans un nouveau marché', async () => {
    vente = await vendre(page, { objet: `Menuiseries et plomberie e2e ${s}`, chantier: `Chantier ordres e2e ${s}`, lignes: [menuiseries, gardeCorps, plomberie, pose], articles: [parpaings] });
    expect(vente.marche.code).toBe(`M-${vente.chantier.code.slice(3)}-1`);
  });

  test('Ordre d’exécution lancé depuis le marché, pris en charge, lancement validé et contrôlé', async () => {
    oe = await lancerOrdreExecution(page, vente.marche.id);
    expect(oe.numero).toMatch(/^OE\d{4}-\d+$/);
    // Lignes des commandes du marché reprises
    const lignes = await libellesLignes(page);
    expect(lignes).toHaveLength(5);
    await valider(page);
    await attendreStatut(page, 'Pris en charge');
    // Lancement : contrôle du N+1 bloquant ; l'administrateur valide et contrôle
    await validerEtape(page, 'Lancement', { auteur: 'e2eadmin' });
    await controlerEtape(page, 'Lancement', 'e2eadmin');
  });

  test('Fabrication : ordre de fabrication terminé puis ordre de livraison', async () => {
    await ouvrir(page, oe.id);
    const of = ordres.fabrication = await transformerVers(page, /Ordre de fabrication/);
    expect(of.numero).toMatch(/^OF\d{4}-\d+$/);
    await garderLignes(page, [menuiseries.libelle]);
    await valider(page);
    await attendreStatut(page, 'Pris en charge');
    // Débit (étape masquée) validé d'office avec la fabrication ; contrôle qualité : contrôle du N+1 en simple alerte
    await validerEtape(page, 'Fabrication');
    await validerEtape(page, 'Contrôle qualité');
    await attendreEtatExecution(page, /Terminé/);

    const li = ordres.livraison = await transformerVers(page, /Ordre de livraison/);
    expect(li.numero).toMatch(/^LI\d{4}-\d+$/);
    expect(await libellesLignes(page)).toEqual([expect.stringContaining(menuiseries.libelle)]);
    await valider(page);
    await validerEtape(page, 'Livraison');
    await attendreEtatExecution(page, /Terminé/);
  });

  test('Achat : demande d’achat puis commande fournisseur', async () => {
    await ouvrir(page, oe.id);
    dac = await transformerVers(page, /Demande d'achat/);
    await garderLignes(page, [gardeCorps.libelle]);
    await valider(page);
    await validerEtape(page, 'Consultation');

    const cf = await transformerVers(page, /Commande fournisseur/);
    expect(cf.numero).toMatch(/^CF\d{4}-\d+$/);
    // Ni le client de l'ordre ni son marché de vente : fournisseur à choisir, chantier gardé
    const ratt = page.getByRole('group', { name: 'Rattachement' });
    await expect(ratt.getByRole('textbox', { name: 'Chantier', exact: true })).toHaveValue(vente.chantier.code);
    await expect(ratt.getByRole('textbox', { name: 'Marché', exact: true })).toHaveValue('');
    await expect(page.getByRole('group', { name: 'Annuaire du document' })).not.toContainText('SCI Les Érables');
    await choisirTiers(page, ACHATS.FOURNISSEUR);
    // Prix d'achat négocié par l'acheteur (l'ordre ne porte que le prix de vente)
    await onglet(page, 'Lignes');
    await saisirCellule(page, ligneGrille(page, gardeCorps.libelle), 'PV', '120');
    await enregistrer(page);
    await attendreTotalHt(page, '720,00');
    // Commande fournisseur sans validation du tiers attendue : validée d'office
    await valider(page);
    await attendreStatut(page, 'Validé');

    await ouvrir(page, dac.id);
    await validerEtape(page, 'Commande passée');
    await attendreEtatExecution(page, /Terminé/);
  });

  test('Stock : demande d’approvisionnement, réservation au dépôt, transfert vers le chantier', async () => {
    await ouvrir(page, oe.id);
    dap = await transformerVers(page, /Demande d'approvisionnement/);
    await garderLignes(page, [STOCK.PARPAING.libelle]);
    await valider(page);
    await validerEtape(page, 'Expression du besoin');

    const rs = await transformerVers(page, /Réservation/);
    expect(rs.numero).toMatch(/^RS\d{4}-\d+$/);
    await choisirLieu(page, 'Dépôt réservé', depot.code);
    await enregistrer(page);
    await valider(page);
    await attendreStatut(page, 'Validé');

    await transformerVers(page, /Transfert/);
    await choisirLieu(page, 'Origine (vide : entrée)', depot.code);
    await enregistrer(page);
    await valider(page);
    await attendreStatut(page, 'Validé');
    // 20 m² de parpaings = 200 unités sorties du dépôt
    await expect(await quantiteEnStock(page, depot, STOCK.PARPAING.libelle)).toContainText(/800\s*u/);

    await ouvrir(page, dap.id);
    await validerEtape(page, 'Commande passée');
    await attendreEtatExecution(page, /Terminé/);
  });

  test('Sous-traitance : ordre de sous-traitance puis commande de sous-traitance', async () => {
    await ouvrir(page, oe.id);
    ost = await transformerVers(page, /Ordre de sous-traitance/);
    await garderLignes(page, [plomberie.libelle]);
    await valider(page);
    await validerEtape(page, 'Consultation');

    const cst = await transformerVers(page, /Commande de sous-traitance/);
    expect(cst.numero).toMatch(/^CST\d{4}-\d+$/);
    await choisirTiers(page, SOUS_TRAITANCE.SOUS_TRAITANT);
    await validerCommandeDansMarche(page, { venteLiee: vente.marche.code });
    await attendreStatut(page, 'Validé');

    // Attribution : contrôle du N+1 bloquant, fait par l'administrateur
    await ouvrir(page, ost.id);
    await validerEtape(page, 'Attribution');
    await controlerEtape(page, 'Attribution', 'e2eadmin');
    await attendreEtatExecution(page, /Terminé/);
  });

  test('Pose : ordre de pose, pose et réception', async () => {
    await ouvrir(page, oe.id);
    const po = ordres.pose = await transformerVers(page, /Ordre de pose/);
    expect(po.numero).toMatch(/^PO\d{4}-\d+$/);
    await garderLignes(page, [pose.libelle]);
    await valider(page);
    await validerEtape(page, 'Pose');
    await validerEtape(page, 'Réception');
    await controlerEtape(page, 'Réception', 'e2eadmin');
    await attendreEtatExecution(page, /Terminé/);
    expect(await celluleEtape(page, 'Validation', 'Pose').then((c) => c.innerText())).toContain('e2eadmin');
  });

  test('Vue d’exécution du chantier : ordres et états des services', async () => {
    await page.goto(`/execution/chantier/${vente.chantier.id}`);
    await expect(page.locator('h1.page-titre')).toContainText(vente.chantier.code, { timeout: 15000 });
    // Services porteurs des ordres terminés : atelier (fabrication), logistique (livraison : service de son type, pas
    // celui de l'ordre de fabrication dont elle est issue), pose
    const etats = page.locator('[data-etats]');
    for (const service of ['Atelier', 'Logistique (colisage, livraison)', 'Pose']) {
      await expect(etats.locator('tr').filter({ hasText: service })).toContainText('Terminé');
    }
    // Ordres du chantier regroupés par service ; ordres sans service par défaut (exécution, demandes, sous-traitance) à part
    const liste = page.locator('[data-ordres]');
    for (const o of [oe, dac, dap, ost, ...Object.values(ordres)]) await expect(liste).toContainText(o.numero);
    await expect(liste.locator('tr').filter({ hasText: oe.numero })).toContainText('EN_COURS');
    for (const o of [dac, dap, ost, ...Object.values(ordres)]) await expect(liste.locator('tr').filter({ hasText: o.numero })).toContainText('TERMINE');
  });
});
