// Module Facturation électronique, appels des routes /api/facture-electronique (MapModuleFactureElectronique) pour les
// écrans. L'application fournit son transport (session, société, erreurs) : json(methode, chemin, corps) → promesse du
// JSON, fichier(chemin) → promesse de { contenu (Blob), nom, type }. Chemins relatifs à la racine du module.
export const RACINE_API_FE = '/facture-electronique';

export function creerApiFe({ json, fichier }) {
  const r = (chemin) => `${RACINE_API_FE}${chemin}`;
  return {
    parametres: () => json('GET', r('/parametres')),
    enregistrer: (corps) => json('PUT', r('/parametres'), corps),
    sante: () => json('GET', r('/sante')),
    flux: (requete) => json('GET', r(`/flux${requete ? `?${requete}` : ''}`)),
    detail: (id) => json('GET', r(`/flux/${id}`)),
    fichier: (id, document) => fichier(r(`/flux/${id}/fichier${document ? `?document=${encodeURIComponent(document)}` : ''}`)),
    chronologie: (id) => json('GET', r(`/flux/${id}/chronologie`)),
    chronologieElement: (type, id) => json('GET', r(`/chronologie?type_element=${encodeURIComponent(type)}&id_element=${encodeURIComponent(id)}`)),
    tentative: (id) => json('POST', r(`/flux/${id}/tentative`)),
    confirmerDepot: (id, corps) => json('POST', r(`/flux/${id}/depot-manuel`), corps),
    importer: (corps) => json('POST', r('/import'), corps),
    poserStatut: (id, corps) => json('POST', r(`/flux/${id}/statut`), corps),
    relever: () => json('POST', r('/releve')),
    verifierJournal: () => json('GET', r('/journal/verification')),
  };
}
