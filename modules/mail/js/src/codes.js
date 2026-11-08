// Codes du module Mail, répliqués dans LogiBTP.Mail/Codes.cs (parité vérifiée par CodesTests.cs).

/** Codes d'erreur testés par l'interface. */
export const ERREUR_MAIL = Object.freeze({
  MAIL_CONFIRMATION: 'MAIL_CONFIRMATION',
});

/** Type d'une reconnaissance spécialisée d'un courriel. */
export const TYPE_RECONNAISSANCE = Object.freeze({
  ACCUSE_RECEPTION: 'ACCUSE_RECEPTION',
});

/** Précision de la livraison annoncée par un accusé de réception. */
export const PRECISION_LIVRAISON = Object.freeze({
  JOUR: 'JOUR',
  SEMAINE: 'SEMAINE',
});
