import { completerDate, texteDate } from '../calcul/dates.js';

// Champs de date à saisie abrégée (décision du 31/10/2026, I3 de l'analyse d'ergonomie) : un `<input type="date">` du
// navigateur n'accepte pas une saisie partielle. activerDates() remplace d'office chaque champ de date de la page (même
// principe qu'activerCombos) par un champ texte « JJ/MM/AAAA » qui garde l'interface de l'input natif :
//   - `value` se lit et s'écrit en « AAAA-MM-JJ » (les pages ne changent pas) ; '' tant que la saisie n'est pas une date ;
//   - à la sortie du champ (et à Entrée), la saisie est complétée par completerDate (« 15 » → 15 du mois en cours…),
//     puis `input` est émis avant le `change` du navigateur (pas d'`input` pendant la frappe, comme le champ natif) ; une saisie impossible reste affichée, marquée invalide ;
//   - icône du calendrier dans le champ (clic, F4 ou Alt+↓) : calendrier du navigateur ; min / max repris.
// Un champ marqué `data-natif` reste un champ de date du navigateur.

// Accès à la valeur affichée (texte brut) sous la propriété `value` redéfinie ; lu à la demande (tests sans DOM).
let descripteur = null;
const natif = () => (descripteur ??= Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'));
const brut = {
  lire: (el) => natif().get.call(el),
  ecrire: (el, v) => natif().set.call(el, v),
};
const SELECTEUR = 'input[type="date"]:not([data-natif])';

/** Transforme un `<input type="date">` en champ de date à saisie abrégée (sans effet s'il l'est déjà). */
export function champDate(el) {
  if (el.dataset.champDate) return el;
  const initial = brut.lire(el);
  // Valeur annoncée aux pages : un `input` n'est émis que si elle a changé.
  let annoncee = '';
  el.dataset.champDate = '1';
  el.type = 'text';
  el.autocomplete = 'off';
  el.classList.add('champ-date');
  if (!el.placeholder) el.placeholder = 'jj/mm/aaaa';
  if (!el.title) el.title = 'Saisie abrégée : 15 → le 15 du mois, 16/05 → cette année, 15/05/23 → 2023, t → aujourd\'hui, +3 → dans 3 jours ; F4 : calendrier';

  Object.defineProperty(el, 'value', {
    configurable: true,
    get() {
      // Seule une date complète « JJ/MM/AAAA » (ou un champ vide) a une valeur : une saisie en cours n'en a pas.
      const t = brut.lire(el).trim();
      return t === '' || /^\d{2}\/\d{2}\/\d{4}$/.test(t) ? (lireTexte(t) ?? '') : '';
    },
    set(v) {
      brut.ecrire(el, texteDate(v));
      annoncee = texteDate(v) ? String(v).slice(0, 10) : '';
      el.classList.remove('invalide');
      el.removeAttribute('aria-invalid');
    },
  });
  Object.defineProperty(el, 'valueAsDate', {
    configurable: true,
    get() { return el.value ? new Date(`${el.value}T00:00:00`) : null; },
  });
  el.value = initial;

  const completer = () => {
    const saisie = brut.lire(el);
    const iso = completerDate(saisie);
    if (iso === null) {
      el.classList.add('invalide');
      el.setAttribute('aria-invalid', 'true');
      return false;
    }
    const texte = texteDate(iso);
    el.classList.remove('invalide');
    el.removeAttribute('aria-invalid');
    if (texte !== saisie) brut.ecrire(el, texte);
    return true;
  };
  const signaler = () => {
    if (el.value === annoncee) return false;
    annoncee = el.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  // Frappe en cours : pas d'`input` vers les pages (le champ natif n'en émet qu'une date complète) ; l'`input` est émis
  // une fois la saisie complétée (sortie du champ, Entrée, calendrier).
  el.addEventListener('input', (e) => { if (e.isTrusted) e.stopImmediatePropagation(); }, { capture: true });
  // Capture : la saisie est complétée avant les écouteurs `change` des pages.
  el.addEventListener('change', () => { completer(); signaler(); }, { capture: true });
  el.addEventListener('keydown', (e) => {
    // Entrée : le navigateur émet ensuite `change` (champ texte), la saisie est complétée avant.
    if (e.key === 'Enter') { completer(); signaler(); return; }
    if (e.key === 'F4' || (e.altKey && e.key === 'ArrowDown')) { e.preventDefault(); ouvrirCalendrier(el, signaler); }
  }, { capture: true });

  // Icône de calendrier dessinée dans le champ (comme la flèche des combos) : un clic sur elle ouvre le calendrier.
  el.addEventListener('click', (e) => {
    if (e.offsetX >= el.clientWidth - 22) ouvrirCalendrier(el, signaler);
  });
  return el;
}

/** Texte « JJ/MM/AAAA » d'un champ → « AAAA-MM-JJ », null s'il ne désigne aucune date. */
function lireTexte(texte) {
  const t = String(texte ?? '').trim();
  if (t === '') return '';
  return completerDate(t);
}

/** Calendrier du navigateur (champ de date caché, showPicker) ; le choix est écrit dans le champ. */
function ouvrirCalendrier(el, signaler) {
  if (el.readOnly || el.disabled) return;
  const cache = document.createElement('input');
  cache.type = 'date';
  cache.dataset.natif = '1';
  cache.className = 'champ-date-cache';
  cache.tabIndex = -1;
  if (el.min) cache.min = el.min;
  if (el.max) cache.max = el.max;
  brut.ecrire(cache, el.value || '');
  el.after(cache);
  const retirer = () => cache.remove();
  cache.addEventListener('change', () => {
    if (cache.value) {
      brut.ecrire(el, texteDate(cache.value));
      el.classList.remove('invalide');
      if (signaler()) el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    retirer();
    el.focus();
  });
  cache.addEventListener('blur', () => setTimeout(retirer, 0));
  try { cache.showPicker(); } catch { cache.focus(); cache.click(); }
}

/** Champs de date de la racine, présents et à venir, transformés en champs à saisie abrégée. */
export function activerDates(racine = document.body) {
  const ameliorer = (n) => {
    if (n.nodeType !== 1) return;
    if (n.matches(SELECTEUR)) champDate(n);
    n.querySelectorAll(SELECTEUR).forEach(champDate);
  };
  ameliorer(racine);
  new MutationObserver((mutations) => mutations.forEach((m) => {
    m.addedNodes.forEach(ameliorer);
    if (m.type === 'attributes' && m.target.matches?.(SELECTEUR)) champDate(m.target);
  })).observe(racine, { childList: true, subtree: true, attributes: true, attributeFilter: ['type'] });
}
