import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreMessage } from './outils/documents';
import { dateFr } from './outils/planning';
import {
  CRM, pagePlan, blocIndice, statutPlan, ajouterIndice, ajouterVisa, saisirVisa, ligneVisa, ajouterDestinataireBordereau,
} from './outils/crm';

/**
 * CRM : suivi des validations des plans (`/crm/plans`) et bordereaux de diffusion (`/crm/diffusions`), hors envoi par
 * courriel.
 * - Nouveau plan créé avec son fichier : repère, nom et indice A lus dans le nom du fichier (format par défaut
 *   « {repere}_{nom}_{indice} »), fichier rangé dans la GED du plan (répertoire de l'indice) ; « À diffuser » ;
 * - bordereau du dernier indice (« Diffuser… ») : architecte et bureau de contrôle visent, bureau d'études pour
 *   information ; numéro BD-, visas attendus sous 15 jours, indice daté du jour ; plan « Visas en attente » ;
 * - visas reçus : avec observations (architecte) puis refus (contrôleur) : plan « Refusé », aucun indice en vigueur ;
 * - indice B diffusé avec motif, visas attendus des deux tiers, reçus bons pour exécution : « Bon pour exécution »,
 *   B en vigueur ; listes des plans et des bordereaux (visas reçus 2 / 2).
 * Repère unique par passage ; plans et bordereaux jamais supprimés.
 */
test.describe.serial('CRM : plans, visas et bordereaux', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  const repere = `E2E${s}`;
  const nom = 'Plan de façade';
  const fichier = `${repere}_${nom}_A.pdf`;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const BET = 'BET Structure Confluence';
  let page: Page;
  let idPlan: string;
  let numero: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  async function ouvrirPlan() {
    await page.goto(`/crm/plan/${idPlan}`);
    await expect(statutPlan(page)).toBeVisible({ timeout: 15000 });
  }

  test('Nouveau plan avec son fichier : repère, nom et indice lus dans le nom', async () => {
    await page.goto('/crm/plans');
    await page.locator('.page-crm [data-nouveau]').click();
    const p = pagePlan(page);
    await expect(p.getByRole('heading', { level: 1 })).toContainText('Nouveau plan', { timeout: 15000 });
    await p.locator('[data-fichiers-plan]').setInputFiles({ name: fichier, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% plan e2e ${s}\n%%EOF\n`) });
    await expect(p.locator('[data-liste-fichiers]')).toContainText(fichier);
    await expect(p.locator('input[data-c="repere"]')).toHaveValue(repere);
    await expect(p.locator('input[data-c="nom"]')).toHaveValue(nom);
    await expect(p.locator('input[data-c="indice"]')).toHaveValue('A');
    await p.locator('input[data-c="lot"]').fill('Menuiseries extérieures');
    await p.locator('[data-enregistrer]').click();
    await attendreMessage(page, 'Plan enregistré');
    await expect(page).toHaveURL(/\/crm\/plan\/\d+/);
    idPlan = page.url().match(/\/crm\/plan\/(\d+)/)![1];

    await expect(pagePlan(page).locator('h1')).toContainText(`${repere} – ${nom}`);
    await expect(statutPlan(page)).toHaveText('À diffuser');
    const a = blocIndice(page, 'Indice A');
    await expect(a).toContainText('à diffuser');
    await expect(a.getByRole('link', { name: new RegExp(fichier) })).toBeVisible();
  });

  test('Bordereau du dernier indice : visas attendus, indice daté, plan en attente', async () => {
    await ouvrirPlan();
    await pagePlan(page).locator('[data-diffuser]').click();
    await expect(page.locator('.page-crm h1')).toContainText('Nouveau bordereau de diffusion', { timeout: 15000 });
    await expect(page.locator('[data-piece="0"]')).toBeChecked();
    await expect(page.locator('.page-crm .crm-liens')).toContainText(`${repere} – ${nom} – indice A`);
    await page.locator('[data-s="objet"]').fill(`Diffusion façade e2e ${s}`);
    await ajouterDestinataireBordereau(page, CRM.ARCHITECTE, true);
    await ajouterDestinataireBordereau(page, CRM.CONTROLEUR, true);
    await ajouterDestinataireBordereau(page, BET, false);
    await page.locator('[data-creer]').click();
    await attendreMessage(page, 'Bordereau créé');

    const b = page.locator('.crm-bordereau');
    await expect(b.locator('h1')).toContainText(/Bordereau de diffusion BD-\d{4}-\d{4}/);
    numero = (await b.locator('h1').innerText()).match(/BD-\d{4}-\d{4}/)![0];
    await expect(page).toHaveURL(/\/crm\/diffusion\/\d+/);
    await expect(b.locator('[data-imprimer]')).toBeVisible();
    const destinataires = b.locator('table').nth(1).locator('tbody tr');
    await expect(destinataires).toHaveCount(3);
    await expect(destinataires.filter({ hasText: CRM.ARCHITECTE })).toContainText('attendu sous 15 j');
    await expect(destinataires.filter({ hasText: CRM.CONTROLEUR })).toContainText('attendu sous 15 j');
    await expect(destinataires.filter({ hasText: BET })).toContainText('pour information');
    await expect(b.locator('table').first()).toContainText(`${repere} – ${nom} – indice A`);

    await ouvrirPlan();
    await expect(statutPlan(page)).toHaveText('Visas en attente');
    const a = blocIndice(page, 'Indice A');
    await expect(a).toContainText(`diffusé le ${dateFr(aujourdhui)}`);
    await expect(a.locator('tr[data-visa]')).toHaveCount(2);
    await expect(ligneVisa(page, 'Indice A', CRM.ARCHITECTE)).toContainText(numero);
    await expect(pagePlan(page)).toContainText('2 visas attendus');
  });

  test('Visas reçus : avec observations, puis refus : plan refusé', async () => {
    await ouvrirPlan();
    await saisirVisa(page, 'Indice A', CRM.ARCHITECTE, { statut: 'Visa avec observations', recu: dateFr(aujourdhui), observation: 'Teinte à confirmer' });
    await expect(statutPlan(page)).toHaveText('Visas en attente');
    await saisirVisa(page, 'Indice A', CRM.CONTROLEUR, { statut: 'Refusé', recu: dateFr(aujourdhui), observation: 'Garde-corps non conforme' });
    await expect(statutPlan(page)).toHaveText('Refusé');
    await expect(pagePlan(page)).toContainText('aucun indice bon pour exécution');
    await expect(ligneVisa(page, 'Indice A', CRM.ARCHITECTE).locator('[data-observation]')).toHaveValue('Teinte à confirmer');
  });

  test('Indice B diffusé, visas bons pour exécution : plan validé, B en vigueur', async () => {
    await ouvrirPlan();
    await ajouterIndice(page, { date: dateFr(aujourdhui), motif: `Garde-corps repris e2e ${s}` });
    const b = blocIndice(page, 'Indice B');
    await expect(b).toContainText(`Garde-corps repris e2e ${s}`);
    await expect(statutPlan(page)).toHaveText('Diffusé sans visa attendu');
    await ajouterVisa(page, 'Indice B', CRM.ARCHITECTE);
    await ajouterVisa(page, 'Indice B', CRM.CONTROLEUR);
    await expect(statutPlan(page)).toHaveText('Visas en attente');
    await saisirVisa(page, 'Indice B', CRM.ARCHITECTE, { statut: 'Bon pour exécution', recu: dateFr(aujourdhui) });
    await saisirVisa(page, 'Indice B', CRM.CONTROLEUR, { statut: 'Bon pour exécution', recu: dateFr(aujourdhui) });
    await expect(statutPlan(page)).toHaveText('Bon pour exécution');
    await expect(pagePlan(page).locator('p.aide b').first()).toHaveText('B');

    await page.goto(`/crm/plans?recherche=${repere}`);
    const ligne = page.locator('.page-crm tbody tr').filter({ hasText: repere });
    await expect(ligne).toHaveCount(1, { timeout: 15000 });
    await expect(ligne.locator('.crm-etat')).toHaveText('Bon pour exécution');
    await expect(ligne.locator('td').nth(6)).toHaveText('B');
    await expect(ligne.locator('td').nth(7)).toHaveText('B');

    await page.goto('/crm/diffusions');
    const bordereau = page.locator('.page-crm tbody tr').filter({ hasText: numero });
    await expect(bordereau).toContainText(`Diffusion façade e2e ${s}`, { timeout: 15000 });
    await expect(bordereau.locator('td').last()).toHaveText('2 / 2');
  });
});
