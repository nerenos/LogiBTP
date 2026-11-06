# Module Import – contexte

## Rôle
- Lecture, dans le navigateur (et sous Node pour les tests), de fichiers d'autres logiciels et conversion en un **devis neutre** que le cœur traduit dans son modèle. Aujourd'hui : OptimBTP (`.optim` = zip contenant `Devis.xml`).
- Paquet `@logibtp/import` (`modules/import/js`, un seul point d'entrée `.`), **sans aucune dépendance** (ni socle, ni autre module, ni decimal.js). Voir aussi `README.md` (résumé, à conserver).

## Dépendances
- Dépend de : `@logibtp/socle` (dictionnaire : messages, sorts et motifs des champs) et des API du navigateur (`DecompressionStream`, `TextDecoder`, `Blob`, `Response`).
- Utilisé par : le cœur client seul (`client/src/app/import/formats.js`, `import/devis-importe.js`). Aucun module ne l'importe.

## Structure
- `js/src/zip.js` : `lireZip(octets)` → `[{ nom, taille, lire() }]` (stocké ou deflate ; ni chiffrement ni zip64).
- `js/src/xml.js` : `analyserXml` → `{ nom, attributs, enfants, texte }`, `decoderEntites` ; aides internes `enfant`, `enfants`, `feuilles` (pas de DOMParser).
- `js/src/rtf.js` : `rtfEnHtml`, `rtfEnTexte`, `estRtf` (libellés RichEdit → HTML simple : paragraphes, gras, italique, souligné, accents).
- `js/src/correspondances.js` : `normaliser`, `associerUnite` (synonymes `SYNONYMES_UNITE`), `associerNature` (code, libellé, puis `REGROUPEMENTS`), `associerTaux` (taux normal `N` prioritaire), `associerOption` (égalité puis préfixe).
- `js/src/optim.js` : `lireFichierOptim(octets)` (zip ou XML brut), `convertirOptim(xml)`, `SORTS`, `CHAMPS_ENTETE`, `CHAMPS_LIGNE`, `CHAMPS_INTERVENANT`, `couleurWindows`.
- `js/test/import.test.js` : lecture (zip, XML, RTF), OptimBTP (entête, intervenants, lignes, non repris, refus), correspondances.

## API publique et points de spécialisation
- Devis neutre (`convertirOptim`) : `{ format, entete, intervenants, lignes, complements, parametres, couleurs, non_repris, avertissements }`.
  - `entete` : reference, notre_reference, reference_externe, redacteur, validite_jours, date, objet, chantier, client, mode_reglement, taux_tva_defaut, `controle` (totaux d'origine).
  - ligne : `{ id, parent, type (TITRE | OUVRAGE | ELEMENT | TEXTE | SAUT_PAGE), source, composante, code, libelle_html, non_editee, numero, num_depart, unite, qte, qte_absolue, precision_qte, coef_benef, nature, taux_tva, prix_achat, coef_fg, pv_fixe, pv_unitaire (PVU d'origine, null si vide ou nul : le cœur l'impose aux ouvrages et composantes, mode bordereau), etiquette, controle }`.
  - `non_repris` : `[{ zone, champ, motif, valeurs (≤ 3), nombre, lignes (≤ 5) }]`.
- OptimBTP : TypeLigne 4 / 3 → TITRE, 2 → OUVRAGE, 1 → ELEMENT ; `IsVideTexte` → TEXTE ; `IsSousDetail` → composante (quantité relative, `QteFixe` → absolue × qté du parent) ; `IsFA` (globalisations) écartées, coût inclus via PGU dans `coef_fg` ; `coef_benef` de la ligne de prix propagé aux composantes (calcul « somme des PV ») ; `COUL_xx` → `etiquette` ; paramètre `VALIDITE_OFFRE` → `validite_jours`.
- Rapprochements : référentiels passés sous forme neutre par l'appelant (`{ code, libelle }`, `{ id, code, libelle, regroupement }`, `{ id, taux, categorie }`).

## Utilisation par le cœur
- `client/src/app/import/formats.js` : `FORMATS_IMPORT` (`OptimBTP : { libelle, extensions, type: 'V_DEVIS', lire, page: '/import/optimbtp' }`), `formatImport(code)`.
- `client/src/app/pages/import-optim.js` (`PageImportOptim`, route `/import/optimbtp`, menu dans `navigation/menus.js`) : lit le fichier (dépôt ou `?ged=<id>` pour réutiliser la source GED), aperçu, « Vérifier » → `deposerImport` puis `app.naviguer('/document/import?jeton=…', { nouvelleFenetre: true })`.
- `import/depot-import.js` : IndexedDB `logibtp-imports` (`deposerImport`, `lireImport`, `retirerImport`, purge > 1 jour).
- `import/devis-importe.js` : `saisieDevisImporte(devis, { definition, natures, redacteurs })` → `{ document, lignes, correspondances, controles }` (lignes à ID négatifs, `TL.*`, `lig_type_prix: 'V'`) ; `ecartsImport` (écarts de montant HT par ligne et total).
- `import/devis-a-verifier.js` (appelé par `pages/document.js` quand `id === 'import'`) : `ouvrirImport`, `rendreBandeauImport`, `tracabiliteImport`, `creerDepuisImport`.
- `import/rapport-import.js` : `tableNonRepris`, `rapportImport`, `messagesCorrespondances` ; `documents/tracabilite.js` (onglet Traçabilité) réutilise `tableNonRepris`.

## Conventions et pièges
- Tout champ du fichier a un sort dans `CHAMPS_*` : `repris`, `recalculé` (sert au contrôle des totaux) ou `non repris` (avec motif). Champ absent des tables → signalé « Champ inconnu du module d'import ». Ajouter ou modifier un champ = mettre à jour sa table.
- `non_repris` ne liste que les champs renseignés (`estVide` : vide, `0`, `-1` ignorés) ; affiché **seulement en mode débogage** de la vue (`editeur.vue.debogage`) : bandeau du devis importé et onglet Traçabilité.
- Le devis importé est vérifié dans une **nouvelle fenêtre** comme brouillon non enregistré (`ent_id: 0`) ; bandeau : contrôle du total HT, rapprochements incomplets, « Créer le devis » / « Abandonner ».
- `creerDepuisImport` : `api.creer` puis `api.enregistrer` (échec → `api.supprimerDocument`), fichier source en **GED** du devis (catégorie `import`, `type_element` = code du type, `id_element` = groupe), puis `api.enregistrerOrigine` (`PUT /api/documents/{id}/origine`, table `document_origine` de `modules/document/db/010_document_schema.sql`) avec le rapport ; enfin `remplacerUrl('/document/<id>')` et `publier('enregistre', …)`.
- Nouveau format : un lecteur dans ce module (fonction → devis neutre, tables `CHAMPS_*` propres), exporté par `index.js`, puis une entrée dans `client/src/app/import/formats.js` et une page / route d'import. « Réutiliser l'import » (onglet Traçabilité) ouvre la `page` du format retrouvé par `formatImport(dor_format)`.
- Le module reste sans métier BTP ni dépendance : les codes du cœur (`TL`, colonnes `lig_*`, natures) n'apparaissent que dans `client/src/app/import/`.
- Montants du devis neutre en `Number` (arrondis `arr` à 6 décimales) : le calcul reste celui du moteur du cœur après traduction.

## Textes et icônes (module Personnalisation, lot P3s)
- Textes `import.*` du `fr.json` du module (couche `modules/import/js/personnalisation`, ajoutée à `client/personnalisation/couches.js`) : `xml`, `zip`, `optim` (erreurs et avertissements), `sorts` (`SORTS` par `textesParCode`), `champs.<entete|ligne|intervenant>.<Champ>` (motifs des champs), `zones` du rapport ; tests avec le dictionnaire (`test/preparation.js`). Écrans du cœur : `import_btp.*`.

## Tests
- `npm test --workspace modules/import/js` (vitest), ou `npm test` à la racine.
- Côté cœur : `npm test --workspace client`.

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Module Import (`modules/import/js`, dépend du seul socle : dictionnaire) : lecture dans le navigateur (zip par `DecompressionStream`, XML, libellés RTF → HTML), conversion en devis neutre (`convertirOptim` : entête, intervenants, lignes, couleurs, `non_repris` : champs renseignés sans équivalent, sorts documentés dans `CHAMPS_*`), rapprochements (`associerUnite`, `associerNature`, `associerTaux`, `associerOption`). OptimBTP : phases → titres, sous-détail → composantes (quantité relative ; QteFixe → absolue), globalisations (IsFA) écartées et réparties par PGU dans le déboursé, calcul « somme des PV » (coefficient de vente de la ligne de prix sur ses composantes), COUL_xx → étiquettes (libellé ou couleur, sinon étiquette propre au document).
