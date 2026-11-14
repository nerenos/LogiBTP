import { test, expect, type Browser, type Page } from '@playwright/test';
import { seConnecter, connecterCompte, compteDeTest, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreMessage } from './outils/documents';
import { choisirDansCombo } from './outils/planning';
import {
  CRM, optionSalarie, echeanceDans, pageNote, comboNote, nouvelleNote, saisirNote, enregistrerNote, ouvrirNote, etatNote, ouvrirNotes, ligneNote, ajouterRappel,
} from './outils/crm';

/**
 * CRM : une note par type de la démonstration (Note, Appel téléphonique, Courriel, Visite, Réunion, Relance), chacune
 * sur une règle des notes ; l'administrateur (sans individu) et une salariée du service Administration (bureau),
 * connectée par son compte (profil SAISIE), qui reçoit les messages et les tâches.
 * - 📝 Note : action « Pour mémo » rattachée à un tiers, dans le fil ; close (discrète) dans « Créées par moi » ;
 * - 📞 Appel : action à faire avec échéance et rappel à date, listé dans « Mes rappels » (à venir), traité ;
 * - ✉ Courriel : message à la salariée, non lu dans ses « Reçues », lu à l'ouverture, réponse ; l'auteur voit « lu » et
 *   la réponse ;
 * - 🚶 Visite : tâche confiée à la salariée (échéance, rappel avant l'échéance), terminée par elle ;
 * - 👥 Réunion : note privée de la salariée, masquée pour l'administrateur, levée du masquage journalisée ;
 * - 🔁 Relance : tâche à prendre par le service, prise par la salariée depuis « À prendre » (En cours, responsable).
 * Objets uniques par passage, notes jamais supprimées.
 */
test.describe.serial('CRM : notes par type', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  const salariee = CRM.SALARIEE;
  const nomSalariee = `${salariee.prenom} ${salariee.nom}`;
  let page: Page;
  const objets = {
    note: `Note e2e ${s}`,
    appel: `Appel e2e ${s}`,
    courriel: `Courriel e2e ${s}`,
    reponse: `Réponse e2e ${s}`,
    visite: `Visite e2e ${s}`,
    reunion: `Réunion e2e ${s}`,
    relance: `Relance e2e ${s}`,
  };
  const ids: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
    await compteDeTest(page, { identifiant: salariee.compte, personne: nomSalariee, profil: 'SAISIE' });
  });

  test.afterAll(async () => { await page.close(); });

  /** Session de la salariée dans un contexte de navigateur à part. */
  async function sessionSalariee(browser: Browser) {
    const contexte = await browser.newContext({ serviceWorkers: 'block' });
    const p = await contexte.newPage();
    await patienterSurLimiteDebit(p);
    await connecterCompte(p, salariee.compte);
    return p;
  }

  test('📝 Note : action pour mémo rattachée au tiers, dans le fil', async () => {
    await nouvelleNote(page, 'ACTION');
    await saisirNote(page, { type: 'Note', etat: 'Pour mémo', objet: objets.note, message: `Point de situation ${s}`, tiers: CRM.TIERS, fil: true });
    ids.note = await enregistrerNote(page);
    await expect(etatNote(page)).toHaveText('Pour mémo');
    await expect(pageNote(page).locator('.crm-historique')).toContainText('Pour mémo');

    await ouvrirNotes(page, 'creees', objets.note);
    const ligne = ligneNote(page, objets.note);
    await expect(ligne).toHaveClass(/discret/);
    await expect(ligne).toContainText(CRM.TIERS);
    await expect(ligne.locator('td').first()).toHaveText('📝');
  });

  test('📞 Appel téléphonique : action à faire, rappel à date, traité depuis « Mes rappels »', async () => {
    await nouvelleNote(page, 'ACTION');
    await saisirNote(page, { type: 'Appel téléphonique', objet: objets.appel, echeance: echeanceDans(5), tiers: CRM.TIERS });
    ids.appel = await enregistrerNote(page);
    await expect(etatNote(page)).toHaveText('À faire');
    await ajouterRappel(page, { quand: echeanceDans(3, '09:00') });

    // Rappel à venir : listé avec « À venir aussi », traité (« Fait ») il disparaît.
    await page.goto('/crm/rappels?tous=1');
    const ligne = page.locator('.page-crm-rappels tbody tr').filter({ hasText: objets.appel });
    await expect(ligne).toHaveCount(1, { timeout: 15000 });
    await expect(ligne.locator('.crm-pastille')).toHaveClass(/crm-pastille-vert/);
    await ligne.locator('[data-traiter]').click();
    await expect(ligne).toHaveCount(0);
  });

  test('✉ Courriel : message à la salariée, lu, réponse', async ({ browser }) => {
    await nouvelleNote(page, 'MESSAGE');
    await saisirNote(page, { type: 'Courriel', objet: objets.courriel, message: `Merci de rappeler le client ${s}`, tiers: CRM.TIERS, destinataire: optionSalarie(salariee) });
    ids.courriel = await enregistrerNote(page);

    const p = await sessionSalariee(browser);
    try {
      await ouvrirNotes(p, 'recues', objets.courriel);
      await expect(ligneNote(p, objets.courriel)).toHaveClass(/crm-non-lue/);
      await ligneNote(p, objets.courriel).getByRole('link', { name: objets.courriel }).click();
      await expect(pageNote(p).locator('h1')).toContainText(objets.courriel);
      await pageNote(p).locator('[data-repondre]').click();
      await expect(pageNote(p).getByRole('heading', { level: 1 })).toContainText(/Nouvelle note/);
      await saisirNote(p, { objet: objets.reponse, message: `Client rappelé ${s}` });
      ids.reponse = await enregistrerNote(p);
    } finally {
      await p.context().close();
    }

    await ouvrirNote(page, ids.courriel);
    await expect(pageNote(page).locator('[data-destinataires]')).toContainText(nomSalariee);
    await expect(pageNote(page).locator('[data-destinataires]')).toContainText('lu');
    const reponses = pageNote(page).locator('.crm-reponses');
    await expect(reponses).toContainText(objets.reponse);
    await expect(reponses).toContainText(`Client rappelé ${s}`);
  });

  test('🚶 Visite : tâche confiée à la salariée, rappel avant l’échéance, terminée par elle', async ({ browser }) => {
    await nouvelleNote(page, 'TACHE');
    await saisirNote(page, { type: 'Visite', objet: objets.visite, responsable: optionSalarie(salariee), echeance: echeanceDans(6), tiers: CRM.TIERS });
    ids.visite = await enregistrerNote(page);
    await expect(etatNote(page)).toHaveText('À faire');
    await ajouterRappel(page, { delai: 2 });
    await expect(pageNote(page).locator('[data-rappels] .crm-liens')).toContainText('2');

    const p = await sessionSalariee(browser);
    try {
      await ouvrirNotes(p, 'mes', objets.visite);
      await ligneNote(p, objets.visite).getByRole('link', { name: objets.visite }).click();
      await expect(pageNote(p).locator('h1')).toContainText(objets.visite);
      await choisirDansCombo(p, comboNote(p, 'État'), 'Terminé');
      await enregistrerNote(p);
      await expect(etatNote(p)).toHaveText('Terminé');
    } finally {
      await p.context().close();
    }

    await ouvrirNote(page, ids.visite);
    await expect(etatNote(page)).toHaveText('Terminé');
    await expect(pageNote(page).locator('.crm-historique')).toContainText(salariee.compte);
  });

  test('👥 Réunion : note privée de la salariée, masquée, levée du masquage journalisée', async ({ browser }) => {
    const p = await sessionSalariee(browser);
    try {
      await nouvelleNote(p, 'ACTION');
      await saisirNote(p, { type: 'Réunion', etat: 'Pour mémo', objet: objets.reunion, message: `Compte rendu confidentiel ${s}`, privee: true });
      ids.reunion = await enregistrerNote(p);
    } finally {
      await p.context().close();
    }

    await ouvrirNote(page, ids.reunion);
    await expect(pageNote(page).locator('h1')).toContainText('Note privée');
    await expect(pageNote(page)).not.toContainText(`Compte rendu confidentiel ${s}`);
    await pageNote(page).locator('[data-reveler]').click();
    await expect(pageNote(page).locator('h1')).toContainText(objets.reunion);
    await expect(pageNote(page).locator('.crm-riche-texte')).toContainText(`Compte rendu confidentiel ${s}`);
    await expect(pageNote(page).locator('.crm-note-cote')).toContainText('masquage levé');
  });

  test('🔁 Relance : tâche à prendre par le service, prise par la salariée', async ({ browser }) => {
    await nouvelleNote(page, 'TACHE');
    await saisirNote(page, { type: 'Relance', objet: objets.relance, service: salariee.service, echeance: echeanceDans(1), tiers: CRM.TIERS });
    ids.relance = await enregistrerNote(page);
    await expect(etatNote(page)).toHaveText('À faire');

    const p = await sessionSalariee(browser);
    try {
      await ouvrirNotes(p, 'a_prendre', objets.relance);
      const ligne = ligneNote(p, objets.relance);
      await expect(ligne).toContainText(`${salariee.service} (à prendre)`);
      await ligne.locator('[data-prendre]').click();
      await attendreMessage(p, 'Note prise en charge');
      await expect(ligneNote(p, objets.relance)).toHaveCount(0);
    } finally {
      await p.context().close();
    }

    await ouvrirNote(page, ids.relance);
    await expect(etatNote(page)).toHaveText('En cours');
    await expect(comboNote(page, 'Responsable')).toHaveValue(nomSalariee);
  });
});
