import { CLASSES_FICHE as CLASSES_BASE } from './fiches.js';
import { FicheElement } from './fiche-element.js';

// Classes de fiche par type (module séparé : FicheElement dérive de FicheLogiBTP défini dans fiches.js).
export const CLASSES_FICHE = { ...CLASSES_BASE, element: FicheElement };
