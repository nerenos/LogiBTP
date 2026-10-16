import { normaliserRecherche } from './recherche.js';
import { extension } from './fichiers.js';
import { plusStricte } from './acces.js';

// Classification automatique d'un document à partir de son contenu et de ses métadonnées. Même règle que
// ClassificationGed.cs (jeu partagé modules/ged/tests/cas/05_classification.json) ; règles par défaut identiques aux
// INSERT de db/051_ged_organisation.sql.
//   - une règle active s'applique quand tous ses critères renseignés sont remplis (règle sans critère : jamais) :
//     extension du fichier (liste), type MIME (préfixe), un des mots (titre, nom du fichier et 20 000 premiers
//     caractères du texte extrait, normalisés), expéditeur d'un mail (contient, normalisé), type d'élément lié ;
//   - résultat : catégorie de la première règle applicable qui en donne une (priorité, puis id), confidentialité la
//     plus stricte, mots-clés de toutes les règles applicables (sans doublon, dans l'ordre), ids des règles appliquées.

export const REGLES_CLASSIFICATION_DEFAUT = [
  { id: 1, libelle: 'Mails', priorite: 10, extensions: ['eml', 'msg'], types_mime: [], mots: [], expediteur: null, type_element: null, categorie: 'mail', confidentialite: null, mots_cles: [], actif: true },
  { id: 2, libelle: 'Factures', priorite: 20, extensions: [], types_mime: [], mots: ['facture'], expediteur: null, type_element: null, categorie: 'facture_recue', confidentialite: null, mots_cles: ['facture'], actif: true },
  { id: 3, libelle: 'Devis signés', priorite: 20, extensions: [], types_mime: [], mots: ['bon pour accord', 'devis signe'], expediteur: null, type_element: null, categorie: 'devis_signe', confidentialite: null, mots_cles: ['devis'], actif: true },
  { id: 4, libelle: 'Contrats', priorite: 20, extensions: [], types_mime: [], mots: ['contrat'], expediteur: null, type_element: null, categorie: 'contrat', confidentialite: 'CONFIDENTIEL', mots_cles: ['contrat'], actif: true },
  { id: 5, libelle: 'Plans', priorite: 30, extensions: ['dwg', 'dxf', 'ifc'], types_mime: [], mots: [], expediteur: null, type_element: null, categorie: 'plan', confidentialite: null, mots_cles: ['plan'], actif: true },
  { id: 6, libelle: 'Photos', priorite: 40, extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp'], types_mime: ['image/'], mots: [], expediteur: null, type_element: null, categorie: 'photo', confidentialite: null, mots_cles: [], actif: true },
  { id: 7, libelle: 'Certificats', priorite: 30, extensions: [], types_mime: [], mots: ['caces', 'habilitation', 'certificat', 'attestation'], expediteur: null, type_element: null, categorie: 'certificat', confidentialite: null, mots_cles: [], actif: true },
  { id: 8, libelle: 'Documents RH', priorite: 15, extensions: [], types_mime: [], mots: ['arret de travail', 'bulletin de paie', 'entretien annuel'], expediteur: null, type_element: null, categorie: null, confidentialite: 'CONFIDENTIEL', mots_cles: ['rh'], actif: true },
];

export const TEXTE_CLASSIFICATION_MAX = 20000;

const liste = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== '') : []);

/** Critères d'une règle appliqués au document ; null si la règle n'a aucun critère. */
function applicable(r, { ext, mime, corpus, expediteur, type_element }) {
  const criteres = [];
  if (liste(r.extensions).length) criteres.push(liste(r.extensions).some((e) => e.toLowerCase() === ext));
  if (liste(r.types_mime).length) criteres.push(liste(r.types_mime).some((t) => mime.startsWith(t.toLowerCase())));
  if (liste(r.mots).length) criteres.push(liste(r.mots).some((m) => corpus.includes(normaliserRecherche(m))));
  if (r.expediteur) criteres.push(expediteur.includes(normaliserRecherche(r.expediteur)));
  if (r.type_element) criteres.push(r.type_element === type_element);
  return criteres.length ? criteres.every(Boolean) : null;
}

/**
 * doc : { nom_fichier, type_mime, titre, texte, expediteur, type_element } ;
 * → { categorie, confidentialite, mots_cles, regles }.
 */
export function classer(doc, regles) {
  const contexte = {
    ext: extension(doc.nom_fichier),
    mime: String(doc.type_mime ?? '').toLowerCase(),
    corpus: normaliserRecherche(`${doc.titre ?? ''} ${doc.nom_fichier ?? ''} ${String(doc.texte ?? '').slice(0, TEXTE_CLASSIFICATION_MAX)}`),
    expediteur: normaliserRecherche(doc.expediteur ?? ''),
    type_element: doc.type_element ?? null,
  };
  const r = { categorie: null, confidentialite: null, mots_cles: [], regles: [] };
  const triees = regles.filter((x) => x.actif !== false).sort((a, b) => (a.priorite ?? 100) - (b.priorite ?? 100) || a.id - b.id);
  for (const regle of triees) {
    if (!applicable(regle, contexte)) continue;
    r.regles.push(regle.id);
    r.categorie ??= regle.categorie ?? null;
    r.confidentialite = plusStricte(r.confidentialite, regle.confidentialite ?? null);
    for (const m of liste(regle.mots_cles)) if (!r.mots_cles.includes(m)) r.mots_cles.push(m);
  }
  return r;
}
