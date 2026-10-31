// Format des modèles d'édition (JSON versionné, stocké en base : modele_edition.med_contenu).
//
// Rapport : { format_version, code, libelle, cible (DOCUMENT | FICHE | LISTE | VUE), source, types: [...],
//   mode: 'RAPPORT' | 'ETIQUETTES', page: { format, orientation, flexible: [...], marges, espace_entete, espace_pied },
//   planche (étiquettes) : { colonnes, rangees, largeur, hauteur, pas_x, pas_y, marge_gauche, marge_haut },
//   charte, niveau_acces, parametres: [{ nom, libelle, type, defaut, choix }], presentations: [{ code, libelle }],
//   presentation_defaut, bandes: [Bande] }
// Bande : { type: CORPS|TITRE|RESUME|ENTETE_PAGE|PIED_PAGE|FOND_PAGE, nom, condition, pages, mode: UNIQUE|REPETE|GROUPE,
//   collection, rupture, regrouper, entete, pied, options: { saut_avant, saut_apres, saut_par_groupe, garder_ensemble,
//   garder_avec_suivant, bas_de_page, chaque_page }, contenu: Composant }
// Composants : champ, pile, rangee, tableau, repete, image, trait, espace, code39, qr, absolu, saut_page,
//   bloc (bloc lié : { bloc, parametres }), sous_rapport ({ rapport, donnees, parametres }).
// Bloc : { format_version, code, libelle, genre: 'BLOC', parametres: [{ nom, defaut }], contenu: Composant }.
import { texte } from '@logibtp/socle/dictionnaire';
import { verifierFormule } from './formules.js';

export const FORMAT_VERSION = 1;

const TYPES_BANDE = new Set(['CORPS', 'TITRE', 'RESUME', 'ENTETE_PAGE', 'PIED_PAGE', 'FOND_PAGE']);
const TYPES_COMPOSANT = new Set(['champ', 'pile', 'rangee', 'tableau', 'repete', 'image', 'trait', 'espace', 'code39', 'qr',
  'absolu', 'saut_page', 'bloc', 'sous_rapport']);

/** Modèle prêt à éditer : valeurs par défaut, TITRE / RESUME ramenés à CORPS. */
export function normaliserModele(m) {
  const modele = typeof m === 'string' ? JSON.parse(m) : (m ?? {});
  return {
    format_version: FORMAT_VERSION, mode: 'RAPPORT', parametres: [], ...modele,
    page: { format: 'A4', orientation: 'portrait', ...(modele.page ?? {}) },
    bandes: (modele.bandes ?? []).map((b) => ({ mode: 'UNIQUE', ...b, type: b.type === 'TITRE' || b.type === 'RESUME' || !b.type ? 'CORPS' : b.type })),
  };
}

/** Parcours de tous les composants d'un modèle ou d'un bloc (rappel(composant, chemin)). */
export function parcourir(modele, rappel) {
  const visiter = (c, chemin) => {
    if (!c || typeof c !== 'object') return;
    rappel(c, chemin);
    for (const k of ['enfants', 'colonnes']) (c[k] ?? []).forEach((e, i) => visiter(e, `${chemin}.${k}[${i}]`));
    for (const k of ['contenu', 'entete', 'pied']) if (c[k] && typeof c[k] === 'object' && !Array.isArray(c[k])) visiter(c[k], `${chemin}.${k}`);
    (c.gabarits ?? []).forEach((g, i) => (g.cellules ?? []).forEach((x, j) => visiter({ type: 'cellule', ...x }, `${chemin}.gabarits[${i}].cellules[${j}]`)));
  };
  if (modele.contenu) visiter(modele.contenu, 'contenu');
  (modele.bandes ?? []).forEach((b, i) => {
    rappel({ ...b, type: 'bande', type_bande: b.type ?? 'CORPS' }, `bandes[${i}]`);
    for (const k of ['contenu', 'entete', 'pied']) if (b[k]) visiter(b[k], `bandes[${i}].${k}`);
  });
}

/** Blocs liés et sous-rapports utilisés (graphe des dépendances, cycles, impact). */
export function dependances(modele) {
  const blocs = new Set();
  const rapports = new Set();
  const ressources = new Set();
  parcourir(modele, (c) => {
    if (c.type === 'bloc' && c.bloc) blocs.add(c.bloc);
    if (c.type === 'sous_rapport' && c.rapport) rapports.add(c.rapport);
    if (c.type === 'image' && c.ressource && !String(c.ressource).includes('{{') && !String(c.ressource).startsWith('=')) ressources.add(c.ressource);
  });
  return { blocs: [...blocs], rapports: [...rapports], ressources: [...ressources] };
}

/** Cycle dans les inclusions (blocs, sous-rapports) : chemin du cycle ou null. `lire(code)` → modèle ou null. */
export function chercherCycle(code, lire) {
  const pile = [];
  const visite = (c) => {
    if (pile.includes(c)) return [...pile.slice(pile.indexOf(c)), c];
    const m = lire(c);
    if (!m) return null;
    pile.push(c);
    const d = dependances(m);
    for (const x of [...d.blocs, ...d.rapports]) { const r = visite(x); if (r) return r; }
    pile.pop();
    return null;
  };
  return visite(code);
}

/** Contrôle d'un modèle : [{ chemin, code, message }] (formules, types de bandes et de composants). */
export function verifierModele(modele) {
  const erreurs = [];
  const m = typeof modele === 'string' ? JSON.parse(modele) : modele;
  if (!m || typeof m !== 'object') return [{ chemin: '', code: 'MODELE', message: texte('edition.modele.illisible') }];
  if ((m.format_version ?? 1) > FORMAT_VERSION) erreurs.push({ chemin: 'format_version', code: 'VERSION', message: texte('edition.modele.version', { version: m.format_version, moteur: FORMAT_VERSION }) });
  const formule = (v, chemin) => {
    if (typeof v !== 'string' || !v) return;
    const e = verifierFormule(v);
    if (e) erreurs.push({ chemin, code: e.code, message: e.message });
  };
  parcourir(m, (c, chemin) => {
    if (c.type === 'bande') {
      if (!TYPES_BANDE.has(c.type_bande)) erreurs.push({ chemin, code: 'BANDE', message: texte('edition.modele.bande', { type: c.type_bande }) });
      formule(c.condition && (String(c.condition).startsWith('=') ? c.condition : '=' + c.condition), `${chemin}.condition`);
      formule(c.collection, `${chemin}.collection`);
      return;
    }
    if (c.type !== 'cellule' && !TYPES_COMPOSANT.has(c.type) && !c.cle) erreurs.push({ chemin, code: 'COMPOSANT', message: texte('edition.modele.composant', { type: c.type }) });
    for (const k of ['valeur', 'collection', 'cumul', 'donnees']) formule(c[k], `${chemin}.${k}`);
    if (c.condition) formule(String(c.condition).startsWith('=') ? c.condition : '=' + c.condition, `${chemin}.condition`);
  });
  return erreurs;
}
