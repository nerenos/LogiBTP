// Préférences d'affichage propres à l'utilisateur, conservées dans son navigateur (jamais en base).

const CLE = 'logibtp.affichage';

/** Valeur JSON conservée dans le navigateur sous cette clé ; absente, illisible ou stockage indisponible : `defaut`. */
export function lireStockage(cle, defaut = null) {
  try {
    const v = JSON.parse(localStorage.getItem(cle) ?? 'null');
    return v ?? defaut;
  } catch {
    return defaut;
  }
}

/** Conserve une valeur JSON dans le navigateur (stockage indisponible : non conservée, sans erreur). */
export function ecrireStockage(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage indisponible : non conservé */ }
}

export function lirePreferences() {
  const o = lireStockage(CLE, {});
  return typeof o === 'object' ? o : {};
}

/** Fusionne des valeurs dans les préférences enregistrées. */
export function ecrirePreferences(valeurs) {
  ecrireStockage(CLE, { ...lirePreferences(), ...valeurs });
}
