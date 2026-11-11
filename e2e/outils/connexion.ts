import { expect, type APIResponse, type Page } from '@playwright/test';

/**
 * Comptes employés par les tests de bout en bout, lus dans `e2e/.env` (hors dépôt, modèle `e2e/.env.exemple`) :
 * - `admin` : compte administrateur, tous les droits ;
 * - `restreint` : compte d'un profil sans droit sur les fiches salarié (tests de sécurité).
 * Le mot de passe n'est requis que si l'API n'offre pas la connexion de test (ComptesTest, développement seulement).
 */
export const COMPTES = {
  admin: { identifiant: 'E2E_ADMIN_ID', mdp: 'E2E_ADMIN_MDP' },
  restreint: { identifiant: 'E2E_RESTREINT_ID', mdp: 'E2E_RESTREINT_MDP' },
} as const;

export type Role = keyof typeof COMPTES;

function compte(role: Role) {
  const variables = COMPTES[role];
  const identifiant = process.env[variables.identifiant];
  if (!identifiant) throw new Error(`Compte « ${role} » : variable ${variables.identifiant} absente de e2e/.env`);
  return { identifiant, mdp: process.env[variables.mdp], variableMdp: variables.mdp };
}

async function corps(r: APIResponse) {
  return r.json().catch(() => ({}));
}

/**
 * Ouvre une session pour le compte du rôle, par l'API (cookie partagé avec la page) : connexion de test sans mot de
 * passe si le serveur la propose, sinon identifiant et mot de passe. Toute session précédente est fermée.
 */
export async function seConnecter(page: Page, role: Role) {
  const { identifiant, mdp, variableMdp } = compte(role);
  const requete = page.request;
  await requete.post('/api/auth/deconnexion').catch(() => undefined);

  const session = await corps(await requete.get('/api/auth/session'));
  const r = session.comptes_test
    ? await requete.post('/api/auth/test/connexion', { data: { identifiant } })
    : await (async () => {
        if (!mdp) throw new Error(`Compte « ${role} » : connexion de test indisponible et ${variableMdp} absente de e2e/.env`);
        return requete.post('/api/auth/connexion', { data: { identifiant, mot_de_passe: mdp, rester_connecte: false } });
      })();

  const resultat = await corps(r);
  if (!r.ok()) throw new Error(`Connexion « ${role} » (${identifiant}) refusée : ${r.status()} ${resultat.code ?? ''} ${resultat.title ?? ''}`);
  if (resultat.double_facteur) throw new Error(`Connexion « ${role} » (${identifiant}) : double facteur demandé, à désactiver pour ce compte de test`);
  if (resultat.mdp_a_changer) throw new Error(`Connexion « ${role} » (${identifiant}) : mot de passe provisoire à changer avant les tests`);
}

/** Connexion puis ouverture de la page ; échoue si l'application renvoie quand même vers la connexion. */
export async function ouvrirConnecte(page: Page, chemin: string, role: Role = 'admin') {
  await seConnecter(page, role);
  await page.goto(chemin);
  await expect(page.locator('form.connexion')).toHaveCount(0);
}

/** Ferme la session (tests des accès anonymes). */
export async function seDeconnecter(page: Page) {
  await page.request.post('/api/auth/deconnexion').catch(() => undefined);
}
