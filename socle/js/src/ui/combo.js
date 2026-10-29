import { ListeDeroulante } from './liste-deroulante.js';

/**
 * Liste de choix saisissable (combo) à la place d'un <select> : champ texte qui montre le libellé de l'option ;
 * la saisie filtre la liste (↑↓, Entrée ou Tab pour retenir, clic) ou désigne directement l'option par son libellé
 * ou son code. La valeur retenue est celle de l'option (`champ.valeurCombo`) ; un texte qui ne désigne aucune
 * option est refusé et le libellé de la valeur précédente revient.
 *
 * options : [{ valeur, libelle, detail?, groupe?, couleur? }] (groupe : titre affiché avant ses options ; couleur : pastille
 * affichée devant le libellé, dans la liste et dans le champ) ; valeur : valeur initiale ;
 * vide : option vide (« — ») proposée.
 * Événement `change` sur le champ quand la valeur retenue change. `resoudre()` : valeur désignée par le texte saisi
 * (undefined si aucune), sans la retenir. `definirValeur(v)` : change la valeur sans événement.
 */
export function creerCombo({ options = [], valeur = '', vide = true, titre = '' } = {}) {
  const champ = document.createElement('input');
  champ.type = 'text';
  champ.autocomplete = 'off';
  champ.className = 'combo';
  champ.setAttribute('role', 'combobox');
  if (titre) champ.title = titre;
  const liste = [...(vide ? [{ valeur: '', libelle: '—' }] : []), ...options.map((o) => ({ ...o, valeur: o.valeur ?? '' }))];
  const egal = (a, b) => String(a ?? '') === String(b ?? '');
  // Valeur vide : libellé de son option s'il en a un vrai (« Par défaut », « Tous »…), sinon champ vide.
  const libelle = (v) => {
    const o = liste.find((x) => egal(x.valeur, v));
    if (v === '' || v === null || v === undefined) return o && o.libelle !== '—' ? o.libelle : '';
    return o?.libelle ?? String(v);
  };
  let courante = valeur ?? '';
  let deroulante = null;
  /** Pastille de l'option retenue (fond du champ). */
  const pastille = () => {
    const c = liste.find((o) => egal(o.valeur, courante))?.couleur;
    champ.classList.toggle('avec-pastille', Boolean(c));
    if (c) champ.style.setProperty('--combo-pastille', c); else champ.style.removeProperty('--combo-pastille');
  };
  champ.value = libelle(courante);
  pastille();
  Object.defineProperty(champ, 'valeurCombo', { get: () => courante });
  champ.definirValeur = (v) => { courante = v ?? ''; champ.value = libelle(courante); pastille(); };
  champ.resoudre = () => (deroulante ? deroulante.resoudre() : courante);

  /** Retient la valeur désignée par le texte ; texte non reconnu : libellé de la valeur précédente. */
  const retenir = () => {
    const v = champ.resoudre();
    if (v === undefined) { champ.value = libelle(courante); return; }
    champ.value = libelle(v);
    if (!egal(v, courante)) {
      courante = v;
      pastille();
      champ.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  const ouvrir = () => {
    if (deroulante || champ.readOnly || champ.disabled) return;
    deroulante = new ListeDeroulante(champ, liste, { strict: true, courante });
    // Choix à la souris : retenu tout de suite (le champ garde le focus).
    deroulante.surChoix = () => retenir();
  };
  const fermer = () => { deroulante?.detruire(); deroulante = null; };
  champ.addEventListener('focus', () => { ouvrir(); champ.select(); });
  champ.addEventListener('click', ouvrir);
  champ.addEventListener('keydown', (e) => {
    if (!deroulante && (e.key === 'ArrowDown' || e.key === 'F4')) { e.preventDefault(); ouvrir(); return; }
    if (deroulante && !deroulante.ouverte && e.key === 'ArrowDown') { e.preventDefault(); deroulante.filtrer('', { courante }); return; }
    if (deroulante?.clavier(e)) { e.preventDefault(); return; }
    // Entrée ou Tab : la valeur est retenue avant que l'hôte ne traite la touche (passage à la cellule suivante…).
    if (e.key === 'Enter' || e.key === 'Tab') retenir();
  });
  champ.addEventListener('blur', () => { retenir(); fermer(); });
  return champ;
}

const VALEUR_SELECT = typeof HTMLSelectElement === 'undefined' ? null : Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

/**
 * Affiche un <select> simple en combo : le <select>, masqué, reste la valeur de référence (`.value` lu ou écrit,
 * événements `change` et `input`, options et `disabled` modifiés après coup : combo reconstruit) ; le code qui le
 * manipule est inchangé. Options de groupe (`optgroup`) reprises en groupes. Renvoie le combo.
 */
export function comboDepuisSelect(select) {
  if (select.combo) return select.combo;
  const options = () => [...select.options].map((o) => ({
    valeur: o.value, libelle: o.textContent.trim() || '—', groupe: o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement.label : undefined,
  }));
  const construire = () => {
    const c = creerCombo({ options: options(), valeur: VALEUR_SELECT.get.call(select), vide: false, titre: select.title });
    c.disabled = select.disabled;
    if (select.getAttribute('aria-label')) c.setAttribute('aria-label', select.getAttribute('aria-label'));
    // La frappe dans le combo ne regarde que lui : les écouteurs de la page ne voient que le <select>.
    c.addEventListener('input', (e) => e.stopPropagation());
    c.addEventListener('change', (e) => {
      e.stopPropagation();
      VALEUR_SELECT.set.call(select, c.valeurCombo);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return c;
  };
  let combo = construire();
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return VALEUR_SELECT.get.call(this); },
    set(v) { VALEUR_SELECT.set.call(this, v); combo.definirValeur(VALEUR_SELECT.get.call(this)); },
  });
  new MutationObserver(() => {
    const n = construire();
    combo.replaceWith(n);
    combo = n;
    select.combo = n;
  }).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  select.hidden = true;
  select.after(combo);
  select.combo = combo;
  return combo;
}

/**
 * Combos à la place de tous les <select> simples (non `multiple`, sans `data-natif`) présents et à venir sous `racine` :
 * un seul appel par l'application ; les nouveaux écrans créent directement leurs combos par `creerCombo`.
 */
export function activerCombos(racine = document.body) {
  const SELECTEUR = 'select:not([multiple]):not([data-natif])';
  const ameliorer = (n) => {
    if (n.nodeType !== 1) return;
    if (n.matches(SELECTEUR)) comboDepuisSelect(n);
    n.querySelectorAll(SELECTEUR).forEach(comboDepuisSelect);
  };
  ameliorer(racine);
  new MutationObserver((mutations) => mutations.forEach((m) => m.addedNodes.forEach(ameliorer))).observe(racine, { childList: true, subtree: true });
}
