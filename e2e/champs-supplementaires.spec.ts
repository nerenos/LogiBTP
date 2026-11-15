import { test, expect } from '@playwright/test';
import { ouvrirConnecte, TAG_API } from './outils/connexion';

/**
 * Champs supplémentaires en colonnes x_ (plan versionnement-schema, lot 8) : création par l'écran d'administration,
 * présence dans l'onglet « Champs supplémentaires » d'une fiche, suppression avec confirmation.
 * Demande l'API complète et la base de développement avec la mineure Fiche 1.1 (rôle logibtp_app non propriétaire).
 */
test.describe('Champs supplémentaires des fiches', { tag: TAG_API }, () => {
  test('création, saisie dans une fiche, suppression', async ({ page }) => {
    const suffixe = Date.now().toString().slice(-6);
    const libelle = `Essai ${suffixe}`;
    const colonne = `x_essai_${suffixe}`;

    await ouvrirConnecte(page, '/parametres/champs-supplementaires', 'admin');
    // Choix de la fiche par le combo (tables ouvertes : tables des fiches ; la fiche matériel).
    const combo = page.locator('[data-fiche] input');
    await expect(combo).toBeVisible({ timeout: 10000 });
    await combo.click();
    await combo.fill('materiel');
    await combo.press('Enter');
    const nouveau = page.locator('tr[data-nouveau]');
    await expect(nouveau).toBeVisible();

    // Le nom technique est proposé d'après le libellé, puis forcé (suffixe unique).
    await nouveau.locator('[data-c="libelle"]').fill(libelle);
    await expect(nouveau.locator('[data-c="colonne"]')).toHaveValue(/^x_essai_/);
    await nouveau.locator('[data-c="colonne"]').fill(colonne);
    await nouveau.locator('button[data-action="creer"]').click();
    const ligne = page.locator('tr[data-i]', { hasText: colonne });
    await expect(ligne).toBeVisible();

    // Refus du serveur affiché sous le contrôle : le même nom technique une seconde fois.
    await nouveau.locator('[data-c="libelle"]').fill(libelle);
    await nouveau.locator('[data-c="colonne"]').fill(colonne);
    await nouveau.locator('button[data-action="creer"]').click();
    await expect(nouveau.locator('[data-erreur="colonne"]')).not.toBeEmpty();

    // Saisie dans la fiche : onglet dédié, contrôle du type texte.
    await page.goto('/fiche/materiel/nouveau');
    await page.getByRole('tab', { name: /Champs supplémentaires/ }).or(page.locator('.fiche-onglets >> text=Champs supplémentaires')).first().click();
    const champ = page.locator('.fiche-champ', { hasText: libelle }).locator('input');
    await expect(champ).toBeVisible();
    await champ.fill('valeur de test');
    await expect(champ).toHaveValue('valeur de test');

    // Suppression : fenêtre de confirmation (les données sont perdues), puis le champ disparaît.
    await page.goto('/parametres/champs-supplementaires');
    await page.locator('[data-fiche] input').fill('materiel');
    await page.locator('[data-fiche] input').press('Enter');
    await page.locator('tr[data-i]', { hasText: colonne }).locator('button[data-action="supprimer"]').click();
    await expect(page.locator('dialog[open]')).toContainText(colonne);
    await page.locator('dialog[open] button.principal').click();
    await expect(page.locator('tr[data-i]', { hasText: colonne })).toHaveCount(0);
  });
});
