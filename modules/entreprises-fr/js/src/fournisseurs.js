import { ErreurApi, appelApi } from '@logibtp/socle';
import { versEntreprise } from './correspondance.js';

// Fournisseurs de la recherche d'entreprises. Même interface :
//   rechercher(recherche, { page }) → { resultats: [entreprise], total, page, pages }
// recherche : nom, SIREN ou SIRET (un SIRET retient l'établissement correspondant). L'API publique ne demande pas de
// clé ; FournisseurEntreprisesApi passe par le serveur (routes MapModuleEntreprisesFr), FournisseurEntreprisesDirect
// l'interroge depuis le navigateur (démo hors ligne).

export const URL_API = 'https://recherche-entreprises.api.gouv.fr/search';

export class ErreurEntreprises extends ErreurApi {}

/** SIRET cherché (14 chiffres, espaces acceptés), sinon null. */
export const siretCherche = (recherche) => {
  const c = String(recherche ?? '').replace(/\s/g, '');
  return /^[0-9]{14}$/.test(c) ? c : null;
};

/** Mise en forme d'une réponse de l'API (résultats convertis en entreprises). */
export function reponse(data, recherche) {
  const siret = siretCherche(recherche);
  return {
    resultats: (data?.results ?? []).map((r) => versEntreprise(r, siret)),
    total: data?.total_results ?? 0, page: data?.page ?? 1, pages: data?.total_pages ?? 0,
  };
}

export class FournisseurEntreprisesApi {
  constructor({ base = '/api/entreprises-fr', entetes = {} } = {}) {
    this.base = base;
    this.entetes = entetes;
  }

  rechercher(recherche, { page = 1 } = {}) {
    return appelApi(`${this.base}/recherche?${new URLSearchParams({ q: recherche, page: String(page) })}`, { entetes: this.entetes, Erreur: ErreurEntreprises });
  }
}

export class FournisseurEntreprisesDirect {
  constructor({ url = URL_API, parPage = 10 } = {}) {
    this.url = url;
    this.parPage = parPage;
  }

  async rechercher(recherche, { page = 1 } = {}) {
    const q = String(recherche ?? '').trim();
    if (q.length < 3) throw new ErreurEntreprises(422, 'RECHERCHE', 'Saisissez au moins 3 caractères (nom, SIREN ou SIRET)');
    let r;
    try {
      r = await fetch(`${this.url}?${new URLSearchParams({ q, page: String(page), per_page: String(this.parPage) })}`);
    } catch {
      throw new ErreurEntreprises(503, 'INDISPONIBLE', "Annuaire des entreprises injoignable (connexion Internet ?)");
    }
    if (r.status === 429) throw new ErreurEntreprises(429, 'LIMITE', 'Trop de recherches : réessayez dans quelques secondes');
    if (!r.ok) throw new ErreurEntreprises(r.status, 'HTTP', `Annuaire des entreprises : erreur ${r.status}`);
    return reponse(await r.json(), q);
  }
}
