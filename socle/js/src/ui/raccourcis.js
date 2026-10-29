import { lireStockage, ecrireStockage } from './preferences.js';
import config from './raccourcis.json';

// Raccourcis clavier personnalisables. Chaque fonction appartient à un groupe (grille des lignes, application,
// document…) déclaré par le module ou l'application qui la traite : declarerRaccourcis(groupe, { libelle, actions }).
// Les touches par défaut sont celles de la déclaration (pour la grille : raccourcis.json) ; l'utilisateur les remplace
// dans son navigateur (localStorage, jamais en base), page de paramétrage : catalogueRaccourcis / personnaliserRaccourci.
// Un raccourci n'est cherché que dans son groupe : actionDe(e, groupe).

const CLE = 'logibtp.raccourcis';
const enListe = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Représentation normalisée d'un événement clavier : « Ctrl+Shift+Enter », « Alt+ArrowUp », « Alt+1 », « + ». */
export function combinaison(e) {
  let touche = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  // Rangée des chiffres avec Ctrl ou Alt : le chiffre (en AZERTY la touche donne &, é, "…).
  if ((e.ctrlKey || e.metaKey || e.altKey) && /^Digit\d$/.test(e.code ?? '')) touche = e.code.slice(5);
  // Pour les symboles (+, -…), Maj dépend de la disposition du clavier : on l'ignore.
  const symbole = touche.length === 1 && !/[A-Z0-9]/i.test(touche);
  const parties = [];
  if (e.ctrlKey || e.metaKey) parties.push('Ctrl');
  if (e.altKey) parties.push('Alt');
  if (e.shiftKey && !symbole) parties.push('Shift');
  parties.push(touche === ' ' ? 'Space' : touche);
  return parties.join('+');
}

/** Touche seule de modification (Ctrl, Maj…) : pas un raccourci. */
export const estModificateur = (e) => ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key);

const LIBELLES_GRILLE = {
  insererApres: 'Insérer une ligne après', insererAvant: 'Insérer une ligne avant', insererEnfant: 'Insérer une ligne enfant',
  monter: 'Monter la ligne', descendre: 'Descendre la ligne', indenter: 'Augmenter le niveau', desindenter: 'Diminuer le niveau',
  etendreHaut: 'Étendre la sélection vers le haut', etendreBas: 'Étendre la sélection vers le bas',
  couper: 'Couper', copier: 'Copier', coller: 'Coller', dupliquer: 'Dupliquer', supprimer: 'Supprimer',
  annuler: 'Annuler', retablir: 'Rétablir', ouvrirMetre: 'Ouvrir le métré', rechercher: 'Rechercher dans la bibliothèque',
  replier: 'Replier la tranche', deplier: 'Déplier la tranche', menu: 'Menu contextuel (aide-mémoire ; touche Menu et Maj+F10 aussi)',
};

const groupes = new Map();
let personnalisation = lire();
const index = new Map();

function lire() {
  const o = lireStockage(CLE, {});
  return typeof o === 'object' ? o : {};
}

const ecrire = () => ecrireStockage(CLE, personnalisation);

/** Touches effectives d'une action : personnalisées, sinon par défaut. */
export function touchesDe(groupe, action) {
  const cle = `${groupe}.${action}`;
  if (cle in personnalisation) return enListe(personnalisation[cle]);
  return enListe(groupes.get(groupe)?.actions[action]?.defaut);
}

function indexer() {
  index.clear();
  for (const [groupe, g] of groupes) {
    const m = new Map();
    for (const action of Object.keys(g.actions)) for (const t of touchesDe(groupe, action)) m.set(t.toUpperCase(), action);
    index.set(groupe, m);
  }
}

/**
 * Déclare (ou complète) un groupe de raccourcis : actions = { code: { libelle, defaut: 'Ctrl+S' | [...] } }.
 * Les touches personnalisées par l'utilisateur s'appliquent aussitôt.
 */
export function declarerRaccourcis(groupe, { libelle, actions }) {
  const g = groupes.get(groupe) ?? { libelle: libelle ?? groupe, actions: {} };
  if (libelle) g.libelle = libelle;
  Object.assign(g.actions, actions);
  groupes.set(groupe, g);
  indexer();
}

/** Grille : configuration par défaut (raccourcis.json), remplaçable par l'hôte (fusion). */
export function configurerRaccourcis(surcharge = {}) {
  const fusion = { ...config, ...surcharge };
  const actions = {};
  for (const [action, defaut] of Object.entries(fusion)) {
    if (!action.startsWith('_')) actions[action] = { libelle: LIBELLES_GRILLE[action] ?? action, defaut };
  }
  declarerRaccourcis('grille', { libelle: 'Lignes (document, métré)', actions });
}
configurerRaccourcis();

/** Action d'un groupe associée à un événement clavier, ou null. */
export function actionDe(e, groupe = 'grille') {
  return index.get(groupe)?.get(combinaison(e).toUpperCase()) ?? null;
}

/** Libellé lisible d'une combinaison : « Ctrl+Maj+Entrée ». */
export function libelleTouches(t) {
  return String(t ?? '').split('+').map((p) => ({
    Shift: 'Maj', Enter: 'Entrée', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Delete: 'Suppr', Escape: 'Échap',
    Space: 'Espace', Backspace: 'Retour arrière', ContextMenu: 'Menu', PageUp: 'Pg préc.', PageDown: 'Pg suiv.', Home: 'Début', End: 'Fin',
  }[p] ?? p)).join('+');
}

/** Premier raccourci d'une action, lisible (aide-mémoire, bulles, menus) ; '' si aucun. */
export function libelleRaccourci(action, groupe = 'grille') {
  return libelleTouches(touchesDe(groupe, action)[0]);
}

/** Catalogue pour la page de paramétrage : [{ groupe, libelle, actions: [{ action, libelle, defaut, touches, personnalise }] }]. */
export function catalogueRaccourcis() {
  return [...groupes].map(([groupe, g]) => ({
    groupe, libelle: g.libelle,
    actions: Object.entries(g.actions).map(([action, a]) => ({
      action, libelle: a.libelle, defaut: enListe(a.defaut), touches: touchesDe(groupe, action), personnalise: `${groupe}.${action}` in personnalisation,
    })),
  }));
}

/**
 * Actions qui utilisent déjà une combinaison : [{ groupe, action, libelle, bloquant }]. Bloquant : même groupe, ou
 * groupe application (toujours actif) ; ailleurs, la combinaison peut servir dans un autre écran (avertissement).
 */
export function conflitsRaccourci(groupe, touche, sauf = null) {
  const t = String(touche).toUpperCase();
  const res = [];
  for (const [g, def] of groupes) {
    for (const action of Object.keys(def.actions)) {
      if (g === groupe && action === sauf) continue;
      if (touchesDe(g, action).some((x) => x.toUpperCase() === t)) {
        res.push({ groupe: g, libelleGroupe: def.libelle, action, libelle: def.actions[action].libelle, bloquant: g === groupe || g === 'application' || groupe === 'application' });
      }
    }
  }
  return res;
}

/** Remplace les touches d'une action ([] : aucune ; null : retour aux touches par défaut). */
export function personnaliserRaccourci(groupe, action, touches) {
  const cle = `${groupe}.${action}`;
  if (touches === null) delete personnalisation[cle];
  else personnalisation[cle] = enListe(touches);
  ecrire();
  indexer();
}

/** Toutes les actions reviennent à leurs touches par défaut. */
export function reinitialiserRaccourcis() {
  personnalisation = {};
  ecrire();
  indexer();
}

// Personnalisation faite dans une autre fenêtre : appliquée ici aussi.
globalThis.addEventListener?.('storage', (e) => {
  if (e.key !== CLE) return;
  personnalisation = lire();
  indexer();
});

let aide = null;
/** Ouverture de la page de personnalisation (fournie par l'application) : proposée en bas des menus contextuels. */
export function definirAideRaccourcis(ouvrir) { aide = ouvrir; }
export function ouvrirAideRaccourcis() { aide?.(); }
export const aideRaccourcisDisponible = () => Boolean(aide);
