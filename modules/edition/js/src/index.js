// Module Édition (sans métier) : modèles, formules, mise en ligne et pagination sans DOM, rendus SVG (aperçu) et PDF.
// Même code dans le navigateur et côté serveur (Jint, paquet `serveur/entree.js`).
export { editer, fragmentsBande, assembler } from './rapport.js';
export { produirePdf } from './rendu-pdf.js';
export { pageSvg, policesCss, familleCss } from './rendu-svg.js';
export { Polices, fontkitEdition, cleFace } from './polices.js';
export { mettreEnLignes, styleTexte } from './texte.js';
export { lireHtml, texteDeHtml, decoderEntites } from './html.js';
export { evaluerFormule, evaluerCondition, verifierFormule, formaterNombre, formaterDate, enTexte, FONCTIONS, ErreurFormule } from './formules.js';
export { CHARTE_DEFAUT, completerCharte, resoudreStyle, resoudreCouleur, resoudreTrait, verifierCharte } from './charte.js';
export { montantEnLettres, entierEnLettres } from './lettres.js';
export { normaliserModele, verifierModele, dependances, chercherCycle, parcourir, FORMAT_VERSION } from './modele.js';
export { code39, matriceQr } from './codes.js';
export { lireImage } from './images.js';
export { FORMATS, dimensionsPage, PT_MM, MM_PT } from './unites.js';
export { FACES_EDITION, chargerPolices } from './faces.js';
export { base64VersOctets, octetsVersBase64 } from './base64.js';
