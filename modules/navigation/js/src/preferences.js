// Préférences de l'utilisateur gardées dans le navigateur (jamais en base) : raccourcis et widgets de l'accueil,
// ouverture des fiches et documents dans une nouvelle fenêtre. Le localStorage est propre à l'origine, donc à la
// société (un sous-domaine par base).

export class Preferences {
  constructor(cle, defauts, stockage = globalThis.localStorage) {
    this.cle = cle;
    this.defauts = defauts;
    this.stockage = stockage;
    this.valeurs = { ...structuredClone(defauts), ...this.#lire() };
  }

  #lire() {
    try { return JSON.parse(this.stockage?.getItem(this.cle)) ?? {}; } catch { return {}; }
  }

  get(nom) { return this.valeurs[nom]; }

  set(nom, valeur) {
    this.valeurs[nom] = valeur;
    try { this.stockage?.setItem(this.cle, JSON.stringify(this.valeurs)); } catch { /* préférence non conservée */ }
  }

  reinitialiser(nom) {
    this.set(nom, structuredClone(this.defauts[nom]));
  }
}

/** Déplace un élément d'une liste (réordonnancement des raccourcis et des widgets). */
export function deplacer(liste, depuis, vers) {
  const copie = [...liste];
  if (depuis < 0 || depuis >= copie.length) return copie;
  const [x] = copie.splice(depuis, 1);
  copie.splice(Math.max(0, Math.min(vers, copie.length)), 0, x);
  return copie;
}
