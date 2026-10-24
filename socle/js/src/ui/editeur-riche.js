import { echapper, htmlSur } from './format.js';
import { ouvrirModale } from './dialogue.js';

// Éditeur de mise en forme d'un libellé (double-clic sur un libellé).
// Ctrl+B / Ctrl+I / Ctrl+U, barre d'outils, insertion de variables {{...}}.
// Ctrl+Entrée valide, Échap annule. Le HTML produit est nettoyé (liste blanche) ; le serveur le nettoie aussi.

const COULEURS = ['#1f2328', '#b42318', '#c4320a', '#067647', '#1d5fbf', '#6941c6', '#667085'];

const BOUTONS = [
  { cmd: 'bold', texte: '<b>G</b>', titre: 'Gras (Ctrl+B)' },
  { cmd: 'italic', texte: '<i>I</i>', titre: 'Italique (Ctrl+I)' },
  { cmd: 'underline', texte: '<u>S</u>', titre: 'Souligné (Ctrl+U)' },
  { cmd: 'strikeThrough', texte: '<s>B</s>', titre: 'Barré' },
  { sep: true },
  { cmd: 'superscript', texte: 'x²', titre: 'Exposant (m², m³)' },
  { cmd: 'subscript', texte: 'x₂', titre: 'Indice' },
  { sep: true },
  { cmd: 'insertUnorderedList', texte: '•≡', titre: 'Liste à puces' },
  { cmd: 'insertOrderedList', texte: '1≡', titre: 'Liste numérotée' },
  { sep: true },
  { couleurs: true },
  { sep: true },
  { cmd: 'removeFormat', texte: '⌫', titre: 'Effacer la mise en forme' },
];

/** Ouvre l'éditeur ; résout avec le HTML saisi (null si vidé), ou undefined si l'utilisateur annule. */
export function editerLibelle({ html, titre, variables = [], lecture = false }) {
  return new Promise((resoudre) => {
    const fond = document.createElement('dialog');
    fond.className = 'modale-fond dialogue-plein';
    fond.innerHTML = `
      <div class="modale editeur-riche" role="dialog" aria-modal="true" aria-label="Mise en forme du libellé">
        <header><h2>Libellé</h2><span class="aide">${echapper(titre ?? '')}</span></header>
        <div class="barre-outils" role="toolbar">
          ${BOUTONS.map((b) => {
            if (b.sep) return '<span class="sep"></span>';
            if (b.couleurs) return COULEURS.map((c) => `<button type="button" class="couleur" data-couleur="${c}" title="Couleur ${c}" style="--c:${c}"></button>`).join('');
            return `<button type="button" data-cmd="${b.cmd}" title="${echapper(b.titre)}">${b.texte}</button>`;
          }).join('')}
          <select data-variable title="Insérer une variable">
            <option value="">Variable…</option>
            ${variables.map((v) => `<option value="${echapper(v.valeur)}">${echapper(v.libelle)}</option>`).join('')}
          </select>
        </div>
        <div class="zone-saisie${lecture ? ' lecture' : ''}" contenteditable="${lecture ? 'false' : 'true'}" spellcheck="${lecture ? 'false' : 'true'}"></div>
        <footer>
          ${lecture ? '<span class="aide">Consultation seule : libellé non modifiable · Échap : fermer</span><button type="button" class="principal" data-action="annuler">Fermer</button>'
    : `<span class="aide">Entrée : paragraphe · Maj+Entrée : retour à la ligne · Ctrl+Entrée : valider · Échap : annuler</span>
          <button type="button" data-action="annuler">Annuler</button>
          <button type="button" class="principal" data-action="valider">Valider</button>`}
        </footer>
      </div>`;
    ouvrirModale(fond);
    // Consultation seule : sans barre d'outils, fermeture sans valeur (rien n'est modifié).
    if (lecture) fond.querySelector('.barre-outils').remove();
    const zone = fond.querySelector('.zone-saisie');
    zone.innerHTML = htmlSur(html ?? '');
    document.execCommand('styleWithCSS', false, true); // couleurs en <span style>, pas en <font>
    // Entrée crée un paragraphe <p> (et non un <div>, hors liste blanche) ; Maj+Entrée un simple <br>.
    document.execCommand('defaultParagraphSeparator', false, 'p');
    zone.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(zone);
    sel.collapseToEnd();

    let derniereSelection = null;
    const memoriser = () => {
      const s = window.getSelection();
      if (s.rangeCount && zone.contains(s.anchorNode)) derniereSelection = s.getRangeAt(0).cloneRange();
    };
    const restaurer = () => {
      zone.focus();
      if (derniereSelection) {
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(derniereSelection);
      }
    };
    document.addEventListener('selectionchange', memoriser);

    const fermer = (valeur) => {
      document.removeEventListener('selectionchange', memoriser);
      fond.remove();
      resoudre(valeur);
    };
    const valider = () => {
      let h = htmlSur(zone.innerHTML).replace(/(<br\s*\/?>|\s|&nbsp;)+$/i, '').trim();
      if (h === '' || h === '<br>') h = null;
      fermer(h);
    };

    // Les boutons ne prennent pas le focus : la sélection du texte est conservée.
    if (lecture) {
      for (const type of ['beforeinput', 'paste', 'drop', 'cut']) zone.addEventListener(type, (e) => e.preventDefault());
      zone.setAttribute('aria-readonly', 'true');
      fond.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); fermer(undefined); } });
      fond.querySelector('[data-action="annuler"]').addEventListener('click', () => fermer(undefined));
      fond.addEventListener('mousedown', (e) => { if (e.target === fond) fermer(undefined); });
      fond.querySelector('[data-action="annuler"]').focus();
      return;
    }
    fond.querySelectorAll('.barre-outils button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    fond.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => { document.execCommand(b.dataset.cmd); zone.focus(); }));
    fond.querySelectorAll('[data-couleur]').forEach((b) => b.addEventListener('click', () => { document.execCommand('foreColor', false, b.dataset.couleur); zone.focus(); }));
    fond.querySelector('[data-variable]').addEventListener('change', (e) => {
      if (!e.target.value) return;
      restaurer();
      document.execCommand('insertText', false, e.target.value);
      e.target.value = '';
    });
    // Collage : uniquement du HTML nettoyé.
    zone.addEventListener('paste', (e) => {
      e.preventDefault();
      const d = e.clipboardData;
      const contenu = d.getData('text/html');
      if (contenu) document.execCommand('insertHTML', false, htmlSur(contenu));
      else document.execCommand('insertText', false, d.getData('text/plain'));
    });
    fond.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); fermer(undefined); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); valider(); }
    });
    fond.querySelector('[data-action="annuler"]').addEventListener('click', () => fermer(undefined));
    fond.querySelector('[data-action="valider"]').addEventListener('click', valider);
    fond.addEventListener('mousedown', (e) => { if (e.target === fond) fermer(undefined); });
  });
}
