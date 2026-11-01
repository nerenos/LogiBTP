// @logibtp/socle/ui – composants d'interface réutilisables par tous les modules.
export * from './arbre.js';
export { GrilleArbre } from './grille.js';
export { Magasin } from './etat.js';
export { ListeDeroulante, AssistantFormule } from './liste-deroulante.js';
export { creerCombo, comboDepuisSelect, activerCombos } from './combo.js';
export { champDate, activerDates } from './champ-date.js';
export { lireNombre, nombreSaisi, formatNombre, formatLibre, formatDate, formatDateHeure, formatHeure, htmlSur, echapper, estHtml, decoderEntites } from './format.js';
export { lirePreferences, ecrirePreferences, lireStockage, ecrireStockage } from './preferences.js';
export { magasinIdb } from './idb.js';
export { separateur } from './separateur.js';
export { telechargerFichier, telechargerCsv, celluleCsv } from './fichier.js';
export {
  actionDe, combinaison, estModificateur, libelleRaccourci, libelleTouches, touchesDe, configurerRaccourcis, declarerRaccourcis, catalogueRaccourcis,
  conflitsRaccourci, personnaliserRaccourci, reinitialiserRaccourcis, definirAideRaccourcis, ouvrirAideRaccourcis,
} from './raccourcis.js';
export { ouvrirMenuContextuel, fermerMenuContextuel } from './menu-contextuel.js';
export { basculerAideMemoire, fermerAideMemoire } from './aide-memoire.js';
export { editerLibelle } from './editeur-riche.js';
export { THEMES, appliquerTheme, DENSITES, appliquerDensite } from './theme.js';
export { ouvrirDialogue, confirmer, alerter, saisir, ouvrirModale } from './dialogue.js';
export { PadSignature, epaisseurTrait } from './signature.js';
export { notifier, titreNotification, corpsNotificationHtml, EVENEMENT_NOTIFICATION, DELAI_NOTIFICATION } from './notification.js';
export { activerInfobulles, bulleHtml, positionBulle } from './infobulle.js';
