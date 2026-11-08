import { echapper } from './format.js';
import { texte, texteHtml, iconeHtml, pluriel } from '../dictionnaire/index.js';

// Fenêtre des messages (ergonomie I4, I5) : erreurs et avertissements dans une fenêtre <dialog> non modale, en bas à
// droite, qui se ferme seule après un décompte (8 s par défaut) ; le décompte s'arrête au survol et définitivement au
// premier clic ou à la première frappe dans la fenêtre (pas au focus donné à l'ouverture, qui est rendu à l'élément actif d'avant) ; ✕ ou Échap (fenêtre active) la ferment ; plusieurs messages s'empilent.
// `details` : un élément par champ ou ligne en cause ({ libelle, message, aller }) ; `aller()` mène au champ.
// Chaque message est annoncé par l'événement `logibtp:notification` de window (historique du bandeau).

export const EVENEMENT_NOTIFICATION = 'logibtp:notification';
export const DELAI_NOTIFICATION = 8000;
const NIVEAUX = ['erreur', 'avertissement', 'info', 'succes'];

let pile = null;

function conteneur() {
  if (pile?.isConnected) return pile;
  pile = document.createElement('div');
  pile.className = 'notifications-pile';
  pile.setAttribute('aria-live', 'assertive');
  document.body.append(pile);
  return pile;
}

/** Titre de la fenêtre : celui donné, sinon « n champs à corriger » / « n points à vérifier » selon les détails. */
export function titreNotification({ titre, details = [], niveau = 'erreur' } = {}) {
  if (titre) return titre;
  if (details.length) return pluriel(niveau === 'avertissement' ? 'socle.notification.points' : 'socle.notification.champs', details.length);
  return texte(`socle.notification.titres.${NIVEAUX.includes(niveau) ? niveau : 'erreur'}`);
}

/** Corps HTML : message, puis un élément par détail (libellé en gras, message ; lien « Aller » si `aller`). */
export function corpsNotificationHtml({ message = '', details = [] } = {}) {
  const lignes = details.map((d, i) => `<li>${d.libelle ? `<b>${echapper(d.libelle)}</b> : ` : ''}${echapper(d.message ?? '')}${typeof d.aller === 'function'
    ? ` <button type="button" class="lien notification-aller" data-aller="${i}">${texteHtml('socle.notification.aller')}</button>` : ''}</li>`).join('');
  return `${message ? `<p class="notification-message">${echapper(message)}</p>` : ''}${lignes ? `<ul class="notification-details">${lignes}</ul>` : ''}`;
}

/**
 * Ouvre une fenêtre de message. Options : titre, message, details, niveau (erreur | avertissement | info | succes),
 * delai (ms ; 0 = reste ouverte). Rend { fermer, element }.
 */
export function notifier({ titre, message = '', details = [], niveau = 'erreur', delai = DELAI_NOTIFICATION } = {}) {
  const lvl = NIVEAUX.includes(niveau) ? niveau : 'erreur';
  const t = titreNotification({ titre, details, niveau: lvl });
  globalThis.dispatchEvent?.(new CustomEvent(EVENEMENT_NOTIFICATION, { detail: { titre: t, message, details: details.map((d) => ({ libelle: d.libelle, message: d.message })), niveau: lvl } }));
  if (typeof document === 'undefined') return { fermer() {}, element: null };
  const d = document.createElement('dialog');
  d.className = `notification ${lvl}`;
  d.setAttribute('role', lvl === 'erreur' ? 'alertdialog' : 'dialog');
  d.innerHTML = `<header><strong>${echapper(t)}</strong>
      <button type="button" class="bouton-icone" data-fermer title="${texteHtml('socle.notification.fermer')}" aria-label="${texteHtml('socle.notification.fermer')}">${iconeHtml('retirer')}</button></header>
    <div class="notification-corps">${corpsNotificationHtml({ message, details })}</div>
    ${delai > 0 ? `<div class="notification-decompte" style="animation-duration: ${Number(delai)}ms"></div>` : ''}`;
  let minuterie = null;
  let restant = delai;
  let depart = 0;
  let fige = false;
  const fermer = () => {
    clearTimeout(minuterie);
    if (!d.isConnected) return;
    d.close?.();
    d.remove();
  };
  const lancer = () => {
    if (fige || restant <= 0) return;
    depart = Date.now();
    minuterie = setTimeout(fermer, restant);
    d.classList.remove('en-pause');
  };
  const suspendre = () => {
    if (fige || !minuterie) return;
    clearTimeout(minuterie);
    minuterie = null;
    restant = Math.max(0, restant - (Date.now() - depart));
    d.classList.add('en-pause');
  };
  const figer = () => {
    if (fige) return;
    suspendre();
    fige = true;
    d.classList.add('figee');
  };
  d.addEventListener('pointerenter', suspendre);
  d.addEventListener('pointerleave', lancer);
  d.addEventListener('pointerdown', figer);
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') { figer(); return; }
    e.preventDefault();
    e.stopPropagation();
    fermer();
  });
  d.addEventListener('cancel', (e) => { e.preventDefault(); fermer(); });
  d.querySelector('[data-fermer]').addEventListener('click', fermer);
  d.querySelectorAll('[data-aller]').forEach((b) => b.addEventListener('click', () => {
    details[Number(b.dataset.aller)].aller();
  }));
  conteneur().prepend(d);
  const avant = document.activeElement;
  d.show?.();
  if (avant && avant !== document.body && avant !== document.activeElement) avant.focus?.({ preventScroll: true });
  if (delai > 0) lancer();
  return { fermer, element: d };
}
