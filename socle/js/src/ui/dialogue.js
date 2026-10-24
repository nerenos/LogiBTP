import { echapper } from './format.js';

// Fenêtres d'interaction communes, par l'élément HTML5 <dialog> (affichage homogène, au-dessus de tout, page inerte
// derrière) : remplacent confirm(), alert() et prompt() du navigateur, qui bloquent la page et ne suivent pas le thème.
// Chaque fonction rend une promesse : `if (!(await confirmer('Supprimer ?'))) return;`.
//
// Options communes : titre, classe (classe ajoutée au <dialog>), ok / annuler (libellés des boutons), danger (bouton
// OK en rouge : suppression…). Le message est du texte (sauts de ligne conservés) ; `html` : contenu HTML déjà échappé.

let compteur = 0;
/** Fenêtres ouvertes par ouvrirDialogue, la dernière au-dessus. */
const pile = [];

function corps(message, html) {
  return html ?? `<p class="dialogue-message">${echapper(message ?? '')}</p>`;
}

/**
 * Fenêtre modale générique : rend la valeur passée à `fermer(valeur)` ; Échap (ou ✕) rend `valeurAnnulation`.
 * `construire(dialog, fermer)` branche le contenu (champ, boutons supplémentaires).
 */
export function ouvrirDialogue({ titre = '', message = '', html, boutons = [], valeurAnnulation = null, classe = '', construire, focus } = {}) {
  return new Promise((resoudre) => {
    const d = document.createElement('dialog');
    const id = `dialogue-${++compteur}`;
    d.className = `dialogue${classe ? ` ${classe}` : ''}`;
    if (titre) d.setAttribute('aria-labelledby', `${id}-titre`);
    d.innerHTML = `
      ${titre ? `<h3 class="dialogue-titre" id="${id}-titre">${echapper(titre)}</h3>` : ''}
      <div class="dialogue-corps">${corps(message, html)}</div>
      <div class="dialogue-boutons">${boutons.map((b, i) => `<button type="button" data-bouton="${i}" class="${b.principal ? 'principal' : ''}${b.danger ? ' danger' : ''}">${echapper(b.libelle)}</button>`).join('')}</div>`;
    let fini = false;
    // Comme les fenêtres du navigateur, la question garde le clavier : Échap la ferme avant tout autre gestionnaire
    // (fenêtres ouvertes dessous, raccourcis de la page), les autres touches ne sortent pas de la fenêtre.
    const clavier = (e) => {
      if (pile.at(-1) !== d || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      fermer(valeurAnnulation);
    };
    const fermer = (valeur) => {
      if (fini) return;
      fini = true;
      window.removeEventListener('keydown', clavier, true);
      pile.splice(pile.indexOf(d), 1);
      d.close();
      d.remove();
      resoudre(valeur);
    };
    d.addEventListener('cancel', (e) => { e.preventDefault(); fermer(valeurAnnulation); });
    // Fermée par le navigateur malgré tout (Échap répété) : annulation.
    d.addEventListener('close', () => fermer(valeurAnnulation));
    d.querySelectorAll('[data-bouton]').forEach((el) => el.addEventListener('click', () => {
      const b = boutons[Number(el.dataset.bouton)];
      fermer(typeof b.valeur === 'function' ? b.valeur(d) : b.valeur);
    }));
    d.addEventListener('keydown', (e) => e.stopPropagation());
    window.addEventListener('keydown', clavier, true);
    pile.push(d);
    construire?.(d, fermer);
    // Modale : au-dessus de toute autre fenêtre <dialog> déjà ouverte (couche supérieure du navigateur).
    document.body.append(d);
    d.showModal();
    (focus ? d.querySelector(focus) : d.querySelector('.principal') ?? d.querySelector('button'))?.focus();
  });
}

/** Question oui / non (confirm) : true si l'utilisateur confirme. Une suppression (« Supprimer… ») a son bouton en rouge. */
export function confirmer(message, { titre = 'Confirmation', html, classe, ...options } = {}) {
  const suppression = /^Supprimer/.test(message ?? '');
  const { ok = suppression ? 'Supprimer' : 'OK', annuler = 'Annuler', danger = suppression } = options;
  return ouvrirDialogue({
    titre, message, html, classe, valeurAnnulation: false,
    boutons: [{ libelle: annuler, valeur: false }, { libelle: ok, valeur: true, principal: true, danger }],
  });
}

/** Information à lire (alert) : la promesse se résout à la fermeture. */
export function alerter(message, { titre = 'Information', ok = 'OK', html, classe } = {}) {
  return ouvrirDialogue({ titre, message, html, classe, valeurAnnulation: undefined, boutons: [{ libelle: ok, valeur: undefined, principal: true }] });
}

/**
 * Saisie d'un texte (prompt) : le texte saisi (éventuellement vide), ou null si l'utilisateur annule.
 * Options : multiligne (zone de texte, Ctrl+Entrée = OK), obligatoire (OK inactif tant que le texte est vide).
 */
export function saisir(message, defaut = '', { titre = 'Saisie', ok = 'OK', annuler = 'Annuler', multiligne = false, obligatoire = false, classe } = {}) {
  const champ = multiligne
    ? `<textarea class="dialogue-champ" rows="4">${echapper(defaut ?? '')}</textarea>`
    : `<input type="text" class="dialogue-champ" value="${echapper(defaut ?? '')}">`;
  return ouvrirDialogue({
    titre, classe, valeurAnnulation: null, focus: '.dialogue-champ',
    html: `${message ? `<p class="dialogue-message">${echapper(message)}</p>` : ''}<label class="dialogue-saisie">${champ}</label>`,
    boutons: [{ libelle: annuler, valeur: null }, { libelle: ok, valeur: (d) => d.querySelector('.dialogue-champ').value, principal: true }],
    construire: (d, fermer) => {
      const c = d.querySelector('.dialogue-champ');
      const bouton = d.querySelector('.principal');
      const maj = () => { if (obligatoire) bouton.disabled = !c.value.trim(); };
      c.addEventListener('input', maj);
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (!multiligne || e.ctrlKey) && !bouton.disabled) { e.preventDefault(); fermer(c.value); }
      });
      maj();
      queueMicrotask(() => c.select?.());
    },
  });
}

/**
 * Fenêtre existante (élément <dialog> déjà construit, ajouté au document) ouverte en modale : Échap appelle
 * `surEchap` au lieu de fermer le <dialog> (la fenêtre garde sa propre fermeture, qui retire l'élément).
 */
export function ouvrirModale(dialogue, surEchap) {
  dialogue.addEventListener('cancel', (e) => { e.preventDefault(); surEchap?.(); });
  // Fermée par le navigateur malgré tout (Échap répété) : rouverte tant que la fenêtre ne s'est pas retirée.
  dialogue.addEventListener('close', () => { if (dialogue.isConnected) queueMicrotask(() => { if (dialogue.isConnected && !dialogue.open) dialogue.showModal(); }); });
  if (!dialogue.isConnected) document.body.append(dialogue);
  if (!dialogue.open) dialogue.showModal();
  return dialogue;
}
