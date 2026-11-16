import { test, expect } from '@playwright/test';
import { ouvrirConnecte, TAG_API } from './outils/connexion';

/**
 * Reprise de données MDE / OptimBTP (plan reprise-mde-optim, lot 3).
 * - Écran : ouvert par l'administrateur sur la base de développement (qui contient des données) : avertissement et
 *   boutons de lancement inactifs, correspondances par défaut téléchargeables.
 * - Parcours simulation → rapport → fusions → reprise : sur une société NEUVE seulement (E2E_REPRISE_URL, ex.
 *   http://reprise.localhost:5173) et une base source de test (tests/reprise/monter.sh : E2E_REPRISE_SOURCE = MDE ou
 *   OPTIM, E2E_REPRISE_CONNEXION = chaîne affichée par le script). Ignoré sans ces variables.
 */
test.describe('Reprise de données : écran', { tag: TAG_API }, () => {
  test('base non vide : reprise refusée, correspondances téléchargeables', async ({ page }) => {
    await ouvrirConnecte(page, '/parametres/reprise', 'admin');
    await expect(page.locator('.page-reprise')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-etat] .erreur')).toBeVisible();
    await expect(page.locator('[data-action="simuler"]')).toBeDisabled();
    await expect(page.locator('[data-action="lancer"]')).toBeDisabled();
    const telechargement = page.waitForEvent('download');
    await page.locator('[data-action="telecharger"]').click();
    expect((await telechargement).suggestedFilename()).toBe('correspondances-mde.json');
  });
});

const url = process.env.E2E_REPRISE_URL;
const source = process.env.E2E_REPRISE_SOURCE ?? 'MDE';
const connexion = process.env.E2E_REPRISE_CONNEXION;

test.describe('Reprise de données : parcours sur une société neuve', { tag: TAG_API }, () => {
  test.skip(!url || !connexion, 'E2E_REPRISE_URL et E2E_REPRISE_CONNEXION absents de e2e/.env');
  test.use({ baseURL: url });

  test('simulation, rapport, fusions puis reprise réelle', async ({ page }) => {
    test.setTimeout(300000);
    await ouvrirConnecte(page, '/parametres/reprise', 'admin');
    await expect(page.locator('[data-action="simuler"]')).toBeEnabled({ timeout: 10000 });
    const combo = page.locator('[data-source] input');
    await combo.fill(source === 'OPTIM' ? 'OptimBTP' : 'MDE');
    await combo.press('Enter');
    if (source === 'OPTIM') await page.locator('[data-c="societes"]').fill('1, 2');

    // Connexion absente : refus sous le champ.
    await page.locator('[data-action="simuler"]').click();
    await expect(page.locator('[data-erreur="connexion"]')).not.toBeEmpty();

    // Simulation : rapport affiché, exécution inscrite à l'historique, rien d'écrit.
    await page.locator('[data-c="connexion"]').fill(connexion!);
    await page.locator('[data-action="simuler"]').click();
    await expect(page.locator('[data-rapport] h2')).toBeVisible({ timeout: 240000 });
    await expect(page.locator('[data-section="tables_source"] summary')).toContainText(/\(\d{3,}\)/);
    await expect(page.locator('[data-historique] tr[data-execution]').first()).toBeVisible();

    // Doublons proposés (une fois l'annuaire repris) : le premier coché, fusions enregistrées.
    const doublon = page.locator('tr[data-doublon]').first();
    if (await doublon.count()) {
      await doublon.locator('[data-fusionner]').check();
      await page.locator('[data-action="fusions"]').click();
      await expect(page.locator('[data-erreur="fusions"]')).toBeEmpty();
    }

    // Rapport d'une exécution précédente : affichage depuis l'historique.
    await page.locator('[data-historique] [data-action="afficher"]').first().click();
    await expect(page.locator('[data-rapport] h2')).toBeVisible();

    // Reprise réelle, confirmée par la fenêtre du socle.
    await page.locator('[data-action="lancer"]').click();
    await page.locator('dialog[open] button.principal').click();
    await expect(page.locator('[data-historique] tr[data-execution]').first()).toContainText(/Reprise réelle/, { timeout: 240000 });
  });
});
