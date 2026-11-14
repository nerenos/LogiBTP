import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreMessage } from './outils/documents';
import {
  PLANNING, VUES, jourOuvre, decaler, ouvrirPlanning, rechercher, creerTache, barres, barresSurLigne, ligneVue, finTache, selectionner, supprimerSelection,
  panneauTache, ongletPanneau, decorationsSurLigne, choisirDansCombo, choisirEtat, enregistrerTache, type Vue,
} from './outils/planning';

/**
 * Planning : une série par vue fournie (089_planning), chacune sur son regroupement et son échelle.
 * - Atelier par jour (ressources, jour) : tâche d'un salarié de l'atelier, fin calculée par le calendrier, copie
 *   (Ctrl+D) annulée (Ctrl+Z) puis rétablie (Ctrl+Y), suppression ;
 * - Pose par semaine (ressources, demi-journée) : tâche d'un salarié et d'un matériel du chantier, une barre par
 *   ressource, modification des heures, état « Confirmé » ;
 * - Chantiers (Gantt) (chantiers, semaine) : tâche sur la ligne de son chantier, jalon saisi sur le chantier ;
 * - Charge par service (services, jour) : tâche théorique (sans ressource) sur la ligne du service, charge du jour ;
 * - Livraisons (ressources, heure) : tâche de deux heures du service Logistique, fin à l'heure près.
 * Les tâches gardent un libellé unique par passage (aucun nettoyage, sauf la suppression testée).
 */

const s = suffixe();

/** Page connectée par série (un compte par contexte de navigateur), limite de débit gérée. */
function seriePlanning(vue: Vue) {
  const etat: { page?: Page } = {};
  test.beforeAll(async ({ browser }) => {
    etat.page = await browser.newPage();
    await patienterSurLimiteDebit(etat.page);
    await seConnecter(etat.page, 'admin');
  });
  test.afterAll(async () => { await etat.page?.close(); });
  test(`Ouverture de la vue « ${vue.libelle} » : échelle et lignes`, async () => {
    const page = etat.page!;
    await ouvrirPlanning(page, vue);
    await expect(page.locator('[data-echelle]').getByRole('combobox')).toHaveValue(vue.echelle);
    await expect(page.locator('.vp-ligne').first()).toBeVisible();
    await expect(page.locator('.vp-entete-ligne').first()).not.toBeEmpty();
  });
  return () => etat.page!;
}

test.describe.serial('Planning : vue « Atelier par jour »', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });
  const page = seriePlanning(VUES.ATELIER_JOUR);
  const jour = jourOuvre(0);
  const libelle = `Débit menuiseries e2e ${s}`;

  test('Tâche d’un salarié de l’atelier : barre sur sa ligne, fin calculée par le calendrier', async () => {
    const p = page();
    await rechercher(p, PLANNING.SALARIE_ATELIER);
    await expect(ligneVue(p, 'Atelier')).toBeVisible();
    await creerTache(p, {
      libelle, chantier: PLANNING.CHANTIER, service: 'Atelier', debut: jour, heures: '7:00',
      ressources: [{ recherche: PLANNING.SALARIE_ATELIER, libelle: new RegExp(PLANNING.SALARIE_ATELIER) }],
    });
    // 7 h depuis 8 h, pause de midi comprise : fin à 16 h le même jour.
    await expect(finTache(p)).toHaveValue(`${jour}T16:00`);
    await expect(await barresSurLigne(p, PLANNING.SALARIE_ATELIER, libelle)).toHaveCount(1);
    await expect(barres(p, libelle).first()).toContainText(PLANNING.CHANTIER);
  });

  test('Copie de la tâche (Ctrl+D), annulée (Ctrl+Z) puis rétablie (Ctrl+Y)', async () => {
    const p = page();
    const barre = barres(p, libelle).first();
    await selectionner(p, barre, libelle);
    await barre.press('Control+d');
    await attendreMessage(p, 'Tâche copiée');
    await expect(barres(p, libelle)).toHaveCount(2);
    await expect(p.locator('[data-annuler]')).toBeEnabled();
    await p.locator('[data-annuler]').click();
    await expect(barres(p, libelle)).toHaveCount(1, { timeout: 10000 });
    await expect(p.locator('[data-retablir]')).toBeEnabled();
    await p.locator('[data-retablir]').click();
    await expect(barres(p, libelle)).toHaveCount(2, { timeout: 10000 });
  });

  test('Suppression des deux tâches (Suppr)', async () => {
    const p = page();
    await supprimerSelection(p, barres(p, libelle).first(), libelle);
    await supprimerSelection(p, barres(p, libelle).first(), libelle);
    await expect(barres(p, libelle)).toHaveCount(0);
  });
});

test.describe.serial('Planning : vue « Pose par semaine »', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });
  const page = seriePlanning(VUES.POSE_SEMAINE);
  const jour = jourOuvre(1);
  const libelle = `Pose bardage e2e ${s}`;

  test('Tâche d’un salarié et d’un matériel du chantier : une barre par ressource', async () => {
    const p = page();
    await creerTache(p, {
      libelle, chantier: PLANNING.CHANTIER, service: '↳ Pose', debut: jour, heures: '14:00',
      ressources: [
        { recherche: PLANNING.SALARIE_CHANTIER, libelle: new RegExp(PLANNING.SALARIE_CHANTIER) },
        { recherche: 'M00022', libelle: /M00022/ },
      ],
    });
    // 14 h depuis 8 h : plus d'une journée, fin un jour suivant (selon le calendrier du service).
    await expect.poll(async () => {
      const fin = (await finTache(p).inputValue()).slice(0, 10);
      return fin > jour && fin <= decaler(jour, 5);
    }).toBe(true);
    await rechercher(p, PLANNING.SALARIE_CHANTIER);
    await expect(await barresSurLigne(p, PLANNING.SALARIE_CHANTIER, libelle)).toHaveCount(1);
    await rechercher(p, 'M00022');
    await expect(await barresSurLigne(p, /M00022/, libelle)).toHaveCount(1);
  });

  test('Heures et état modifiés depuis le panneau', async () => {
    const p = page();
    await rechercher(p, PLANNING.SALARIE_CHANTIER);
    await selectionner(p, barres(p, libelle).first(), libelle);
    const heures = panneauTache(p).getByRole('textbox', { name: 'Heures', exact: true });
    await heures.fill('7:00');
    await heures.press('Tab');
    await choisirEtat(p, /Confirm/);
    await enregistrerTache(p);
    await expect(finTache(p)).toHaveValue(`${jour}T16:00`);
    await expect(barres(p, libelle).first()).toHaveClass(/etat-/);
  });
});

test.describe.serial('Planning : vue « Chantiers (Gantt) »', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });
  const page = seriePlanning(VUES.CHANTIERS_GANTT);
  const jour = jourOuvre(0);
  const libelle = `Gros œuvre e2e ${s}`;
  const jalon = `Réception e2e ${s}`;

  test('Tâche sur la ligne de son chantier', async () => {
    const p = page();
    await creerTache(p, {
      libelle, chantier: PLANNING.CHANTIER_GANTT, service: 'Chantier (travaux)', debut: jour, heures: '21:00',
      ressources: [{ recherche: PLANNING.SALARIE_CHANTIER_2, libelle: new RegExp(PLANNING.SALARIE_CHANTIER_2) }],
    });
    await rechercher(p, PLANNING.CHANTIER_GANTT);
    const barre = (await barresSurLigne(p, PLANNING.CHANTIER_GANTT, libelle)).first();
    await expect(barre).toBeVisible();
    // Vue par chantier : la barre nomme ses ressources.
    await expect(barre).toContainText(PLANNING.SALARIE_CHANTIER_2);
  });

  test('Jalon saisi sur le chantier : listé dans l’onglet Jalons et posé sur la ligne du chantier', async () => {
    const p = page();
    await ongletPanneau(p, 'Jalons');
    const zone = p.locator('[data-panneau="jalons"]');
    // L'onglet se redessine après chaque chargement du planning (saisie perdue) : saisie reprise jusqu'à être complète.
    await expect(async () => {
      await zone.locator('[data-jalon-quand]').fill(`${jour}T12:00`);
      await zone.locator('[data-jalon-libelle]').fill(jalon);
      await choisirDansCombo(p, zone.locator('[data-jalon-chantier]').getByRole('combobox'), new RegExp(`^${PLANNING.CHANTIER_GANTT}`));
      await expect(zone.locator('[data-jalon-libelle]')).toHaveValue(jalon, { timeout: 500 });
      await expect(zone.locator('[data-jalon-quand]')).toHaveValue(`${jour}T12:00`, { timeout: 500 });
      await expect(zone.locator('[data-jalon-chantier]').getByRole('combobox')).toHaveValue(new RegExp(`^${PLANNING.CHANTIER_GANTT}`), { timeout: 500 });
    }).toPass({ timeout: 20000 });
    await zone.locator('[data-ajouter-jalon]').click();
    await attendreMessage(p, 'Jalon ajouté');
    await expect(p.locator('[data-panneau="jalons"]')).toContainText(jalon);
    await expect((await decorationsSurLigne(p, PLANNING.CHANTIER_GANTT_LIGNE)).and(p.locator(`.vp-deco.jalon[title*="${jalon}"]`))).toHaveCount(1);
    // Jalon retiré (il resterait sur les passages suivants).
    await p.locator('[data-panneau="jalons"] li').filter({ hasText: jalon }).locator('[data-suppr-jalon]').click();
    await attendreMessage(p, 'Jalon supprimé');
    await expect(p.locator('[data-panneau="jalons"]')).not.toContainText(jalon);
  });
});

test.describe.serial('Planning : vue « Charge par service »', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });
  const page = seriePlanning(VUES.CHARGE_SERVICE);
  const jour = jourOuvre(2);
  const libelle = `Métrés théoriques e2e ${s}`;

  test('Tâche théorique (sans ressource) sur la ligne du service, hachurée', async () => {
    const p = page();
    await creerTache(p, { libelle, chantier: PLANNING.CHANTIER, service: "Bureau d'études", debut: jour, heures: '3:30' });
    await expect(panneauTache(p)).toContainText('Aucune : tâche théorique');
    await rechercher(p, "Bureau d'études");
    const barre = (await barresSurLigne(p, "Bureau d'études", libelle)).first();
    await expect(barre).toBeVisible();
    await expect(barre).toHaveClass(/theorique/);
  });

  test('Charge du jour du service : planifié au-delà de la capacité (service sans ressource)', async () => {
    const p = page();
    // Bloc de charge du jour sur la ligne du service (bulle « date : planifié … · capacité … »).
    const bloc = (await decorationsSurLigne(p, "Bureau d'études")).and(p.locator(`.vp-deco[title^="${jour} "]`));
    await expect(bloc).toHaveCount(1);
    await expect(bloc).toHaveAttribute('title', /planifié \d+:\d\d h/);
    // Les tâches théoriques de passages précédents peuvent s'ajouter le même jour : au moins les 3 h 30 de celle-ci.
    const planifie = /planifié (\d+):(\d\d)/.exec((await bloc.getAttribute('title'))!)!;
    expect(Number(planifie[1]) * 60 + Number(planifie[2])).toBeGreaterThanOrEqual(210);
    // Aucune ressource dans le service : capacité nulle, charge pleine.
    await expect(bloc).toHaveClass(/charge-plein/);
  });
});

test.describe.serial('Planning : vue « Livraisons »', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });
  const page = seriePlanning(VUES.LIVRAISONS);
  const jour = jourOuvre(0);
  const libelle = `Livraison menuiseries e2e ${s}`;

  test('Tâche de deux heures du service Logistique : fin à l’heure près, barre sur la ligne du service', async () => {
    const p = page();
    await creerTache(p, { libelle, chantier: PLANNING.CHANTIER, service: 'Logistique (colisage, livraison)', debut: jour, heure: '09:00', heures: '2:00' });
    await expect(finTache(p)).toHaveValue(`${jour}T11:00`);
    // Échelle de l'heure : seules les barres de la partie visible sont dessinées, période ouverte au jour de la tâche.
    await ouvrirPlanning(p, VUES.LIVRAISONS, jour);
    await expect(await barresSurLigne(p, /Logistique/, libelle)).toHaveCount(1);
  });
});
