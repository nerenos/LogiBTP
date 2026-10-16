// @logibtp/ged – GED : empreintes et coffre-fort chaîné, conservation des versions, types de fichiers, mails, fournisseurs.
export { sha256, horodatage, texteEntree, empreinteEntree, verifierChaine, EMPREINTE_ORIGINE } from './coffre.js';
export { editionsAPurger, versionsVisibles, etapes, GENRES, ETAPES } from './versions.js';
export { genreApercu, estMail, extension, icone, formatTaille, titreDepuisNom, dateDepuisFichier } from './fichiers.js';
export { lireMail, texteDeHtml } from './mails.js';
export { FournisseurGedApi, FournisseurGedMemoire, ErreurGed, PARAMETRES_DEFAUT } from './fournisseurs.js';
export { normaliserRecherche, texteRecherche } from './recherche.js';
export { accesAutorise, peutChangerAcces, plusStricte, libelleConfidentialite, CONFIDENTIALITES } from './acces.js';
export { classer, REGLES_CLASSIFICATION_DEFAUT, TEXTE_CLASSIFICATION_MAX } from './classification.js';
export { regleRetention, echeancesRetention, ajouterMois, REGLES_RETENTION_DEFAUT, ACTIONS_FIN } from './retention.js';
export { extraireTexte, ETATS_INDEX } from './texte.js';
