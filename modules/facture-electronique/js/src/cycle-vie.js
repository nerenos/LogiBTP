import {
  STATUT_CDV, STATUTS_TERMINAUX, STATUTS_MOTIF_OBLIGATOIRE, STATUTS_OBLIGATOIRES_PPF, EMETTEUR_STATUT, SENS_FACTURE,
  MOTIF_STATUT, ACTION_CDV, ERREUR_FE,
} from './codes.js';

// Règles du cycle de vie d'une facture (flux 6), répliquées dans ReglesCycleVie.cs (jeu tests/cas/01_cycle_vie.json).
// Sources : annexe A XP Z12-012 V1.4, onglets « Acteurs CDV » (émetteurs) et « Tableau des motifs de STATUTS » (motifs).

const S = STATUT_CDV;
const E = EMETTEUR_STATUT;
const M = MOTIF_STATUT;

/** Émetteurs admis de chaque statut. */
const EMETTEURS = Object.freeze({
  [S.DEPOSEE]: [E.PA_E],
  [S.EMISE]: [E.PA_E],
  [S.RECUE]: [E.PA_R],
  [S.MISE_A_DISPOSITION]: [E.PA_R],
  [S.PRISE_EN_CHARGE]: [E.ACHETEUR],
  [S.APPROUVEE]: [E.ACHETEUR],
  [S.APPROUVEE_PARTIELLEMENT]: [E.ACHETEUR],
  [S.EN_LITIGE]: [E.ACHETEUR],
  [S.SUSPENDUE]: [E.ACHETEUR],
  [S.COMPLETEE]: [E.VENDEUR],
  [S.REFUSEE]: [E.ACHETEUR],
  [S.PAIEMENT_TRANSMIS]: [E.ACHETEUR],
  [S.ENCAISSEE]: [E.VENDEUR],
  [S.REJETEE]: [E.PA_E, E.PA_R],
  [S.VISEE]: [E.AGENT],
  [S.ANNULEE]: [E.VENDEUR, E.ACHETEUR],
  [S.ERREUR_ROUTAGE]: [E.PA_R],
  [S.DEMANDE_PAIEMENT_DIRECT]: [E.VENDEUR],
  [S.AFFACTUREE]: [E.VENDEUR],
  [S.AFFACTUREE_CONFIDENTIEL]: [E.VENDEUR],
  [S.CHANGEMENT_COMPTE_A_PAYER]: [E.VENDEUR],
  [S.NON_AFFACTUREE]: [E.VENDEUR],
  [S.IRRECEVABLE]: [E.PA_R],
});

/** Motifs autorisés : colonnes du tableau des motifs (Rejetée à l'émission ou en réception, Refusée B2B ou B2G…). */
const MOTIFS_REJET_EMISSION = Object.freeze([
  M.MONTANTTOTAL_ERR, M.CALCUL_ERR, M.DOUBLON, M.DEST_INC, M.ADR_ERR, M.REJ_SEMAN, M.REJ_UNI, M.REJ_COH, M.REJ_ADR,
  M.REJ_CONT_B2G, M.REJ_REF_PJ, M.REJ_ASS_PJ,
]);
const MOTIFS_REJET_RECEPTION = Object.freeze(MOTIFS_REJET_EMISSION.filter((m) => m !== M.DEST_INC));
const MOTIFS_REFUS_B2B = Object.freeze([
  M.TX_TVA_ERR, M.MONTANTTOTAL_ERR, M.CALCUL_ERR, M.NON_CONFORME, M.DOUBLON, M.DEST_ERR, M.TRANSAC_INC, M.EMMET_INC,
  M.CONTRAT_TERM, M.DOUBLE_FACT, M.CMD_ERR, M.ADR_ERR, M.REF_CT_ABSENT,
]);
const MOTIFS_REFUS_B2G = Object.freeze([
  M.RETRAIT_MAN_SERV, M.ST_CT_NON_DECLAR, M.SUPPR_COMP_AVOIR, M.TRANSF_PMNT_REGIE, M.CONTACT_ACHTR, M.AUTRE,
  M.COORD_BANC_ERR, M.TX_TVA_ERR, M.MONTANTTOTAL_ERR, M.CALCUL_ERR, M.NON_CONFORME, M.DOUBLON, M.DEST_ERR, M.TRANSAC_INC,
  M.EMMET_INC, M.CONTRAT_TERM, M.DOUBLE_FACT, M.CMD_ERR, M.ADR_ERR, M.REF_CT_ABSENT, M.LIVR_INCOMP,
]);
const MOTIFS = Object.freeze({
  [S.DEPOSEE]: [M.NON_TRANSMISE],
  [S.APPROUVEE_PARTIELLEMENT]: [
    M.AUTRE, M.CMD_ERR, M.SIRET_ERR, M.CODE_ROUTAGE_ERR, M.REF_CT_ABSENT, M.REF_ERR, M.PU_ERR, M.REM_ERR, M.QTE_ERR,
    M.ART_ERR, M.MODPAI_ERR, M.QUALITE_ERR, M.LIVR_INCOMP,
  ],
  [S.EN_LITIGE]: [
    M.AUTRE, M.COORD_BANC_ERR, M.TX_TVA_ERR, M.MONTANTTOTAL_ERR, M.CALCUL_ERR, M.NON_CONFORME, M.DOUBLON, M.DEST_ERR,
    M.TRANSAC_INC, M.EMMET_INC, M.CONTRAT_TERM, M.DOUBLE_FACT, M.CMD_ERR, M.ADR_ERR, M.SIRET_ERR, M.CODE_ROUTAGE_ERR,
    M.REF_CT_ABSENT, M.REF_ERR, M.PU_ERR, M.REM_ERR, M.QTE_ERR, M.ART_ERR, M.MODPAI_ERR, M.QUALITE_ERR, M.LIVR_INCOMP,
  ],
  [S.SUSPENDUE]: [M.JUSTIF_ABS, M.COORD_BANC_ERR, M.CMD_ERR, M.SIRET_ERR, M.CODE_ROUTAGE_ERR, M.REF_CT_ABSENT, M.REF_ERR],
  [S.ERREUR_ROUTAGE]: [M.ROUTAGE_ERR],
  [S.IRRECEVABLE]: [
    M.IRR_VIDE_F, M.IRR_TYPE_F, M.IRR_SYNTAX, M.IRR_TAILLE_PJ, M.IRR_NOM_PJ, M.IRR_VID_PJ, M.IRR_EXT_DOC, M.IRR_TAILLE_F,
    M.IRR_ANTIVIRUS, M.IRR_NOM_F,
  ],
});

/** Rang d'avancement pour le statut affiché (Rejetée et Refusée priment, hors rang). */
const RANG = Object.freeze({
  [S.DEPOSEE]: 10,
  [S.EMISE]: 20,
  [S.ERREUR_ROUTAGE]: 25,
  [S.RECUE]: 30,
  [S.MISE_A_DISPOSITION]: 40,
  [S.IRRECEVABLE]: 45,
  [S.PRISE_EN_CHARGE]: 50,
  [S.VISEE]: 55,
  [S.SUSPENDUE]: 60,
  [S.COMPLETEE]: 65,
  [S.EN_LITIGE]: 70,
  [S.APPROUVEE_PARTIELLEMENT]: 80,
  [S.AFFACTUREE]: 85,
  [S.AFFACTUREE_CONFIDENTIEL]: 85,
  [S.CHANGEMENT_COMPTE_A_PAYER]: 85,
  [S.NON_AFFACTUREE]: 85,
  [S.APPROUVEE]: 90,
  [S.DEMANDE_PAIEMENT_DIRECT]: 95,
  [S.PAIEMENT_TRANSMIS]: 100,
  [S.ENCAISSEE]: 110,
  [S.ANNULEE]: 120,
});

const STATUTS = Object.values(STATUT_CDV);
const connu = (statut) => STATUTS.includes(statut);

/** Rôle de la société selon le sens de la facture : vendeur d'une facture émise, acheteur d'une facture reçue ; null si inconnu. */
export function emetteurDuSens(sens) {
  if (sens === SENS_FACTURE.EMISE) return E.VENDEUR;
  if (sens === SENS_FACTURE.RECUE) return E.ACHETEUR;
  return null;
}

/** Émetteurs admis d'un statut ([] si inconnu). */
export function emetteursStatut(statut) {
  return [...(EMETTEURS[statut] ?? [])];
}

/**
 * Motifs autorisés d'un statut. Rejetée : selon l'émetteur (PA_E à l'émission, PA_R en réception, les deux sans
 * émetteur) ; Refusée : liste B2B ou B2G. Statut sans motif prévu : [].
 */
export function motifsAutorises(statut, { emetteur = null, b2g = false } = {}) {
  if (statut === S.REJETEE) {
    if (emetteur === E.PA_R) return [...MOTIFS_REJET_RECEPTION];
    return [...MOTIFS_REJET_EMISSION];
  }
  if (statut === S.REFUSEE) return [...(b2g ? MOTIFS_REFUS_B2G : MOTIFS_REFUS_B2B)];
  return [...(MOTIFS[statut] ?? [])];
}

/** Statut terminal (Rejetée, Refusée). */
export const statutTerminal = (statut) => STATUTS_TERMINAUX.includes(statut);

/** Motif obligatoire (BR-FR-CDV-15 : Approuvée partiellement, En litige, Suspendue, Refusée, Rejetée, Irrecevable). */
export const motifObligatoire = (statut) => STATUTS_MOTIF_OBLIGATOIRE.includes(statut);

/** Statut obligatoirement transmis au PPF (Déposée, Refusée, Encaissée, Rejetée). */
export const obligatoirePpf = (statut) => STATUTS_OBLIGATOIRES_PPF.includes(statut);

/**
 * Erreurs d'enchaînement d'un statut posé par la société (le rôle du sens) après un historique (codes dans l'ordre
 * chronologique) : rien après un statut terminal ; facture émise : rien avant Déposée ; Déposée une seule fois ;
 * Complétée seulement en réponse à une Suspendue ; Refusée impossible après Approuvée ou Paiement transmis.
 */
function erreursEnchainement(sens, historiqueLu, statut) {
  const historique = historiqueLu ?? [];
  const erreurs = [];
  if (historique.some(statutTerminal)) erreurs.push(ERREUR_FE.STATUT_TERMINAL);
  const interdite = (sens === SENS_FACTURE.EMISE && !historique.includes(S.DEPOSEE))
    || (statut === S.DEPOSEE && historique.includes(S.DEPOSEE))
    || (statut === S.COMPLETEE && historique.filter((h) => h === S.SUSPENDUE || h === S.COMPLETEE).at(-1) !== S.SUSPENDUE)
    || (statut === S.REFUSEE && historique.some((h) => h === S.APPROUVEE || h === S.PAIEMENT_TRANSMIS));
  if (interdite) erreurs.push(ERREUR_FE.TRANSITION_INTERDITE);
  return erreurs;
}

/**
 * Contrôle d'un statut avant de le poser ou à sa réception : { sens, historique, statut, emetteur, motif, action, b2g }.
 * Renvoie la liste des codes ERREUR_FE (vide : statut admis). Les règles d'enchaînement (terminal, transition) ne
 * s'appliquent qu'au statut posé par la société (émetteur = rôle du sens) ; un statut reçu est contrôlé sur son code,
 * son émetteur, son motif et son action.
 */
export function controlerStatut({ sens, historique = null, statut, emetteur, motif = null, action = null, b2g = false }) {
  const role = emetteurDuSens(sens);
  if (!role) return [ERREUR_FE.SENS_INCONNU];
  if (!connu(statut)) return [ERREUR_FE.STATUT_INCONNU];
  const erreurs = [];
  if (!emetteursStatut(statut).includes(emetteur)) erreurs.push(ERREUR_FE.EMETTEUR_NON_AUTORISE);
  if (motif) {
    if (!Object.values(MOTIF_STATUT).includes(motif)) erreurs.push(ERREUR_FE.MOTIF_INCONNU);
    else if (!motifsAutorises(statut, { emetteur, b2g }).includes(motif)) erreurs.push(ERREUR_FE.MOTIF_NON_AUTORISE);
  } else if (motifObligatoire(statut)) erreurs.push(ERREUR_FE.MOTIF_OBLIGATOIRE);
  if (action && !Object.values(ACTION_CDV).includes(action)) erreurs.push(ERREUR_FE.ACTION_INCONNUE);
  if (emetteur === role) erreurs.push(...erreursEnchainement(sens, historique, statut));
  return erreurs;
}

/** Statuts que la société peut poser après un historique, dans l'ordre de STATUT_CDV ([] si sens inconnu). */
export function statutsPosables(sens, historique = null) {
  const role = emetteurDuSens(sens);
  if (!role) return [];
  return STATUTS.filter((s) => EMETTEURS[s].includes(role) && erreursEnchainement(sens, historique, s).length === 0);
}

/**
 * Statut affiché d'une facture d'après son historique (ordre chronologique) : le premier statut terminal s'il y en a,
 * sinon le plus avancé (à rang égal, le plus récent) ; codes inconnus ignorés ; null sans statut (historique null = vide).
 */
export function statutAffiche(historiqueLu = null) {
  const historique = historiqueLu ?? [];
  const terminal = historique.find(statutTerminal);
  if (terminal) return terminal;
  let affiche = null;
  for (const s of historique) if (RANG[s] !== undefined && (affiche === null || RANG[s] >= RANG[affiche])) affiche = s;
  return affiche;
}
