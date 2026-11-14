import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit } from './outils/documents';
import {
  PLANNING, VUES, jourOuvre, decaler, detailEquipe, composition, ajouterMembre, membre, actionMembre, enregistrerEquipe, choisirDansCombo,
  dateFr, ouvrirPlanning, creerTache, panneauTache, rechercher, barresSurLigne,
} from './outils/planning';

/**
 * Planning : composition des équipes (`/planning/equipes`) et emploi d'une équipe sur une tâche.
 * - Nouvelle équipe du service Pose : deux salariés et un matériel, chef désigné ; enregistrée, listée avec son chef et
 *   son effectif ;
 * - nouvelle composition datée (une semaine plus tard) : reprend les membres de la précédente, un salarié remplacé ; la
 *   précédente s'arrête la veille ;
 * - tâche du planning (vue « Pose par semaine ») confiée à l'équipe : avant le changement, les membres de la première
 *   composition ; après, ceux de la seconde.
 * Les membres sont choisis parmi les ressources du service Chantier de la démonstration ; une équipe neuve par passage
 * (code unique), jamais supprimée.
 */
test.describe.serial('Planning : composition des équipes', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });

  const s = suffixe();
  const code = `E2E${s}`;
  const libelle = `Équipe pose e2e ${s}`;
  // Première composition : à partir d'aujourd'hui ; seconde : le lendemain du premier jour ouvré choisi.
  const jour1 = jourOuvre(0);
  const changement = decaler(jour1, 1);
  const jour2 = jourOuvre(1);
  const membres1 = [PLANNING.SALARIE_CHANTIER, PLANNING.SALARIE_CHANTIER_2];
  const remplacant = 'Boyer Raphaël';

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Nouvelle équipe : deux salariés, un matériel, un chef', async () => {
    await page.goto('/planning/equipes');
    await expect(page.locator('[data-liste]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-nouvelle]').click();
    const d = detailEquipe(page);
    await expect(d.getByRole('heading', { name: 'Nouvelle équipe' })).toBeVisible();
    // Chaque champ validé redessine le détail : saisie champ par champ, reprise si elle est perdue.
    await expect(async () => {
      await d.locator('[data-code]').fill(code);
      await d.locator('[data-code]').press('Tab');
      await d.locator('[data-libelle]').fill(libelle);
      await d.locator('[data-libelle]').press('Tab');
      await expect(d.locator('[data-code]')).toHaveValue(code, { timeout: 1000 });
      await expect(d.locator('[data-libelle]')).toHaveValue(libelle, { timeout: 1000 });
    }).toPass({ timeout: 15000 });
    await choisirDansCombo(page, d.getByRole('combobox', { name: "Service de l'équipe" }), '↳ Pose');
    await expect(d.locator('p.erreur')).toHaveCount(0);

    const bloc = d.locator('.periode-equipe').first();
    for (const m of membres1) await ajouterMembre(page, bloc, m, new RegExp(m));
    await ajouterMembre(page, bloc, 'M00022', /M00022/);
    await expect(bloc.locator('.pe-resume')).toHaveText('3 membres');
    // Chef : un salarié ; le matériel ne peut pas l'être (pas de bouton).
    await expect(membre(bloc, /M00022/).locator('[data-chef]')).toHaveCount(0);
    await actionMembre(bloc, PLANNING.SALARIE_CHANTIER, 'chef');
    await expect(membre(detailEquipe(page).locator('.periode-equipe').first(), PLANNING.SALARIE_CHANTIER).locator('.chef-equipe')).toBeVisible();

    await enregistrerEquipe(page);
    await expect(d.getByRole('heading', { name: `${code} — ${libelle}` })).toBeVisible();
    const ligne = page.locator('[data-liste] tr').filter({ hasText: code });
    await expect(ligne).toContainText(PLANNING.SALARIE_CHANTIER);
    await expect(ligne.locator('td.nombre')).toHaveText('3');
  });

  test('Nouvelle composition datée : membres repris, un salarié remplacé, la précédente s’arrête la veille', async () => {
    const d = detailEquipe(page);
    const date = d.locator('[data-date-periode]');
    await date.fill(dateFr(changement));
    await date.press('Tab');
    await d.locator('[data-nouvelle-periode]').click();
    const nouvelle = await composition(page, changement);
    await expect(nouvelle.locator('.pe-resume')).toHaveText('3 membres');
    await actionMembre(nouvelle, PLANNING.SALARIE_CHANTIER_2, 'retirer');
    await ajouterMembre(page, await composition(page, changement), remplacant, new RegExp(remplacant));
    const apres = await composition(page, changement);
    await expect(apres.locator('li.ligne-ressource')).toHaveCount(3);
    await expect(membre(apres, PLANNING.SALARIE_CHANTIER_2)).toHaveCount(0);
    // Chef repris de la composition précédente.
    await expect(membre(apres, PLANNING.SALARIE_CHANTIER).locator('.chef-equipe')).toBeVisible();

    await enregistrerEquipe(page);
    // Compositions de la plus récente à la plus ancienne : la première créée est la dernière affichée.
    const avant = detailEquipe(page).locator('.periode-equipe').last();
    await expect(avant).toContainText(`jusqu'au ${dateFr(decaler(changement, -1))}`);
    await expect(await composition(page, changement)).toContainText('sans fin');
  });

  test('Tâche confiée à l’équipe : membres de la composition à la date de début', async () => {
    await ouvrirPlanning(page, VUES.POSE_SEMAINE);
    // Avant le changement : première composition.
    const t1 = `Pose équipe avant e2e ${s}`;
    await creerTache(page, { libelle: t1, chantier: PLANNING.CHANTIER, service: '↳ Pose', debut: jour1, heures: '7:00', equipe: libelle });
    const ressources1 = panneauTache(page).locator('ul').first();
    for (const m of membres1) await expect(ressources1).toContainText(m);
    await expect(ressources1).toContainText('M00022');
    await rechercher(page, PLANNING.SALARIE_CHANTIER_2);
    await expect(await barresSurLigne(page, PLANNING.SALARIE_CHANTIER_2, t1)).toHaveCount(1);

    // Après le changement : le remplaçant à la place.
    const t2 = `Pose équipe après e2e ${s}`;
    await creerTache(page, { libelle: t2, chantier: PLANNING.CHANTIER, service: '↳ Pose', debut: jour2, heures: '7:00', equipe: libelle });
    const ressources2 = panneauTache(page).locator('ul').first();
    await expect(ressources2).toContainText(remplacant);
    await expect(ressources2).toContainText(PLANNING.SALARIE_CHANTIER);
    await expect(ressources2).not.toContainText(PLANNING.SALARIE_CHANTIER_2);
  });
});
