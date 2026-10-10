// Préférences d'affichage propres à l'utilisateur, conservées dans son navigateur (jamais en base).

const CLE = 'logibtp.affichage';

export function lirePreferences() {
  try {
    const o = JSON.parse(localStorage.getItem(CLE) ?? 'null');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

/** Fusionne des valeurs dans les préférences enregistrées. */
export function ecrirePreferences(valeurs) {
  try {
    localStorage.setItem(CLE, JSON.stringify({ ...lirePreferences(), ...valeurs }));
  } catch { /* stockage indisponible : préférences non conservées */ }
}
