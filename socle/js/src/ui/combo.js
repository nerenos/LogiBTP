import { ListeDeroulante } from './liste-deroulante.js';

/**
 * Liste de choix saisissable (combo) à la place d'un <select> : champ texte qui montre le libellé de l'option ;
 * la saisie filtre la liste (↑↓, Entrée ou Tab pour retenir, clic) ou désigne directement l'option par son libellé
 * ou son code. La valeur retenue est celle de l'option (`champ.valeurCombo`) ; un texte qui ne désigne aucune
 * option est refusé et le libellé de la valeur précédente revient.
 *
 * options : [{ valeur, libelle, detail? }] ; valeur : valeur initiale ; vide : option vide (« — ») proposée.
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
  const libelle = (v) => (v === '' || v === null || v === undefined ? '' : liste.find((o) => egal(o.valeur, v))?.libelle ?? String(v));
  let courante = valeur ?? '';
  let deroulante = null;
  champ.value = libelle(courante);
  Object.defineProperty(champ, 'valeurCombo', { get: () => courante });
  champ.definirValeur = (v) => { courante = v ?? ''; champ.value = libelle(courante); };
  champ.resoudre = () => (deroulante ? deroulante.resoudre() : courante);

  /** Retient la valeur désignée par le texte ; texte non reconnu : libellé de la valeur précédente. */
  const retenir = () => {
    const v = champ.resoudre();
    if (v === undefined) { champ.value = libelle(courante); return; }
    champ.value = libelle(v);
    if (!egal(v, courante)) {
      courante = v;
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
    if (deroulante?.clavier(e)) { e.preventDefault(); return; }
    // Entrée ou Tab : la valeur est retenue avant que l'hôte ne traite la touche (passage à la cellule suivante…).
    if (e.key === 'Enter' || e.key === 'Tab') retenir();
  });
  champ.addEventListener('blur', () => { retenir(); fermer(); });
  return champ;
}
