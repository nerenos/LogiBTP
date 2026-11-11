import { test, expect, type APIRequestContext } from '@playwright/test';
import { ouvrirConnecte, seConnecter, seDeconnecter } from './outils/connexion';

/**
 * Sécurité : les droits sont appliqués par le serveur, pas seulement masqués par l'interface.
 * Prérequis (e2e/.env) : `E2E_RESTREINT_ID` est un compte dont le profil n'a aucun droit sur « fiches/salarie »
 * ni sur le paramétrage ; `E2E_ADMIN_ID` a tous les droits (témoin : la route existe et répond).
 */

/** Codes d'erreur de l'API attendus (socle `Web.cs`, module Droits, module Authentification). */
const ERREUR = Object.freeze({
  ACCES_REFUSE: 'ACCES_REFUSE',
  SESSION_REQUISE: 'SESSION_REQUISE',
});

type Appel = { nom: string; methode: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; data?: unknown };

/** Routes protégées par le nœud « fiches/salarie » (mode Module) ou par le paramétrage (mode Parametrage). */
const ROUTES_SALARIE: Appel[] = [
  { nom: 'définition de la fiche', methode: 'GET', url: '/api/fiches/salarie/definition' },
  { nom: 'création', methode: 'POST', url: '/api/fiches/salarie', data: { valeurs: { nom: 'Intrus' } } },
  { nom: 'lecture d\'une fiche', methode: 'GET', url: '/api/fiches/salarie/1' },
  { nom: 'modification', methode: 'PUT', url: '/api/fiches/salarie/1', data: { valeurs: { nom: 'Intrus' } } },
  { nom: 'suppression', methode: 'DELETE', url: '/api/fiches/salarie/1' },
  { nom: 'paramétrage (lecture)', methode: 'GET', url: '/api/fiches/salarie/parametrage' },
  { nom: 'paramétrage (écriture)', methode: 'PUT', url: '/api/fiches/salarie/parametrage', data: {} },
];

function appeler(requete: APIRequestContext, a: Appel) {
  return requete.fetch(a.url, { method: a.methode, data: a.data, failOnStatusCode: false });
}

async function attendreRefus(requete: APIRequestContext, a: Appel, statut: number, code: string) {
  const r = await appeler(requete, a);
  expect(r.status(), `${a.methode} ${a.url} (${a.nom})`).toBe(statut);
  expect((await r.json().catch(() => ({}))).code, `${a.methode} ${a.url} (${a.nom})`).toBe(code);
}

test.describe('Droits : fiches salarié', () => {

  test('sans session : toute route refusée (401)', async ({ page }) => {
    await seDeconnecter(page);
    for (const a of ROUTES_SALARIE) await attendreRefus(page.request, a, 401, ERREUR.SESSION_REQUISE);
  });

  test('compte sans droit : toute route refusée (403)', async ({ page }) => {
    await seConnecter(page, 'restreint');
    for (const a of ROUTES_SALARIE) await attendreRefus(page.request, a, 403, ERREUR.ACCES_REFUSE);
  });

  test('témoin : l\'administrateur lit la définition', async ({ page }) => {
    await seConnecter(page, 'admin');
    const r = await appeler(page.request, ROUTES_SALARIE[0]);
    expect(r.status()).toBe(200);
  });

  test('compte sans droit : la fiche ne s\'ouvre pas en saisie', async ({ page }) => {
    await ouvrirConnecte(page, '/fiche/salarie/nouveau', 'restreint');
    // Laisse à la page le temps de charger (et d'essuyer le refus) avant de constater l'absence de saisie.
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.fiche-champ[data-champ="nom"] input')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeHidden();
  });

});
