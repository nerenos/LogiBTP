import { echapper } from './format.js';

// Infobulles du thème (ergonomie I8) : remplacent la bulle native des attributs `title` sans les réécrire. Délégation
// sur le document : au survol (300 ms, aussitôt d'une bulle à la voisine), au focus clavier et à l'appui long (toucher),
// le `title` est retiré le temps de l'affichage (pas de bulle native en double) puis remis ; `aria-describedby` pointe
// la bulle. Placement au-dessus, sinon au-dessous, toujours dans la fenêtre. Raccourcis clavier mis en <kbd>.

const DELAI = 300;
const ENCHAINEMENT = 600;
const APPUI_LONG = 550;
const MARGE = 6;

/** Touches d'un raccourci reconnues dans le texte d'une bulle (Ctrl+S, Alt+7, Maj+F8, F4, Échap…). */
const RACCOURCI = /\b(?:(?:Ctrl|Alt|Maj|Shift|Cmd)\s?\+\s?)+(?:F\d{1,2}|[A-Z0-9]|Entrée|Échap|Suppr|Tab|Espace|Origine|Fin|[↑↓←→]|PgUp|PgDn|PageUp|PageDown)(?![\p{L}\d])|(?<![\p{L}\d])(?:F\d{1,2}|Échap|Entrée)(?![\p{L}\d])/gu;

/** Texte d'une bulle prêt pour innerHTML : échappé, sauts de ligne conservés, raccourcis en <kbd>. */
export function bulleHtml(texte) {
  return echapper(String(texte ?? '')).replace(RACCOURCI, (t) => `<kbd>${t}</kbd>`).replace(/\n/g, '<br>');
}

/**
 * Position de la bulle (coordonnées de la fenêtre) : centrée sur la cible, au-dessus si la place le permet, sinon
 * au-dessous ; décalée pour rester dans la largeur de la fenêtre.
 */
export function positionBulle(cible, bulle, vue) {
  const largeur = Math.min(bulle.width, vue.width - 2 * MARGE);
  let left = cible.left + cible.width / 2 - largeur / 2;
  left = Math.max(MARGE, Math.min(left, vue.width - largeur - MARGE));
  const dessus = cible.top - bulle.height - MARGE;
  const dessous = cible.bottom + MARGE;
  const auDessus = dessus >= MARGE || dessous + bulle.height > vue.height - MARGE;
  return { left: Math.round(left), top: Math.round(auDessus ? Math.max(MARGE, dessus) : dessous), cote: auDessus ? 'dessus' : 'dessous' };
}

let actif = false;

/** Branche les infobulles sur tout le document (une seule fois). */
export function activerInfobulles(racine = globalThis.document) {
  if (actif || !racine?.body) return;
  actif = true;
  const bulle = racine.createElement('div');
  bulle.className = 'infobulle';
  bulle.id = 'infobulle';
  bulle.setAttribute('role', 'tooltip');
  bulle.hidden = true;
  racine.body.append(bulle);
  let cible = null;
  let attente = null;
  let derniere = 0;

  const restaurer = () => {
    if (!cible) return;
    if (cible.dataset.bulle !== undefined) {
      if (!cible.hasAttribute('title')) cible.setAttribute('title', cible.dataset.bulle);
      delete cible.dataset.bulle;
    }
    if (cible.getAttribute('aria-describedby') === bulle.id) cible.removeAttribute('aria-describedby');
    cible = null;
  };
  const masquer = () => {
    clearTimeout(attente);
    if (!bulle.hidden) derniere = Date.now();
    bulle.hidden = true;
    restaurer();
  };
  const afficher = (el) => {
    const t = el.dataset.bulle;
    if (!t || !el.isConnected) { masquer(); return; }
    bulle.innerHTML = bulleHtml(t);
    bulle.hidden = false;
    bulle.style.left = '0px';
    bulle.style.top = '0px';
    const r = el.getBoundingClientRect();
    const b = bulle.getBoundingClientRect();
    const p = positionBulle(r, b, { width: racine.documentElement.clientWidth, height: racine.documentElement.clientHeight });
    bulle.style.left = `${p.left}px`;
    bulle.style.top = `${p.top}px`;
    bulle.dataset.cote = p.cote;
    if (!el.hasAttribute('aria-describedby')) el.setAttribute('aria-describedby', bulle.id);
  };
  const preparer = (el, immediat) => {
    if (el === cible) return;
    masquer();
    const t = el.getAttribute('title');
    if (!t?.trim()) return;
    cible = el;
    el.dataset.bulle = t;
    el.removeAttribute('title');
    clearTimeout(attente);
    attente = setTimeout(() => afficher(el), immediat || Date.now() - derniere < ENCHAINEMENT ? 0 : DELAI);
  };
  const porteur = (e) => {
    const el = e.target?.closest?.('[title]');
    // Fenêtre modale ouverte : seules ses bulles (la page derrière est inerte).
    return el && !el.closest('option, select, iframe, .infobulle') ? el : null;
  };

  racine.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = porteur(e);
    if (el) preparer(el, false);
    else if (cible && !cible.contains(e.target)) masquer();
  }, true);
  racine.addEventListener('pointerout', (e) => {
    if (cible && (!e.relatedTarget || !cible.contains(e.relatedTarget))) masquer();
  }, true);
  racine.addEventListener('focusin', (e) => {
    if (!e.target?.matches?.(':focus-visible')) return;
    const el = e.target.closest?.('[title]');
    if (el && el === e.target) preparer(el, false);
  }, true);
  racine.addEventListener('focusout', (e) => { if (cible && e.target === cible) masquer(); }, true);
  racine.addEventListener('pointerdown', (e) => {
    masquer();
    if (e.pointerType !== 'touch') return;
    const el = porteur(e);
    if (!el) return;
    const appui = setTimeout(() => { preparer(el, true); setTimeout(masquer, 2500); }, APPUI_LONG);
    const annuler = () => { clearTimeout(appui); racine.removeEventListener('pointerup', annuler, true); racine.removeEventListener('pointercancel', annuler, true); };
    racine.addEventListener('pointerup', annuler, true);
    racine.addEventListener('pointercancel', annuler, true);
  }, true);
  racine.addEventListener('keydown', masquer, true);
  racine.addEventListener('scroll', masquer, true);
  globalThis.addEventListener?.('blur', masquer);
}
