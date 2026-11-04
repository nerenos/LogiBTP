// Préférences du compte connecté gardées en base (db/264, routes /api/preferences) : elles suivent l'utilisateur d'un
// poste à l'autre, à la différence des préférences d'affichage du navigateur. Même interface que `Preferences` du
// module Navigation (get / set / reinitialiser) : la valeur est lue une fois à l'ouverture, chaque changement est envoyé
// au serveur (changements rapprochés regroupés, envoi immédiat si la page est quittée).
import { Preferences } from '@logibtp/navigation';
import { api } from './api.js';

/** Délai de regroupement des changements avant l'envoi (ms). */
export const DELAI_ENVOI = 400;

/**
 * Préférences `cle` du compte connecté.
 * - `ancienneCle` : clé du `localStorage` où la valeur était gardée avant la mise en base : reprise une seule fois si le
 *   compte n'a encore rien en base, puis retirée du navigateur.
 * - `surErreur(e)` : lecture ou enregistrement refusé (hors ligne…). Si la lecture échoue, les changements restent en
 *   mémoire pour la page et ne sont pas envoyés (ils écraseraient la valeur du serveur, inconnue).
 * - `service` : { lire(cle), enregistrer(cle, valeur, { keepalive }) } (tests ; défaut : l'API).
 */
export async function preferencesCompte(cle, defauts, { ancienneCle = null, surErreur = () => {}, service = api.preferences, stockageLocal = globalThis.localStorage } = {}) {
  let valeur = null;
  let lue = true;
  try { valeur = await service.lire(cle); } catch (e) { lue = false; surErreur(e); }
  let reprise = false;
  if (lue && valeur == null && ancienneCle) {
    try { valeur = JSON.parse(stockageLocal?.getItem(ancienneCle) ?? 'null'); } catch { valeur = null; }
    reprise = valeur != null;
  }

  let minuterie = null;
  let aEnvoyer = null;
  const envoyer = (keepalive = false) => {
    clearTimeout(minuterie);
    minuterie = null;
    globalThis.removeEventListener?.('pagehide', quitter);
    if (!aEnvoyer) return Promise.resolve();
    const v = aEnvoyer;
    aEnvoyer = null;
    return service.enregistrer(cle, v, { keepalive }).then(() => {
      if (ancienneCle) try { stockageLocal?.removeItem(ancienneCle); } catch { /* navigateur sans stockage */ }
    }, surErreur);
  };
  const quitter = () => envoyer(true);
  const stockage = {
    getItem: () => (valeur == null ? null : JSON.stringify(valeur)),
    setItem: (_, json) => {
      valeur = JSON.parse(json);
      if (!lue) return;
      aEnvoyer = valeur;
      clearTimeout(minuterie);
      if (!minuterie) globalThis.addEventListener?.('pagehide', quitter);
      minuterie = setTimeout(() => envoyer(), DELAI_ENVOI);
    },
  };
  const preferences = new Preferences(cle, defauts, stockage);
  /** Envoie tout de suite les changements en attente (promesse). */
  preferences.envoyer = () => envoyer();
  if (reprise) {
    stockage.setItem(cle, JSON.stringify(preferences.valeurs));
    await preferences.envoyer();
  }
  return preferences;
}
