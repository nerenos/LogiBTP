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

/**
 * Étiquette des scénarios qui ont besoin de l'API, d'une base et des comptes de `e2e/.env` : à poser sur le
 * `test.describe` de chacun (`{ tag: TAG_API }`). Ils sont exclus de la CI GitHub (`grepInvert` de
 * playwright.config.ts quand CI est posée) et ne se jouent que sur un poste de développement.
 */
export const TAG_API = '@api';

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
  await connecterCompte(page, identifiant, mdp, `Compte « ${role} »`, variableMdp);
}

/** Connexion de test (ComptesTest) proposée par le serveur. */
export async function connexionDeTest(page: Page) {
  return !!(await corps(await page.request.get('/api/auth/session'))).comptes_test;
}

/**
 * Ouvre une session pour un compte désigné par son identifiant (comptes créés par un scénario : voir `compteDeTest`).
 * Sans connexion de test, le mot de passe est requis. Un compte par contexte de navigateur : une requête d'une page
 * précédente rejouée après la limite de débit (`patienterSurLimiteDebit`) peut revenir après le changement de compte
 * et retirer les cookies partagés.
 */
export async function connecterCompte(page: Page, identifiant: string, mdp?: string, nom = identifiant, variableMdp = 'mot de passe') {
  const requete = page.request;
  await requete.post('/api/auth/deconnexion').catch(() => undefined);

  const r = await connexionDeTest(page)
    ? await requete.post('/api/auth/test/connexion', { data: { identifiant } })
    : await (async () => {
        if (!mdp) throw new Error(`${nom} : connexion de test indisponible et ${variableMdp} absent`);
        return requete.post('/api/auth/connexion', { data: { identifiant, mot_de_passe: mdp, rester_connecte: false } });
      })();

  const resultat = await corps(r);
  if (!r.ok()) throw new Error(`Connexion ${nom} (${identifiant}) refusée : ${r.status()} ${resultat.code ?? ''} ${resultat.title ?? ''}`);
  if (resultat.double_facteur) throw new Error(`Connexion ${nom} (${identifiant}) : double facteur demandé, à désactiver pour ce compte de test`);
  if (resultat.mdp_a_changer) throw new Error(`Connexion ${nom} (${identifiant}) : mot de passe provisoire à changer avant les tests`);
}

/**
 * Compte de connexion d'un salarié de la base de démonstration, créé par l'administrateur connecté s'il n'existe pas
 * (profil donné). Sans connexion de test, le mot de passe provisoire (création, sinon réinitialisation) est aussitôt
 * remplacé par un mot de passe aléatoire, rendu pour `connecterCompte` ; la session administrateur est ensuite rouverte.
 * Un salarié qui a déjà un compte d'un autre identifiant est refusé (le scénario ne touche pas aux comptes réels).
 */
export async function compteDeTest(page: Page, { identifiant, personne, profil }: { identifiant: string; personne: string; profil: string }) {
  const requete = page.request;
  const trouvees = await corps(await requete.get('/api/auth/personnes', { params: { recherche: personne } }));
  const p = (Array.isArray(trouvees) ? trouvees : []).find((x: { personne: { libelle: string } }) => x.personne.libelle === personne);
  if (!p) throw new Error(`Salarié « ${personne} » absent de la base (données de démonstration attendues)`);
  if (p.compte && p.compte.code !== identifiant) throw new Error(`Salarié « ${personne} » : compte « ${p.compte.code} » existant, autre que ${identifiant}`);
  const individu = Number(p.personne.id);
  if (await connexionDeTest(page) && p.compte) return { identifiant, individu, mdp: undefined };

  const r = p.compte
    ? await requete.post(`/api/auth/comptes/${p.compte.id}/reinitialiser`)
    : await requete.post('/api/auth/comptes', { data: { code: identifiant, type_element: p.personne.type, id_element: p.personne.id, profil } });
  const cree = await corps(r);
  if (!r.ok()) throw new Error(`Compte ${identifiant} : ${r.status()} ${cree.code ?? ''} ${cree.title ?? ''}`);
  if (await connexionDeTest(page)) return { identifiant, individu, mdp: undefined };

  // Mot de passe provisoire remplacé (sinon toute requête du compte est refusée) ; session administrateur rouverte après.
  const mdp = `E2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}!Aa9`;
  await requete.post('/api/auth/deconnexion').catch(() => undefined);
  const c = await requete.post('/api/auth/connexion', { data: { identifiant, mot_de_passe: cree.mot_de_passe, rester_connecte: false } });
  if (!c.ok()) throw new Error(`Compte ${identifiant} : connexion provisoire refusée (${c.status()})`);
  const m = await requete.post('/api/auth/mot-de-passe', { data: { actuel: cree.mot_de_passe, nouveau: mdp } });
  if (!m.ok()) throw new Error(`Compte ${identifiant} : mot de passe refusé (${m.status()} ${(await corps(m)).code ?? ''})`);
  await seConnecter(page, 'admin');
  return { identifiant, individu, mdp };
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
