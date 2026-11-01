import { echapper } from './format.js';
import { catalogueRaccourcis, libelleTouches, aideRaccourcisDisponible, ouvrirAideRaccourcis } from './raccourcis.js';
import { lirePreferences, ecrirePreferences } from './preferences.js';
import { texte, icone } from '../dictionnaire/index.js';

// Aide-mémoire des raccourcis : petite fenêtre flottante, déplaçable par sa barre de titre, fermable (×, Échap), qui
// laisse la page utilisable. Elle liste les touches effectives (personnalisées ou par défaut) des groupes demandés,
// puis des gestes sans raccourci personnalisable (notes). Une seule à la fois ; position gardée dans le navigateur.

let ouverte = null;

export function fermerAideMemoire() {
  ouverte?.();
  ouverte = null;
}

/**
 * Ouvre (ou ferme si elle est déjà ouverte) l'aide-mémoire.
 * options : { titre, groupes: ['grille', …] (ordre d'affichage), notes: [[touches, libellé]] (gestes fixes) }.
 */
export function basculerAideMemoire({ titre = texte('socle.aide_memoire.titre'), groupes = ['grille'], notes = [] } = {}) {
  if (ouverte) { fermerAideMemoire(); return; }
  const catalogue = catalogueRaccourcis();
  const blocs = groupes.map((g) => catalogue.find((x) => x.groupe === g)).filter(Boolean);
  const ligne = (touches, libelle) => `<tr><td>${touches.length ? touches.map((t) => `<kbd>${echapper(libelleTouches(t))}</kbd>`).join(' ') : '<span class="aucun">—</span>'}</td><td>${echapper(libelle)}</td></tr>`;
  const fen = document.createElement('div');
  fen.className = 'aide-memoire';
  fen.setAttribute('role', 'dialog');
  fen.setAttribute('aria-label', titre);
  fen.innerHTML = `
    <header><strong>${echapper(icone('raccourcis'))} ${echapper(titre)}</strong><button type="button" data-fermer title="${echapper(texte('commun.fermer_echap'))}">×</button></header>
    <div class="corps">
      ${notes.length ? `<table><tbody>${notes.map(([t, l]) => `<tr><td><kbd>${echapper(t)}</kbd></td><td>${echapper(l)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${blocs.map((b) => `<h4>${echapper(b.libelle)}</h4><table><tbody>${b.actions.filter((a) => a.touches.length).map((a) => ligne(a.touches, a.libelle)).join('')}</tbody></table>`).join('')}
    </div>
    ${aideRaccourcisDisponible() ? `<footer><button type="button" data-personnaliser>${echapper(texte('socle.aide_memoire.personnaliser'))}</button></footer>` : ''}`;
  document.body.append(fen);

  // Position mémorisée (gardée dans la fenêtre), sinon en bas à droite.
  const placer = (x, y) => {
    const r = fen.getBoundingClientRect();
    fen.style.left = `${Math.max(0, Math.min(x, innerWidth - r.width))}px`;
    fen.style.top = `${Math.max(0, Math.min(y, innerHeight - r.height))}px`;
  };
  const memo = lirePreferences().aideMemoire;
  const r0 = fen.getBoundingClientRect();
  placer(memo?.x ?? innerWidth - r0.width - 24, memo?.y ?? innerHeight - r0.height - 48);

  const entete = fen.querySelector('header');
  entete.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const r = fen.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    entete.setPointerCapture(e.pointerId);
    const bouger = (ev) => placer(ev.clientX - dx, ev.clientY - dy);
    const finir = () => {
      entete.removeEventListener('pointermove', bouger);
      entete.removeEventListener('pointerup', finir);
      entete.removeEventListener('pointercancel', finir);
      const p = fen.getBoundingClientRect();
      ecrirePreferences({ aideMemoire: { x: Math.round(p.left), y: Math.round(p.top) } });
    };
    entete.addEventListener('pointermove', bouger);
    entete.addEventListener('pointerup', finir);
    entete.addEventListener('pointercancel', finir);
  });
  const clavier = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fermerAideMemoire(); } };
  fen.addEventListener('keydown', clavier);
  fen.querySelector('[data-fermer]').addEventListener('click', fermerAideMemoire);
  fen.querySelector('[data-personnaliser]')?.addEventListener('click', () => { fermerAideMemoire(); ouvrirAideRaccourcis(); });
  const redimension = () => placer(fen.offsetLeft, fen.offsetTop);
  addEventListener('resize', redimension);
  ouverte = () => { fen.remove(); removeEventListener('resize', redimension); };
}
