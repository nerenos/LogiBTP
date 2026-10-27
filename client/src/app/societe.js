// Société courante. Une base par société, désignée par le sous-domaine (acme.logibtp.fr, acme.localhost en
// développement) ; sans sous-domaine, la base principale. L'API la résout depuis l'en-tête Host ; le localStorage,
// le sessionStorage et le BroadcastChannel étant propres à l'origine, deux sociétés ouvertes en même temps ne
// partagent ni préférences, ni session, ni liste de fenêtres.

/** Sous-domaine d'un nom d'hôte (null : base principale). */
export function sousDomaine(hote) {
  const h = String(hote ?? '').toLowerCase();
  if (!h || /^\d+(\.\d+){3}$/.test(h) || h.startsWith('[')) return null;
  const parties = h.split('.');
  const base = parties.at(-1) === 'localhost' ? 1 : 2;
  if (parties.length <= base) return null;
  const sd = parties.slice(0, parties.length - base).join('.');
  return sd === 'www' ? null : sd;
}

export async function societeCourante() {
  try {
    const r = await fetch('/api/societe');
    if (r.ok) return await r.json();
  } catch { /* API injoignable : déduite de l'adresse */ }
  const code = sousDomaine(globalThis.location?.hostname);
  return { code, libelle: code ? code.toUpperCase() : 'Société principale', principale: !code };
}
