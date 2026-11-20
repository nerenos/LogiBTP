// Codes du module Bibliothèque, répliqués dans LogiBTP.Bibliotheque/Codes.cs (parité vérifiée par BibliothequeTests.cs).

/** Type de gestion d'un élément (ele_gestion). */
export const GESTION_ELEMENT = Object.freeze({
  STOCK: 'STOCK',
  ACHAT: 'ACHAT',
  SOUS_TRAITANCE: 'SOUS_TRAITANCE',
  NON_GERE: 'NON_GERE',
});

/** Scénario de prix d'achat d'un élément (ele_scenario_pa). */
export const SCENARIO_PA = Object.freeze({
  FIXE: 'FIXE',
  FOURNISSEUR_PRINCIPAL: 'FOURNISSEUR_PRINCIPAL',
  DERNIER_PA: 'DERNIER_PA',
  MEILLEUR_MIN: 'MEILLEUR_MIN',
  MEILLEUR_MAX: 'MEILLEUR_MAX',
  PMP: 'PMP',
});

/** Action d'une mise à jour de la bibliothèque depuis un nouveau PA (plan : planMiseAJourPa). */
export const ACTION_MAJ_PA = Object.freeze({
  PA_FIXE: 'PA_FIXE',
  TARIF: 'TARIF',
  NOUVEAU_TARIF: 'NOUVEAU_TARIF',
  AUCUNE: 'AUCUNE',
});

/** Motif d'une mise à jour impossible (action AUCUNE) ou refusée. */
export const MOTIF_MAJ_PA = Object.freeze({
  SCENARIO_CALCULE: 'SCENARIO_CALCULE',
  TARIF_PRINCIPAL_ABSENT: 'TARIF_PRINCIPAL_ABSENT',
  UNITE_TARIF: 'UNITE_TARIF',
  PA_INVALIDE: 'PA_INVALIDE',
  ELEMENT_COMPOSE: 'ELEMENT_COMPOSE',
  ELEMENT_INTROUVABLE: 'ELEMENT_INTROUVABLE',
  FICHE_EN_MODIFICATION: 'FICHE_EN_MODIFICATION',
  EMPREINTE_CHANGEE: 'EMPREINTE_CHANGEE',
  FOURNISSEUR_OBLIGATOIRE: 'FOURNISSEUR_OBLIGATOIRE',
});

/** Code d'une erreur du calcul d'un élément (ErreurCalcul.code) ; UNITE sert aussi de repli quand le code manque. */
export const ERREUR_CALCUL = Object.freeze({
  UNITE: 'UNITE',
  DONNEE: 'DONNEE',
  RATIO: 'RATIO',
  SCENARIO: 'SCENARIO',
});

/** Origine du PA de référence d'un élément (paReference). */
export const SOURCE_PA_REFERENCE = Object.freeze({
  TARIF_FOURNISSEUR: 'TARIF_FOURNISSEUR',
  PA_EFFECTIF: 'PA_EFFECTIF',
});

/** Genre d'un poste de pied (ele_pied_genre, recopié dans lig_proprietes.genre_poste). */
export const GENRE_POSTE = Object.freeze({
  REMISE: 'REMISE',
  PRORATA: 'PRORATA',
  ACOMPTE: 'ACOMPTE',
  PAIEMENT_DIRECT: 'PAIEMENT_DIRECT',
  RETENUE: 'RETENUE',
  AUTRE: 'AUTRE',
});

/** Type d'un élément (ele_type). */
export const TYPE_ELEMENT = Object.freeze({
  ARTICLE: 'ARTICLE',
  OUVRAGE: 'OUVRAGE',
  ENSEMBLE: 'ENSEMBLE',
  POSTE_PIED: 'POSTE_PIED',
  TEXTE: 'TEXTE',
});

/** Élément vendu (article, ouvrage) : sa nature est obligatoire (ventilation, analyses). Réplique de TypeElement.EstVendu. */
export const elementVendu = (type) => type === TYPE_ELEMENT.ARTICLE || type === TYPE_ELEMENT.OUVRAGE;
