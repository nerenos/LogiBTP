import { test, expect, type Page } from '@playwright/test';
import { seConnecter, connecterCompte, compteDeTest, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreMessage } from './outils/documents';
import { VUES, ouvrirPlanning, creerTache, choisirDansCombo } from './outils/planning';
import {
  POINTAGE, jourPasse, lundiDe, libererJour, ouvrirPointageTerrain, ligneTerrain, comboTerrain, ouvrirSynthese, ligneSynthese, celluleJourSynthese,
} from './outils/pointage';

/**
 * Pointage, méthode 2 : l'application de terrain (`/terrain`, onglet Pointage) d'un salarié connecté.
 * - Préparation (administrateur) : compte e2e_terrain du salarié « Chloé Blanc » (profil MOBILE : saisie libre pour
 *   lui seul), tâche du planning de 4 h sur CH-2026-001 le jour ouvré passé choisi ;
 * - terrain (compte du salarié) : la tâche du jour proposée « À pointer », pointée 4 h ; saisie libre de 3 h sur le
 *   chantier interne de l'atelier ; journée enregistrée, bilan « saisi 7:00 h » ;
 * - synthèse (administrateur) : 7 h le jour pointé pour le salarié.
 * Un passage précédent le même jour : lignes retirées avant la saisie (la journée enregistrée remplace la précédente).
 */
test.describe.serial('Pointage : application de terrain', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  const jour = jourPasse(1);
  const salarie = POINTAGE.TERRAIN;
  const tache = `Montage châssis e2e ${s}`;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Préparation : compte du salarié et tâche planifiée le jour pointé', async () => {
    await compteDeTest(page, { identifiant: salarie.compte, personne: `${salarie.prenom} ${salarie.nom}`, profil: 'MOBILE' });
    await libererJour(page, salarie, jour, `Reprise e2e ${s}`);
    await ouvrirPlanning(page, VUES.ATELIER_JOUR, jour);
    await creerTache(page, {
      libelle: tache, chantier: POINTAGE.CHANTIER, service: 'Atelier', debut: jour, heures: '4:00',
      ressources: [{ recherche: `${salarie.nom} ${salarie.prenom}`, libelle: new RegExp(`${salarie.nom} ${salarie.prenom}`) }],
    });
  });

  test('Terrain : tâche du jour pointée, saisie libre, journée enregistrée', async ({ browser }) => {
    const contexte = await browser.newContext({ serviceWorkers: 'block' });
    const terrain = await contexte.newPage();
    try {
      await patienterSurLimiteDebit(terrain);
      await connecterCompte(terrain, salarie.compte);
      await ouvrirPointageTerrain(terrain, jour);
      // Lignes d'un passage précédent retirées.
      while (await terrain.locator('.terrain-saisie [data-retirer]').count()) {
        const n = await terrain.locator('.terrain-saisie').count();
        await terrain.locator('.terrain-saisie [data-retirer]').first().click();
        await expect(terrain.locator('.terrain-saisie')).toHaveCount(n - 1);
      }
      // Tâche planifiée du jour : à pointer.
      const aPointer = terrain.locator('[data-pointer]').filter({ hasText: tache });
      await expect(aPointer).toBeVisible();
      await aPointer.click();
      const ligneTache = terrain.locator('.terrain-saisie').filter({ hasText: tache });
      await expect(ligneTache).toBeVisible();
      await ligneTache.locator('[data-minutes]').fill('4:00');
      await ligneTache.locator('[data-minutes]').press('Tab');

      // Saisie libre : chantier interne de l'atelier, main-d'œuvre atelier, 3 h.
      await terrain.locator('[data-libre]').click();
      const n = await terrain.locator('.terrain-saisie').count();
      const libre = ligneTerrain(terrain, n - 1);
      await choisirDansCombo(terrain, comboTerrain(libre, 'chantier'), new RegExp(`^${POINTAGE.CHANTIER_INTERNE}`), POINTAGE.CHANTIER_INTERNE);
      await choisirDansCombo(terrain, comboTerrain(ligneTerrain(terrain, n - 1), 'type'), /Main-d'œuvre atelier/);
      await ligneTerrain(terrain, n - 1).locator('[data-minutes]').fill('3:00');
      await ligneTerrain(terrain, n - 1).locator('[data-minutes]').press('Tab');
      await terrain.locator('[data-enregistrer]').click();
      await attendreMessage(terrain, 'Journée enregistrée');
      await expect(terrain.locator('[data-bilan]')).toContainText('saisi 7:00 h');
    } finally {
      await contexte.close();
    }
  });

  test('Synthèse : 7 h le jour pointé sur le terrain', async () => {
    await ouvrirSynthese(page, lundiDe(jour), salarie.nom);
    await expect(await celluleJourSynthese(page, ligneSynthese(page, salarie), jour)).toContainText('7:00');
  });
});
