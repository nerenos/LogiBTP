import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreMessage, confirmer } from './outils/documents';
import { VUES, jourOuvre, decaler, estFerieFixe, ouvrirPlanning, rechercher, ligneVue } from './outils/planning';
import { POINTAGE, ouvrirConges, ligneConge, fenetreConge, saisirConge, choisirNature } from './outils/pointage';

/**
 * Pointage : congés et absences (`/pointage/conges`), traités par le service RH (l'administrateur l'est).
 * - Demande de deux jours pour un salarié de l'atelier, sans nature : « Demandé », absence en option au planning ;
 * - demande qui chevauche la première : refusée (CNG_CHEVAUCHEMENT) ;
 * - validation RH avec la nature : « Validé », nature affichée, absence toujours au planning (couleur de la nature) ;
 * - seconde demande, refusée par le RH avec une réponse : « Refusé » ;
 * - congé validé annulé : « Annulé », absence retirée du planning (le scénario se rejoue sur d'autres dates).
 * Dates à quelques semaines, décalées d'un passage à l'autre ; commentaires uniques par passage.
 */
test.describe.serial('Pointage : congés et absences', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  const salarie = POINTAGE.CONGES;
  const nom = `${salarie.nom} ${salarie.prenom}`;
  // Deux jours ouvrés de suite (le lendemain n'est pas un férié fixe).
  let rang = 6 + (Number(s) % 12);
  while (estFerieFixe(decaler(jourOuvre(rang), 1))) rang++;
  const du = jourOuvre(rang);
  const au = decaler(du, 1);
  const autre = jourOuvre(20 + (Number(s) % 12));
  const motif = `Congé e2e ${s}`;
  const motifRefuse = `Pont e2e ${s}`;
  const periode = { du: decaler(du, -7), au: decaler(autre, 7) };
  let page: Page;
  let nature: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  /** Absences du salarié (barres de congé) sur sa ligne du planning de l'atelier, période ouverte au début du congé. */
  async function absencesAuPlanning() {
    await ouvrirPlanning(page, VUES.ATELIER_JOUR, decaler(du, -1));
    await rechercher(page, nom);
    const i = await ligneVue(page, nom).getAttribute('data-i');
    return page.locator(`.vp-barre.absence-conge[data-ligne="${i}"]`);
  }

  test('Demande de congé de deux jours, sans nature : « Demandé », absence au planning', async () => {
    await ouvrirConges(page, periode.du, periode.au, salarie.nom);
    await page.locator('[data-nouveau]').click();
    await expect(fenetreConge(page)).toContainText('Demande de congé');
    await saisirConge(page, { salarie: nom, du, au, commentaire: motif });
    await fenetreConge(page).locator('[data-enregistrer]').click();
    await attendreMessage(page, 'Congé enregistré');
    const ligne = ligneConge(page, motif);
    await expect(ligne).toContainText('Demandé');
    await expect(ligne).toContainText(nom);
    await expect(ligne.locator('td.nombre')).toHaveText('2');
    await expect(await absencesAuPlanning()).not.toHaveCount(0);
  });

  test('Demande qui chevauche la première : refusée', async () => {
    await ouvrirConges(page, periode.du, periode.au, salarie.nom);
    await page.locator('[data-nouveau]').click();
    await saisirConge(page, { salarie: nom, du: au, au, commentaire: `Doublon e2e ${s}` });
    await fenetreConge(page).locator('[data-enregistrer]').click();
    await expect(fenetreConge(page).locator('[data-erreur]')).toContainText('déjà un congé demandé ou validé sur cette période');
    await fenetreConge(page).locator('[data-fermer]').click();
    await expect(ligneConge(page, `Doublon e2e ${s}`)).toHaveCount(0);
  });

  test('Validation par le service RH avec la nature : « Validé »', async () => {
    await ouvrirConges(page, periode.du, periode.au, salarie.nom);
    await ligneConge(page, motif).click();
    await expect(fenetreConge(page)).toContainText('Congé — Demandé');
    nature = await choisirNature(page);
    await fenetreConge(page).locator('[data-reponse]').fill('Accordé');
    await fenetreConge(page).locator('[data-valider]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    const ligne = ligneConge(page, motif);
    await expect(ligne).toContainText(nature);
    await expect(ligne).toHaveClass(/etat-conge-valide/);
    await expect(await absencesAuPlanning()).not.toHaveCount(0);
  });

  test('Seconde demande refusée par le service RH avec une réponse', async () => {
    await ouvrirConges(page, periode.du, periode.au, salarie.nom);
    await page.locator('[data-nouveau]').click();
    await saisirConge(page, { salarie: nom, du: autre, au: autre, commentaire: motifRefuse });
    await fenetreConge(page).locator('[data-enregistrer]').click();
    await attendreMessage(page, 'Congé enregistré');
    await ligneConge(page, motifRefuse).click();
    await fenetreConge(page).locator('[data-reponse]').fill('Période chargée');
    await fenetreConge(page).locator('[data-refuser]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    const ligne = ligneConge(page, motifRefuse);
    await expect(ligne).toContainText('Refusé');
    await expect(ligne).toContainText('Période chargée');
  });

  test('Congé validé annulé : « Annulé », absence retirée du planning', async () => {
    await ouvrirConges(page, periode.du, periode.au, salarie.nom);
    await ligneConge(page, motif).click();
    await expect(fenetreConge(page)).toContainText('Congé — Validé');
    await fenetreConge(page).locator('[data-annuler]').click();
    await confirmer(page);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(ligneConge(page, motif)).toContainText('Annulé');
    await expect(await absencesAuPlanning()).toHaveCount(0);
  });
});
