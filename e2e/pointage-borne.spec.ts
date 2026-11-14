import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreMessage } from './outils/documents';
import {
  POINTAGE, jourPasse, lundiDe, creerBorne, poserPin, ouvrirBorne, identifierBorne, allerAuJourBorne, choisirChantierBorne, lignesBorne,
  totalJourBorne, zoneBorne, ouvrirSynthese, ligneSynthese, celluleJourSynthese, devalider, libererJour,
} from './outils/pointage';

/**
 * Pointage, méthode 1 : la borne d'atelier, puis la validation de la semaine.
 * - Administration : nouvelle borne (PIN exigé, jeton affiché une fois), PIN posé pour un salarié de l'atelier ;
 * - borne (navigateur sans session, jeton de l'appareil) : identification par le PIN, journée du dernier jour ouvré
 *   passé, deux pointages (chantier CH-2026-001 en main-d'œuvre, 6 h 30 ; atelier interne en main-d'œuvre atelier,
 *   1 h), enregistrés ;
 * - synthèse de la semaine : 7 h 30 le jour pointé, salarié validé (niveau RH), jour validé ;
 * - borne : journée validée en consultation seulement ;
 * - synthèse : dévalidation avec motif (le scénario se rejoue : la journée redevient modifiable).
 * Les pointages précédents du salarié ce jour-là (passages antérieurs) sont retirés à la borne avant la saisie ; un jour
 * resté validé par un passage interrompu est d'abord dévalidé.
 */
test.describe.serial('Pointage : borne d’atelier et validation', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  const pin = String(1000 + (Number(s) % 9000));
  const jour = jourPasse(0);
  const salarie = POINTAGE.BORNE;
  let page: Page;
  let jeton: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Administration : nouvelle borne et PIN du salarié', async () => {
    jeton = await creerBorne(page, `Borne atelier e2e ${s}`);
    expect(jeton.length).toBeGreaterThan(20);
    await poserPin(page, 'Atelier', `${salarie.nom} ${salarie.prenom}`, pin);
    await libererJour(page, salarie, jour, `Reprise e2e ${s}`);
  });

  test('Borne : identification par PIN, deux pointages sur un jour passé, enregistrés', async ({ browser }) => {
    const borne = await ouvrirBorne(browser, jeton);
    try {
      // PIN faux : refusé, retour au clavier.
      await borne.locator('[data-cherche]').fill(salarie.nom);
      await borne.locator('.borne-carte').filter({ hasText: `${salarie.prenom} ${salarie.nom}` }).click();
      for (const k of '0000') await borne.locator(`[data-k="${k}"]`).click();
      await borne.locator('[data-k="ok"]').click();
      await expect(zoneBorne(borne).locator('.borne-entete-saisie')).toHaveCount(0);
      await expect(zoneBorne(borne)).toContainText(/PIN/);
      if (await borne.locator('[data-annuler]').isVisible()) await borne.locator('[data-annuler]').click();

      await identifierBorne(borne, salarie, pin);
      await allerAuJourBorne(borne, jour);
      // Pointages d'un passage précédent ce jour-là : retirés (la journée enregistrée remplace la précédente).
      await borne.locator('[data-liste]').click();
      await expect(zoneBorne(borne).locator('.borne-entete-saisie')).toContainText('Pointages du jour');
      while (await borne.locator('[data-retirer]').count()) {
        const n = await lignesBorne(borne).count();
        await borne.locator('[data-retirer]').first().click();
        await expect(lignesBorne(borne)).toHaveCount(n - 1);
      }
      await borne.locator('[data-ajouter]').click();

      await choisirChantierBorne(borne, POINTAGE.CHANTIER, POINTAGE.TYPE_MO, 'Production');
      await expect(lignesBorne(borne)).toHaveCount(1);
      const duree = lignesBorne(borne).first().locator('[data-duree]');
      await duree.fill('6:30');
      await duree.dispatchEvent('change');
      await borne.locator('[data-ajouter]').click();
      await choisirChantierBorne(borne, POINTAGE.CHANTIER_INTERNE, POINTAGE.TYPE_MO_ATELIER);
      await expect(lignesBorne(borne)).toHaveCount(2);
      // Durée fréquente « 1:00 h » appliquée à la ligne qui a le focus (la nouvelle).
      await lignesBorne(borne).nth(1).locator('[data-duree]').focus();
      await borne.locator('[data-rapide="60"]').click();
      await expect(lignesBorne(borne).nth(1).locator('[data-duree]')).toHaveValue('1:00');
      await expect(totalJourBorne(borne)).toHaveText('7:30 h');
      await borne.locator('[data-enregistrer]').click();
      await expect(zoneBorne(borne)).toContainText('7:30 h enregistrées', { timeout: 15000 });
    } finally {
      await borne.context().close();
    }
  });

  test('Synthèse : 7 h 30 le jour pointé, semaine du salarié validée', async () => {
    await ouvrirSynthese(page, lundiDe(jour), salarie.nom);
    const ligne = ligneSynthese(page, salarie);
    const cellule = await celluleJourSynthese(page, ligne, jour);
    await expect(cellule).toContainText('7:30');
    await ligne.locator('[data-choix]').check();
    await page.locator('[data-valider]').click();
    await attendreMessage(page, /1 salarié\(s\) validé\(s\)/);
    await expect(await celluleJourSynthese(page, ligneSynthese(page, salarie), jour)).toHaveClass(/etat-valide/);
  });

  test('Borne : journée validée en consultation seulement', async ({ browser }) => {
    const borne = await ouvrirBorne(browser, jeton);
    try {
      await identifierBorne(borne, salarie, pin);
      await allerAuJourBorne(borne, jour);
      // Journée bloquée : la borne passe directement à la liste, en lecture.
      await expect(zoneBorne(borne)).toContainText('Journée validée : consultation seulement.');
      await expect(lignesBorne(borne)).toHaveCount(2);
      await expect(borne.locator('[data-enregistrer]')).toHaveCount(0);
      await expect(borne.locator('[data-duree]')).toHaveCount(0);
    } finally {
      await borne.context().close();
    }
  });

  test('Synthèse : dévalidation avec motif', async () => {
    await ouvrirSynthese(page, lundiDe(jour), salarie.nom);
    await devalider(page, salarie, `Correction e2e ${s}`);
    await expect(await celluleJourSynthese(page, ligneSynthese(page, salarie), jour)).toHaveClass(/etat-non_valide/);
  });
});
