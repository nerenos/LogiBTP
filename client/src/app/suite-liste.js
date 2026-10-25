// Précédent / suivant d'une fiche ouverte depuis une liste (lot 3 des demandes du 25/10/2026, A19a) : à l'ouverture,
// la liste confie à la fenêtre (sessionStorage, recopié dans une fenêtre ouverte depuis elle) la suite ordonnée des
// adresses de ses lignes affichées ; la fiche y retrouve la sienne et propose ses voisines.

const CLE = 'logibtp.suiteListe';
const MAX = 2000;

/** Suite des adresses des lignes affichées (dans l'ordre), ouverte depuis la liste `origine`. */
export function memoriserSuite(urls, origine) {
  try {
    sessionStorage.setItem(CLE, JSON.stringify({ origine, urls: urls.filter(Boolean).slice(0, MAX) }));
  } catch { /* stockage indisponible : pas de navigation */ }
}

/** Voisines de l'adresse dans la suite mémorisée : { precedent, suivant, rang (1…), total, origine } ou null. */
export function voisins(url) {
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem(CLE) ?? 'null'); } catch { s = null; }
  const i = s?.urls?.indexOf(url) ?? -1;
  if (i < 0) return null;
  return { precedent: s.urls[i - 1] ?? null, suivant: s.urls[i + 1] ?? null, rang: i + 1, total: s.urls.length, origine: s.origine };
}
