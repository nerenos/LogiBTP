// Champs supplémentaires en colonnes « x_ » (plan versionnement-schema, lots 7 et 8) : logique pure de l'administration
// et de l'affichage dans les fiches. Les contrôles faisant foi sont ceux du serveur (ChampsSupplementaires.cs, 422
// VALIDATION) ; ici : nom technique proposé, valeurs d'une liste saisies en lignes, champ d'écran d'une erreur, onglet
// des champs de la définition qu'aucune section ne place.
import { ERREUR_CHAMP_SUPPLEMENTAIRE, TYPE_CHAMP_SUPPLEMENTAIRE } from './codes.js';

export const PREFIXE_COLONNE = 'x_';
/** Longueur maximale d'un nom de colonne : « x_ » + une lettre + 40 caractères (`^x_[a-z][a-z0-9_]{0,40}$`). */
export const LONGUEUR_COLONNE = 43;
/** Code de l'onglet qui porte les champs supplémentaires en colonnes d'une fiche. */
export const ONGLET_COLONNES = '+champs-colonnes';

/** Nom technique proposé d'après le libellé : sans accent, minuscules, tirets bas, préfixe « x_ ». */
export function proposerColonne(libelle) {
  const base = String(libelle ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const sansChiffre = /^[0-9]/.test(base) ? `n_${base}` : base;
  const nom = (PREFIXE_COLONNE + sansChiffre).slice(0, LONGUEUR_COLONNE);
  return nom.length > PREFIXE_COLONNE.length ? nom.replace(/_+$/, '') : nom;
}

/** Valeurs d'une liste saisies une par ligne (« valeur » ou « valeur | libellé ») → `[{ valeur, libelle }]`. */
export function lireValeursListe(saisie) {
  return String(saisie ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf('|');
    const valeur = (i < 0 ? l : l.slice(0, i)).trim();
    const libelle = i < 0 ? '' : l.slice(i + 1).trim();
    return { valeur, libelle: libelle || valeur };
  });
}

/** Inverse de `lireValeursListe` : une ligne par valeur, « valeur | libellé » si le libellé diffère. */
export function ecrireValeursListe(valeurs) {
  return (valeurs ?? []).map((o) => (o.libelle && o.libelle !== o.valeur ? `${o.valeur} | ${o.libelle}` : o.valeur)).join('\n');
}

/** Contrôle de l'écran qui porte une erreur du serveur (`colonne`, `type`, `libelle`, `valeurs`) ; `colonne` par défaut. */
export function controleDeErreur(code) {
  switch (code) {
    case ERREUR_CHAMP_SUPPLEMENTAIRE.TYPE_INVALIDE: return 'type';
    case ERREUR_CHAMP_SUPPLEMENTAIRE.LIBELLE_OBLIGATOIRE: return 'libelle';
    case ERREUR_CHAMP_SUPPLEMENTAIRE.VALEURS: return 'valeurs';
    default: return 'colonne';
  }
}

/** Demande de création d'après la saisie de l'écran (ordre entier, valeurs seulement pour une liste). */
export function demandeCreation(table, { colonne, type, libelle, ordre, valeurs }) {
  return {
    table, colonne: String(colonne ?? '').trim(), type, libelle: String(libelle ?? '').trim(),
    ordre: Number.parseInt(ordre, 10) || 0,
    valeurs: type === TYPE_CHAMP_SUPPLEMENTAIRE.LISTE ? lireValeursListe(valeurs) : null,
  };
}

/** Champs de la définition qui sont des colonnes « x_ ». */
export function champsColonnes(definition) {
  return (definition?.champs ?? []).filter((c) => c.colonne_supplementaire);
}

/** Codes des champs que les sections de la définition placent déjà. */
function codesPlaces(definition) {
  return new Set((definition?.sections ?? []).flatMap((s) => (s.groupes ?? [{ champs: s.champs ?? [] }]).flatMap((g) => g.champs ?? [])));
}

/** Champs « x_ » qu'aucune section ne place (tous, en pratique : les sections sont celles du programme). */
export function champsColonnesLibres(definition) {
  const places = codesPlaces(definition);
  return champsColonnes(definition).filter((c) => !places.has(c.code));
}

/** Codes des champs de la section « Général » par défaut (définition sans sections) : hors colonnes « x_ ». */
export function codesSectionGenerale(definition) {
  return (definition?.champs ?? []).filter((c) => !c.colonne_supplementaire).map((c) => c.code);
}

/** Onglet « Champs supplémentaires » des colonnes « x_ » (ordre du registre), ou null s'il n'y en a pas. */
export function sectionChampsColonnes(definition, titre, largeurPleine) {
  const libres = champsColonnesLibres(definition).map((c) => c.code);
  if (!libres.length) return null;
  return { code: ONGLET_COLONNES, titre, groupes: [{ titre: null, champs: libres, largeur: largeurPleine }], champs: libres };
}
