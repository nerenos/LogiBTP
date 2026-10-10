// @logibtp/socle/ui – composants d'interface réutilisables par tous les modules.
export * from './arbre.js';
export { GrilleArbre } from './grille.js';
export { Magasin } from './etat.js';
export { ListeDeroulante, AssistantFormule } from './liste-deroulante.js';
export { lireNombre, formatNombre, formatLibre, htmlSur, echapper, estHtml, decoderEntites } from './format.js';
export { lirePreferences, ecrirePreferences } from './preferences.js';
export { actionDe, combinaison, libelleRaccourci, configurerRaccourcis } from './raccourcis.js';
export { editerLibelle } from './editeur-riche.js';
