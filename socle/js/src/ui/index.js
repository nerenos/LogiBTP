// @logibtp/socle/ui – composants d'interface réutilisables par tous les modules.
export * from './arbre.js';
export { GrilleArbre } from './grille.js';
export { Magasin } from './etat.js';
export { ListeDeroulante, AssistantFormule } from './liste-deroulante.js';
export { creerCombo } from './combo.js';
export { lireNombre, formatNombre, formatLibre, htmlSur, echapper, estHtml, decoderEntites } from './format.js';
export { lirePreferences, ecrirePreferences } from './preferences.js';
export {
  actionDe, combinaison, estModificateur, libelleRaccourci, libelleTouches, touchesDe, configurerRaccourcis, declarerRaccourcis, catalogueRaccourcis,
  conflitsRaccourci, personnaliserRaccourci, reinitialiserRaccourcis, definirAideRaccourcis, ouvrirAideRaccourcis,
} from './raccourcis.js';
export { ouvrirMenuContextuel, fermerMenuContextuel } from './menu-contextuel.js';
export { basculerAideMemoire, fermerAideMemoire } from './aide-memoire.js';
export { editerLibelle } from './editeur-riche.js';
export { THEMES, appliquerTheme } from './theme.js';
