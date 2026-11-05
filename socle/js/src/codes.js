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
