// @logibtp/document/ui – éditeur de document et panneaux (classes mères à spécialiser par le cœur).
export { EditeurDocument, ID_PIED, COLONNES_RESTE, COLONNES_AVANCEMENT, ALIAS_AVANCEMENT, TYPES_DEPOT, LIBELLES_TYPE, LIBELLES_PIED, LIBELLES_BASE_PIED, modifierColonne, insererColonnes, variablesTexteDocument, lireDateSaisie, MODES_REMISE, pctDepuisCoef, coefDepuisPct } from './editeur-document.js';
export { ReglesDocument } from './regles.js';
export { PressePapiers, correspondance } from './presse-papiers.js';
export { PanneauxDocument, opt, lier, valeurChamp, champsFormulaire } from './panneaux.js';
export { Disposition } from './disposition.js';
export { GestionVuesDocument, FournisseurVuesMemoire, vueParDefaut, fusionnerDisposition } from './vues.js';
export { ParametrageAffichageDocument, FournisseurAffichageMemoire, controlerEtiquettes } from './parametrage.js';
export { PlanDocument } from './plan.js';
export { RechercheLignes } from './recherche.js';
export { NotificationsDocument, GRAVITES } from './notifications.js';
