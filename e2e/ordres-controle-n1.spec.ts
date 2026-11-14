import { test, expect, type Browser, type Page } from '@playwright/test';
import { seConnecter, connecterCompte, compteDeTest, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreStatut, onglet, valider } from './outils/documents';
import {
  vendre, lancerOrdreExecution, ouvrir, validerEtape, controlerEtape, celluleEtape, choisirServiceOrdre, attendreEtatExecution,
  type Piece,
} from './outils/execution';

/**
 * Ordres, parcours 3 : contrôle du N+1. Un service de test (créé ou repris) a pour responsable un salarié (le N+1) et
 * pour membre un autre salarié (l'exécutant), tous deux avec un compte du profil Saisie (sans droit de contrôle) :
 * - l'administrateur lance un ordre d'exécution porté par ce service ;
 * - l'exécutant valide l'étape Lancement (contrôle du N+1 bloquant), ne peut pas la contrôler et se voit refuser
 *   l'étape suivante ;
 * - le N+1 trouve la tâche « contrôle à faire » du CRM dans le suivi de l'ordre et contrôle l'étape ;
 * - l'exécutant valide alors l'étape suivante : l'ordre est terminé.
 * Comptes : e2e_executant et e2e_n1 (ou E2E_EXECUTANT_ID / E2E_N1_ID de e2e/.env), créés au premier passage pour
 * « Noël Vincent » et « Jérôme Boyer » ; sans connexion de test, leur mot de passe est remplacé à chaque passage.
 */
test.describe.serial('Ordres : contrôle du N+1', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  const SERVICE = { code: 'E2E_N1', libelle: 'Service contrôle N+1 e2e' };
  const pose = { libelle: `Pose bardage e2e ${s}`, qte: '3', unite: 'j', pv: '650', nature: 'MO_POSE' };

  let page: Page;
  let pageExecutant: Page;
  let pageN1: Page;
  let executant: { identifiant: string; individu: number; mdp?: string };
  let n1: { identifiant: string; individu: number; mdp?: string };
  let oe: Piece;

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => {
    for (const p of [page, pageExecutant, pageN1]) await p?.context().close();
  });

  /** Page d'un compte de test dans son propre contexte (cookies de session propres au compte). */
  async function pageCompte(browser: Browser, c: { identifiant: string; mdp?: string }) {
    const p = await (await browser.newContext()).newPage();
    await patienterSurLimiteDebit(p);
    await connecterCompte(p, c.identifiant, c.mdp);
    return p;
  }

  test('Préparation : comptes de l’exécutant et du N+1, service dont le N+1 est responsable', async () => {
    executant = await compteDeTest(page, { identifiant: process.env.E2E_EXECUTANT_ID || 'e2e_executant', personne: 'Noël Vincent', profil: 'SAISIE' });
    n1 = await compteDeTest(page, { identifiant: process.env.E2E_N1_ID || 'e2e_n1', personne: 'Jérôme Boyer', profil: 'SAISIE' });

    // Service repris ou ajouté à la liste complète (un service absent de la liste enregistrée serait retiré)
    const services: Array<Record<string, unknown>> = await (await page.request.get('/api/services')).json();
    const saisis = services.map((x) => ({
      id: x.id, code: x.code, libelle: x.libelle, parent_code: x.parent_code, nature: x.nature, responsable_id: x.responsable_id, ordre: x.ordre, actif: x.actif,
    }));
    const existant = saisis.find((x) => x.code === SERVICE.code);
    if (existant) Object.assign(existant, { libelle: SERVICE.libelle, responsable_id: n1.individu, actif: true, parent_code: null });
    else saisis.push({ id: null, code: SERVICE.code, libelle: SERVICE.libelle, parent_code: null, nature: 'PRODUCTION', responsable_id: n1.individu, ordre: 990, actif: true });
    const r = await page.request.put('/api/services', { data: saisis });
    expect(r.ok(), await r.text()).toBe(true);
    const service = (await r.json()).find((x: { code: string }) => x.code === SERVICE.code);

    const membres: Array<{ ind_id: number; principal: boolean }> = await (await page.request.get(`/api/services/${service.id}/membres`)).json();
    if (!membres.some((m) => m.ind_id === executant.individu)) {
      const m = await page.request.put(`/api/services/${service.id}/membres`, {
        data: [...membres.map((x) => ({ ind_id: x.ind_id, principal: x.principal })), { ind_id: executant.individu, principal: false }],
      });
      expect(m.ok(), await m.text()).toBe(true);
    }
  });

  test('Administrateur : ordre d’exécution porté par le service, pris en charge', async () => {
    const vente = await vendre(page, { objet: `Bardage e2e ${s}`, chantier: `Chantier N+1 e2e ${s}`, lignes: [pose] });
    oe = await lancerOrdreExecution(page, vente.marche.id);
    await choisirServiceOrdre(page, SERVICE.libelle);
    await valider(page);
    await attendreStatut(page, 'Pris en charge');
  });

  test('Exécutant : Lancement validé, contrôle impossible, étape suivante refusée', async ({ browser }) => {
    pageExecutant = await pageCompte(browser, executant);
    const page = pageExecutant;
    await ouvrir(page, oe.id);
    await validerEtape(page, 'Lancement', { auteur: executant.identifiant });
    // Contrôle réservé au responsable du service (ou à son délégué) : case inactive pour l'exécutant
    await expect((await celluleEtape(page, 'Contrôle N+1', 'Lancement')).getByRole('checkbox')).toBeDisabled();
    // Préparation (étape masquée, affichée par « Toutes les étapes ») : bloquée tant que le N+1 n'a pas contrôlé le lancement
    await validerEtape(page, 'Préparation', { refus: /Contrôle du N\+1 attendu sur une étape précédente/ });
    await expect(await celluleEtape(page, 'Validation', 'Préparation')).not.toContainText(/\d{2}\/\d{2}\/\d{2}/);
  });

  test('N+1 : tâche « contrôle à faire » dans le suivi de l’ordre, Lancement contrôlé', async ({ browser }) => {
    pageN1 = await pageCompte(browser, n1);
    const page = pageN1;
    await ouvrir(page, oe.id);
    await onglet(page, 'Suivi');
    await expect(page.getByText(`Ordre ${oe.numero} : contrôle à faire (Lancement)`).first()).toBeVisible({ timeout: 15000 });
    await controlerEtape(page, 'Lancement', n1.identifiant);
  });

  test('Exécutant : étape suivante validée, ordre terminé', async () => {
    const page = pageExecutant;
    await ouvrir(page, oe.id);
    await validerEtape(page, 'Préparation', { auteur: executant.identifiant });
    await attendreEtatExecution(page, /Terminé/);
  });
});
