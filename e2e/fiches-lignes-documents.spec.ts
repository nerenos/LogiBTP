import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import {
  suffixe, patienterSurLimiteDebit, attendreMessage, confirmer, enregistrer, onglet, ligneGrille, saisirCellule, texteCellule,
  creerDevis, attendreStatut, vueColonnes, dialogue,
} from './outils/documents';

/**
 * Fiches et lignes de documents (plan fiches-lignes-documents, lot 13) :
 * - titres courts des onglets d'une fiche en fenêtre étroite ;
 * - lien « Derniers pointages » d'un salarié vers la liste filtrée ;
 * - style paramétré d'une tranche de niveau 1 dans la grille, libellé à mise en forme saisie conservée, « Réimposer » ;
 * - icône d'écart de PA d'une ligne liée à la bibliothèque, mise à jour de la bibliothèque, icône disparue ;
 * - zone d'entête créée au paramétrage, saisie dans un devis, colonne de la liste des devis.
 * Les données créées (styles, zone, devis) sont retirées en fin de scénario.
 */
test.describe.serial('Fiches et lignes de documents', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Titres courts des onglets d’une fiche en fenêtre étroite', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/liste/salaries');
    await page.locator('table tbody tr').first().locator('td').nth(1).dblclick();
    await expect(page).toHaveURL(/\/fiche\/salarie\/\d+/);
    const nav = page.locator('.fiche nav, nav.fiche-onglets').first();
    await expect(nav.locator('button[data-court]').first()).toBeVisible();
    // Large : titres complets ; étroit : titres courts (titre complet en infobulle).
    const premier = nav.locator('button[data-court]').first();
    const complet = await premier.getAttribute('data-titre');
    await page.setViewportSize({ width: 600, height: 800 });
    await expect(async () => {
      const texte = (await premier.innerText()).trim();
      expect(texte).toContain((await premier.getAttribute('data-court'))!);
    }).toPass({ timeout: 10000 });
    await expect(premier).toHaveAttribute('title', new RegExp(complet!.slice(0, 5)));
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('Derniers pointages d’un salarié : liste filtrée', async () => {
    await page.goto('/liste/salaries');
    await page.locator('table tbody tr').filter({ hasText: 'Blanc' }).first().locator('td').nth(1).dblclick();
    await expect(page).toHaveURL(/\/fiche\/salarie\/\d+/);
    const lien = page.getByRole('button', { name: /Derniers pointages/ }).or(page.getByRole('link', { name: /Derniers pointages/ })).first();
    await expect(lien).toBeVisible({ timeout: 15000 });
    await lien.click();
    await expect(page).toHaveURL(/\/liste\/pointages\?.*salarie_id=\d+/);
    await expect(page.getByText(/Blanc/).first()).toBeVisible({ timeout: 15000 });
    // Le filtre sur la ressource est affiché et peut être retiré.
    await expect(page.getByRole('button', { name: /Retirer le filtre sur la ressource|Effacer/ }).first()).toBeVisible();
  });

  test.describe.serial('Styles des lignes', () => {
    const objet = `Devis styles e2e ${s}`;
    const tranche = `Tranche stylée e2e ${s}`;
    const rouge = `Libellé rouge e2e ${s}`;
    let stylesAvant: unknown = [];

    test('Style paramétré de la tranche de niveau 1 visible dans la grille', async () => {
      stylesAvant = await (await page.request.get('/api/styles-lignes')).json();
      // Paramétrage par l'écran : classe « Tranche de niveau 1 », gras, couleur bleue.
      await page.goto('/parametres/documents');
      const bloc = page.locator('.styles-lignes-classe').filter({ has: page.getByRole('heading', { name: /Tranche de niveau 1/ }) });
      await expect(bloc).toBeVisible({ timeout: 15000 });
      const gras = bloc.locator('label', { hasText: 'Gras' }).getByRole('switch');
      await gras.click();
      await expect(gras).toBeChecked();
      const couleur = bloc.locator('label', { hasText: 'Couleur du texte' }).locator('input').first();
      await couleur.click();
      await page.getByRole('option', { name: 'Bleu', exact: true }).click();
      await page.getByRole('button', { name: 'Enregistrer les styles' }).click();
      await attendreMessage(page, /Styles des lignes enregistrés/);

      await creerDevis(page, { objet, ligne: { libelle: `Ligne e2e ${s}`, qte: '2', unite: 'm2', pv: '10' } });
      await onglet(page, 'Lignes');
      // Une ligne passe en tranche (type Titre) : sa ligne porte le style résolu.
      const ligne = ligneGrille(page, `Ligne e2e ${s}`);
      await saisirCellule(page, ligne, 'Type', 'Titre');
      await saisirCellule(page, ligneGrille(page, `Ligne e2e ${s}`), 'Libellé', tranche);
      const tr = ligneGrille(page, tranche);
      await expect(tr).toHaveClass(/ligne-stylee/);
      await expect(tr).toHaveClass(/ls-gras/);
      await expect(tr).toHaveClass(/ls-couleur/);
    });

    test('Libellé à mise en forme saisie conservée, puis Réimposer', async () => {
      const tr = ligneGrille(page, tranche);
      // Le texte du libellé est coloré en rouge par l'éditeur riche : la couleur saisie reste.
      await tr.locator('td.col-libelle').click();
      await page.keyboard.press('Enter');
      await page.evaluate(() => {
        const editeur = document.querySelector('td.col-libelle .editeur') as HTMLElement;
        editeur.focus();
        document.execCommand('selectAll');
        document.execCommand('foreColor', false, '#ff0000');
      });
      await page.keyboard.press('Enter');
      await expect(ligneGrille(page, tranche).locator('td.col-libelle [style*="color"], td.col-libelle font[color]').first()).toBeAttached();
      await enregistrer(page);
      await expect(ligneGrille(page, tranche).locator('td.col-libelle [style*="color"], td.col-libelle font[color]').first()).toBeAttached();
      // Réimposer (menu contextuel, document entier) : la mise en forme saisie disparaît, le style paramétré reste.
      await ligneGrille(page, tranche).locator('td.col-libelle').click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Réimposer la mise en forme du document/ }).click();
      await confirmer(page);
      await attendreMessage(page, /Mise en forme réimposée/);
      await expect(ligneGrille(page, tranche).locator('td.col-libelle [style*="color"], td.col-libelle font[color]')).toHaveCount(0);
      await expect(ligneGrille(page, tranche)).toHaveClass(/ls-gras/);
      void rouge;
    });

    test('Nettoyage : styles rétablis, devis retiré', async () => {
      await page.request.put('/api/styles-lignes', { data: stylesAvant });
      await retirerDocumentCourant(page);
    });
  });

  test.describe.serial('Écart de PA avec la bibliothèque', () => {
    const objet = `Devis écart PA e2e ${s}`;

    test('Icône d’écart sur un PA modifié, mise à jour de la bibliothèque, icône disparue', async () => {
      await creerDevis(page, { objet, ligne: { libelle: `Élément PA e2e ${s}`, qte: '1', unite: 'u', pv: '100' } });
      await onglet(page, 'Lignes');
      // Ligne liée à un élément de bibliothèque : code saisi (F3 : appel de la bibliothèque), PA modifié ensuite.
      await vueColonnes(page, /^Complet/);
      const ligne = ligneGrille(page, `Élément PA e2e ${s}`);
      await saisirCellule(page, ligne, 'Code', 'MAC-001');
      await saisirCellule(page, ligneGrille(page, `Élément PA e2e ${s}`), 'PA', '1234');
      const icone = ligneGrille(page, `Élément PA e2e ${s}`).locator('button.ecart-pa');
      await expect(icone).toBeVisible({ timeout: 15000 });
      await expect(icone).toHaveAttribute('title', /bibliothèque/);
      await enregistrer(page);
      // Clic : confirmation, mise à jour de la bibliothèque.
      await icone.click();
      await dialogue(page).getByRole('button', { name: 'Mettre à jour', exact: true }).click();
      await attendreMessage(page, /élément\(s\) de la bibliothèque mis à jour/);
      await expect(ligneGrille(page, `Élément PA e2e ${s}`).locator('button.ecart-pa')).toHaveCount(0, { timeout: 15000 });
      expect(await texteCellule(page, ligneGrille(page, `Élément PA e2e ${s}`), 'PA')).toContain('1');
    });

    test('Nettoyage : devis retiré', async () => { await retirerDocumentCourant(page); });
  });

  test.describe.serial('Zone d’entête', () => {
    const libelle = `Zone e2e ${s}`;
    const colonne = `x_zone_e2e_${s}`;
    const valeur = `Valeur ${s}`;
    const objet = `Devis zone e2e ${s}`;

    test('Création au paramétrage, saisie dans un devis, colonne de la liste des devis', async () => {
      await page.goto('/parametres/documents');
      const nouveau = page.locator('.zones-entete tr[data-nouveau]');
      await expect(nouveau).toBeVisible({ timeout: 15000 });
      await nouveau.locator('[data-c="libelle"]').fill(libelle);
      await nouveau.locator('[data-c="colonne"]').fill(colonne);
      await nouveau.locator('[data-c="groupe"]').fill('Groupe e2e');
      await nouveau.locator('button[data-action="creer"]').click();
      await attendreMessage(page, new RegExp(`Zone « ${libelle} » créée`));
      await expect(page.locator('.zones-entete tr[data-i]', { hasText: colonne })).toBeVisible();

      await creerDevis(page, { objet, ligne: { libelle: `Ligne zone e2e ${s}`, qte: '1', unite: 'u', pv: '10' } });
      await onglet(page, 'Entête');
      const champ = page.locator('#vue-entete fieldset.zones-entete', { hasText: 'Groupe e2e' }).locator('input').first();
      await expect(champ).toBeVisible();
      await champ.fill(valeur);
      await enregistrer(page);
      await attendreStatut(page, 'Brouillon');

      // Colonne de la zone dans la liste des devis (choix des colonnes), valeur affichée.
      await page.goto('/liste/devis');
      await page.getByRole('button', { name: /Colonnes/ }).click();
      await page.getByRole('checkbox', { name: libelle }).check();
      await page.keyboard.press('Escape');
      await expect(page.locator('table thead th', { hasText: libelle })).toBeVisible();
      await expect(page.locator('table tbody tr', { hasText: objet })).toContainText(valeur);
    });

    test('Nettoyage : devis et zone retirés', async () => {
      await page.goto('/liste/devis');
      await page.locator('table tbody tr', { hasText: objet }).first().locator('td').nth(1).dblclick();
      await expect(page).toHaveURL(/\/document\/\d+/);
      await retirerDocumentCourant(page);
      await page.goto('/parametres/documents');
      await page.locator('.zones-entete tr[data-i]', { hasText: colonne }).locator('button[data-action="supprimer"]').click();
      await confirmer(page);
      await expect(page.locator('.zones-entete tr[data-i]', { hasText: colonne })).toHaveCount(0);
    });
  });
});

/** Retire le document ouvert (brouillon) par la route de suppression, puis revient à la liste. */
async function retirerDocumentCourant(page: Page) {
  const id = Number(new URL(page.url()).pathname.split('/').pop());
  expect(id).toBeGreaterThan(0);
  const r = await page.request.delete(`/api/documents/${id}`);
  expect(r.ok()).toBeTruthy();
  await page.goto('/liste/devis');
}
