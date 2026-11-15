import { test, expect, type Page } from '@playwright/test';
import { seConnecter, connecterCompte, compteDeTest, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreMessage, confirmer } from './outils/documents';
import { choisirDansCombo, decaler, dateFr } from './outils/planning';
import {
  CRM, pageDemande, comboDemande, enregistrerDemande, choisirTiersDemande, ouvrirDemandes, ligneDemande, pageNote, saisirNote, enregistrerNote, ouvrirNote,
} from './outils/crm';

/**
 * CRM : demandes (`/crm/demandes`, pré-dossiers de veille commerciale avant le projet).
 * - Nouvelle demande d'un prospect de l'annuaire, à prendre par le service Administration (bureau) : numéro DEM-,
 *   état « Veille », listée « à prendre » ;
 * - prise en charge par la salariée du service (compte e2e_crm), passée « En cours » ;
 * - note de suivi rattachée à la demande, puis « Créer le projet » : demande « Transformée en projet », projet PRJ-
 *   lié, la note suit le projet ;
 * - seconde demande classée sans suite : motif exigé, puis « Perdue » (discrète dans la liste).
 * Objets uniques par passage ; demandes et projets jamais supprimés.
 */
test.describe.serial('CRM : demandes', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  const salariee = CRM.SALARIEE;
  const objet = `Extension entrepôt e2e ${s}`;
  const objetPerdue = `Réhabilitation e2e ${s}`;
  const note = `Visite du site e2e ${s}`;
  const reponse = decaler(new Date().toISOString().slice(0, 10), 14);
  let page: Page;
  let id: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
    await compteDeTest(page, { identifiant: salariee.compte, personne: `${salariee.prenom} ${salariee.nom}`, profil: 'SAISIE' });
  });

  test.afterAll(async () => { await page.close(); });

  test('Nouvelle demande d’un prospect, à prendre par le service', async () => {
    await ouvrirDemandes(page, 'toutes', objet);
    await page.locator('[data-nouvelle]').click();
    const d = pageDemande(page);
    await expect(d.getByRole('heading', { level: 1 })).toContainText('Nouvelle demande');
    await d.getByRole('textbox', { name: 'Objet', exact: true }).fill(objet);
    await choisirTiersDemande(page, CRM.PROSPECT);
    await d.getByRole('textbox', { name: 'Origine', exact: true }).fill('Appel d’offres privé');
    await choisirDansCombo(page, comboDemande(page, 'Service'), salariee.service);
    const date = d.getByRole('textbox', { name: 'Réponse attendue', exact: true });
    await date.fill(dateFr(reponse));
    await date.press('Tab');
    await d.getByRole('textbox', { name: 'Montant estimé (HT)', exact: true }).fill('85000');
    id = await enregistrerDemande(page);
    await expect(pageDemande(page).locator('h1')).toContainText(/DEM-\d{4}-\d{4}/);
    await expect(pageDemande(page).locator('h1 .crm-etat')).toHaveText('Veille');

    await ouvrirDemandes(page, 'toutes', objet);
    const ligne = ligneDemande(page, objet);
    await expect(ligne).toContainText(CRM.PROSPECT);
    await expect(ligne).toContainText(`${salariee.service} (à prendre)`);
    await expect(ligne).toContainText(dateFr(reponse));
  });

  test('Prise en charge par la salariée du service, passée « En cours »', async ({ browser }) => {
    const contexte = await browser.newContext({ serviceWorkers: 'block' });
    const p = await contexte.newPage();
    try {
      await patienterSurLimiteDebit(p);
      await connecterCompte(p, salariee.compte);
      await ouvrirDemandes(p, 'a_prendre', objet);
      await ligneDemande(p, objet).locator('[data-prendre]').click();
      await attendreMessage(p, 'Demande prise en charge');
      await p.goto(`/crm/demande/${id}`);
      await expect(pageDemande(p).locator('h1')).toContainText(objet, { timeout: 15000 });
      await expect(comboDemande(p, 'Responsable')).toHaveValue(new RegExp(`${salariee.prenom} ${salariee.nom}`));
      await choisirDansCombo(p, comboDemande(p, 'État'), 'En cours');
      await enregistrerDemande(p);
      await expect(pageDemande(p).locator('h1 .crm-etat')).toHaveText('En cours');
    } finally {
      await contexte.close();
    }
  });

  test('Note de suivi, puis « Créer le projet » : demande transformée, note rattachée au projet', async () => {
    await page.goto(`/crm/note/nouveau?type_element=crm_demande&id_element=${id}`);
    await expect(pageNote(page).locator('[data-liens] .crm-liens')).toContainText(/DEM-/, { timeout: 15000 });
    await saisirNote(page, { type: 'Visite', etat: 'Pour mémo', objet: note });
    const idNote = await enregistrerNote(page);

    await page.goto(`/crm/demande/${id}`);
    await expect(pageDemande(page).locator('h1')).toContainText(objet, { timeout: 15000 });
    await pageDemande(page).locator('[data-projet]').click();
    await confirmer(page);
    await attendreMessage(page, 'Projet créé');
    await expect(pageDemande(page).locator('h1 .crm-etat')).toHaveText('Transformée en projet');
    const projet = pageDemande(page).locator('.crm-actions').getByRole('link', { name: /PRJ-/ });
    await expect(projet).toBeVisible();
    await expect(pageDemande(page).locator('[data-projet]')).toHaveCount(0);
    const code = (await projet.innerText()).match(/PRJ-[\w-]+/)![0];

    await ouvrirNote(page, idNote);
    await expect(pageNote(page).locator('[data-liens]')).toContainText(code);

    await ouvrirDemandes(page, 'toutes', objet);
    await expect(ligneDemande(page, objet)).toContainText(code);
    await expect(ligneDemande(page, objet)).toHaveClass(/discret/);
  });

  test('Seconde demande classée sans suite : motif exigé, puis « Perdue »', async () => {
    await page.goto('/crm/demande/nouveau');
    const d = pageDemande(page);
    await expect(d.getByRole('heading', { level: 1 })).toContainText('Nouvelle demande', { timeout: 15000 });
    await d.getByRole('textbox', { name: 'Objet', exact: true }).fill(objetPerdue);
    await choisirTiersDemande(page, CRM.TIERS);
    await enregistrerDemande(page);

    await choisirDansCombo(page, comboDemande(page, 'État'), 'Sans suite');
    await pageDemande(page).locator('[data-enregistrer]').click();
    await expect(pageDemande(page).locator('.crm-erreurs')).toContainText('Une demande sans suite a un motif');
    await choisirDansCombo(page, comboDemande(page, 'Motif'), 'Perdue');
    await enregistrerDemande(page);
    await expect(pageDemande(page).locator('h1 .crm-etat')).toHaveText('Sans suite · Perdue');

    await ouvrirDemandes(page, 'toutes', objetPerdue);
    await expect(ligneDemande(page, objetPerdue)).toHaveClass(/discret/);
    await expect(ligneDemande(page, objetPerdue)).toContainText('Sans suite · Perdue');
  });
});
