import { echapper } from './format.js';
import { aideRaccourcisDisponible, ouvrirAideRaccourcis } from './raccourcis.js';
import { texte, icone } from '../dictionnaire/index.js';

// Menu contextuel (clic droit, touche Menu ou Maj+F10) : court, il rappelle surtout les raccourcis clavier des
// fonctions (aide-mémoire) ; tout ce qu'il propose reste accessible sans lui (clavier, boutons). En bas : lien vers la
// personnalisation des raccourcis, si l'application l'a fournie (definirAideRaccourcis).
//
// elements : [{ libelle, raccourci (texte affiché), action(), actif (défaut vrai), titre } | { separateur: true }].

let ouvert = null;

export function fermerMenuContextuel() {
  ouvert?.();
  ouvert = null;
}

/** Ouvre le menu à la position de l'événement (souris) ou sous l'élément cible (clavier). */
export function ouvrirMenuContextuel(e, elements, { aide = true } = {}) {
  fermerMenuContextuel();
  e?.preventDefault?.();
  const items = elements.filter((x, i, t) => !(x.separateur && (i === 0 || t[i - 1].separateur || i === t.length - 1)));
  if (aide && aideRaccourcisDisponible()) items.push({ separateur: true }, { libelle: `${icone('raccourcis')} ${texte('socle.aide_memoire.personnaliser')}`, action: ouvrirAideRaccourcis });
  const menu = document.createElement('div');
  menu.className = 'menu-contextuel';
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  menu.innerHTML = items.map((x, i) => (x.separateur ? '<hr>'
    : `<button type="button" role="menuitem" data-i="${i}" ${x.actif === false ? 'disabled' : ''} title="${echapper(x.titre ?? '')}">
        <span>${echapper(x.libelle)}</span><kbd>${echapper(x.raccourci ?? '')}</kbd></button>`)).join('');
  document.body.append(menu);
  // Position : au pointeur, sinon sous la cible ; gardé dans la fenêtre.
  const cible = e?.target?.getBoundingClientRect?.();
  let x = e?.clientX || cible?.left || 0;
  let y = e?.clientY || cible?.bottom || 0;
  const r = menu.getBoundingClientRect();
  x = Math.max(0, Math.min(x, innerWidth - r.width - 4));
  y = Math.max(0, Math.min(y, innerHeight - r.height - 4));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const boutons = [...menu.querySelectorAll('button:not(:disabled)')];
  const retour = document.activeElement;
  boutons[0]?.focus();

  const fermer = () => {
    menu.remove();
    document.removeEventListener('pointerdown', dehors, true);
    document.removeEventListener('keydown', clavier, true);
    removeEventListener('blur', fermerMenuContextuel);
    removeEventListener('resize', fermerMenuContextuel);
    document.removeEventListener('scroll', fermerMenuContextuel, true);
  };
  const choisir = (i) => {
    fermerMenuContextuel();
    if (retour?.isConnected) retour.focus();
    items[i]?.action?.();
  };
  const dehors = (ev) => { if (!menu.contains(ev.target)) fermerMenuContextuel(); };
  const clavier = (ev) => {
    const i = boutons.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fermerMenuContextuel(); retour?.focus?.(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      ev.stopPropagation();
      const n = boutons.length;
      boutons[(i + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
      return;
    }
    if (ev.key === 'Tab') { ev.preventDefault(); fermerMenuContextuel(); retour?.focus?.(); return; }
    // Les autres touches restent dans le menu (Entrée et Espace activent le bouton).
    if (ev.key !== 'Enter' && ev.key !== ' ') ev.stopPropagation();
  };
  menu.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-i]');
    if (b) choisir(Number(b.dataset.i));
  });
  menu.addEventListener('contextmenu', (ev) => ev.preventDefault());
  setTimeout(() => {
    document.addEventListener('pointerdown', dehors, true);
    addEventListener('blur', fermerMenuContextuel);
    addEventListener('resize', fermerMenuContextuel);
    document.addEventListener('scroll', fermerMenuContextuel, true);
  });
  document.addEventListener('keydown', clavier, true);
  ouvert = fermer;
  return menu;
}
