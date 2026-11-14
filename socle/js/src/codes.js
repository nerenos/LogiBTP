// Codes communs aux modules, répliqués dans LogiBTP.Socle/Codes.cs (parité vérifiée par CodesTests.cs).

/** Niveau d'une notification ou d'une alerte (du moins au plus pressant). */
export const NIVEAU_NOTIFICATION = Object.freeze({
  INFO: 'INFO',
  ATTENTION: 'ATTENTION',
  URGENT: 'URGENT',
});

/** Profils connus du code (les autres profils sont du paramétrage) : ADMIN = profil total, BORNE = saisies d'une borne. */
export const PROFIL = Object.freeze({
  ADMIN: 'ADMIN',
  BORNE: 'BORNE',
});

/** Actions des droits : actions du modèle, actions propres à un nœud et noms employés par les modules. */
export const ACTION_DROIT = Object.freeze({
  CONSULTER: 'CONSULTER',
  MODIFIER: 'MODIFIER',
  VALIDER: 'VALIDER',
  CREER: 'CREER',
  SUPPRIMER: 'SUPPRIMER',
  DEVERROUILLER: 'DEVERROUILLER',
  FORCER: 'FORCER',
  RGPD: 'RGPD',
  SUPERVISER: 'SUPERVISER',
  USURPER: 'USURPER',
  PARAMETRER: 'PARAMETRER',
  VOIR: 'VOIR',
  TRANSFORMER: 'TRANSFORMER',
  APPROUVER: 'APPROUVER',
  DEVALIDER: 'DEVALIDER',
  DEBLOQUER: 'DEBLOQUER',
  CONFIDENTIEL: 'CONFIDENTIEL',
  MODIFIER_CODE: 'MODIFIER_CODE',
});

/** Portées d'une action accordée par le module Droits (de la plus étroite à la plus large). */
export const PORTEE_DROIT = Object.freeze({
  SOI: 'SOI',
  EQUIPE: 'EQUIPE',
  SERVICE: 'SERVICE',
  TOUT: 'TOUT',
});

/** Niveaux de confidentialité (GED, modèles d'édition), du plus ouvert au plus strict. */
export const NIVEAU_CONFIDENTIALITE = Object.freeze({
  PUBLIC: 'PUBLIC',
  INTERNE: 'INTERNE',
  CONFIDENTIEL: 'CONFIDENTIEL',
  SECRET: 'SECRET',
});

/**
 * Erreurs communes de l'enregistrement des données (`ErreursEnregistrement` du socle C#) : saisie refusée
 * (422 VALIDATION, `details` = erreurs par champ `{ champ, code, message }`), refus de la base traduits.
 */
export const ERREUR_ENREGISTREMENT = Object.freeze({
  VALIDATION: 'VALIDATION',
  DOUBLON: 'DOUBLON',
  UTILISE: 'UTILISE',
  VALEUR: 'VALEUR',
  OBLIGATOIRE: 'OBLIGATOIRE',
  ERREUR: 'ERREUR',
  LONGUEUR: 'LONGUEUR',
  FORMAT: 'FORMAT',
  INCONNU: 'INCONNU',
});

/** Types d'écriture de l'API (format d'échange et de contrôle de chaque route d'écriture) ↔ `TypesEcriture` (C#). */
export const TYPE_ECRITURE = Object.freeze({
  FICHE: 'FICHE',
  DOCUMENT: 'DOCUMENT',
  PARAMETRAGE: 'PARAMETRAGE',
  ACTION: 'ACTION',
  LOT: 'LOT',
  FICHIER: 'FICHIER',
  SESSION: 'SESSION',
  LECTURE: 'LECTURE',
});

/** Origine d'une écriture (module MCP) ↔ `OrigineEcriture` (C#). */
export const ORIGINE_ECRITURE = Object.freeze({
  HUMAIN: 'HUMAIN',
  AGENT: 'AGENT',
  USURPATION: 'USURPATION',
  SERVICE: 'SERVICE',
});

/** Garde-fous d'une délégation d'agent ↔ `GardeFou` (C#). */
export const GARDE_FOU = Object.freeze({
  RGPD: 'RGPD',
  TIERS: 'TIERS',
  SALARIES: 'SALARIES',
  PAIE: 'PAIE',
  COUTS: 'COUTS',
  GED_CONFIDENTIEL: 'GED_CONFIDENTIEL',
  CRM_NOTES: 'CRM_NOTES',
  ENVOI: 'ENVOI',
  VALIDATION: 'VALIDATION',
  VOLUME: 'VOLUME',
});

/** Modèles de plafond d'une délégation ↔ `ModelePlafond` (C#). */
export const MODELE_PLAFOND = Object.freeze({
  LECTURE: 'LECTURE',
  PREPARATION: 'PREPARATION',
  COMME_MOI: 'COMME_MOI',
  SUR_MESURE: 'SUR_MESURE',
});

/** Erreurs de la délégation à un agent ↔ `ErreursAgent` (C#). */
export const ERREUR_AGENT = Object.freeze({
  AGENT_INTERDIT: 'AGENT_INTERDIT',
  AGENT_GARDE_FOU: 'AGENT_GARDE_FOU',
});
