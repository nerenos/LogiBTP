# Module Document – contexte

## Rôle
- Document commercial générique (sans métier BTP) : entête, arbre de lignes, pied en tranches, TVA par catégorie, numérotation, statuts, indices, copies, transformations, verrou, historique, traçabilité, affichage de la saisie.
- Cycle : création en BROUILLON → validation (statut VALIDE, verrouillé) ; indices A, B… d'un même groupe (un seul de référence) ; copie = nouveau document, indice A, lien COPIE.
- Fournit des classes mères (méthode patron) que le cœur spécialise ; moteur de calcul répliqué JS / C#.

## Dépendances
- Dépend de : `@logibtp/socle` (JS : `Dec`, `arrondir`, `remplacerVariables`… ; ui : `Magasin`, `GrilleArbre`, `CFG_LIGNES`, `editerLibelle`, préférences), `LogiBTP.Socle` / `LogiBTP.Socle.Web` (`Utilisateur`, `ExceptionMetier`), EF Core Npgsql, HtmlSanitizer. Jamais du cœur.
- Spécialisé par le cœur : `MoteurDevisBtp` (JS `client/src/calcul/moteur-btp.js`, C# `src/LogiBTP.Calcul`), `EditeurDevisBtp` / `ReglesBtp` / `PressePapiersBtp` (`client/src/app/editeur-btp.js`), `PanneauxBtp`, `SpecialisationBtp` + `DocumentCompletBtp` + `LogiBtpContext` (`src/LogiBTP.Api/Btp`), branchés dans `Program.cs`.
- Utilisé par : cœur seul (`client` : `@logibtp/document` ; `LogiBTP.Domaine` → `LogiBTP.Documents`, `LogiBTP.Api` → `LogiBTP.Documents.Web`). Métré est indépendant (le cœur fait le lien). Aucun autre module n'importe Document.

## Structure
- `js/src/moteur-document.js` : `MoteurDocument`, `calculerDocument`, `VERSION_MOTEUR` (0.1.0).
- `js/src/types.js` : `TL`, `CODES_TL`, prédicats (`estChiffree`, `estPied`, `estTypeNumerote`, `accepteEnfants`, `estTranche`), `COLONNES_*`, `MODES_PIED`, `BASES_PIED`, `union`.
- `js/src/numerotation.js` : `numeroter`, `lireFormat`, `formaterRang`, `lireDepart` ; `comparaison.js` : `comparerResultats`, `CHAMPS_DOCUMENT/LIGNE`.
- `js/ui/editeur-document.js` : `EditeurDocument` (grille), `ID_PIED`, `TYPES_DEPOT`, `LIBELLES_*`, `modifierColonne`, `insererColonnes`.
- `js/ui/panneaux.js` : `PanneauxDocument` (entête, détail, totaux, messages, écarts) + helpers `opt`, `lier`, `valeurChamp`, `champsFormulaire`.
- `js/ui/regles.js` `ReglesDocument` (contexte, TVA par défaut, dépôt autorisé) ; `presse-papiers.js` `PressePapiers` (extraire, renuméroter, compléments).
- `js/ui/plan.js` `PlanDocument` ; `disposition.js` `Disposition` (docks gauche/droite/bas) ; `recherche.js` `RechercheLignes`.
- `js/ui/vues.js` `GestionVuesDocument`, `FournisseurVuesMemoire`, `vueParDefaut` ; `parametrage.js` `ParametrageAffichageDocument`, `FournisseurAffichageMemoire`, `controlerEtiquettes` ; `document.css`.
- `dotnet/LogiBTP.Documents/Calcul` : `MoteurDocument<TDoc,TLigne>`, `TL`, `Numerotation`, `ComparateurCalcul`, `Modeles.cs` (`EntreeDocument`, `ResultatDocument`, `OptionsCalcul`, `EntiteLiee`).
- `dotnet/LogiBTP.Documents/Domaine` : `Document`, `DocumentLigne`, `DocumentTva`, `DocumentLien`, `DocumentOrigine`, `DocumentHistorique`, `CalculCasTest`, `Parametrage.cs` (`TypeDocument`, `StatutDocument`, `TauxTva`, `Unite`, `TransformationAutorisee`, `DroitDocument`, `CompteurNumero`…), `Transformations.cs` (`DocumentLigneLien`, `DocumentLigneSolde`).
- `Web/DocumentService.cs` : `Definition`, `Creer`, `Enregistrer`, `Valider`, `Supprimer`, `CreerIndice`, `DesignerReference`, `Copier`, `Recalculer`, `EnregistrerCasTest`, `ExporterCasTest`.
- `Web/PersistanceDocument.cs` : `Charger` / `Ecrire` (retourne `Correspondances`), `Instantane` (historique).
- `Web/TransformationService.cs` : `Transformer`, `Suivi`, `Solder`, `LotArchivage` (`EtapesFacultatives`).
- `Web/TracabiliteDocument.cs` : `TracabiliteService.Lire` / `EnregistrerOrigine`, `OrigineDocumentDto`, `DocumentLie`.
- `Web/VerrouDocument.cs` : `VerrouDocumentService` (`Etat`, `Verrouiller`, `Deverrouiller`, `Forcer`, `Controler`).
- `Web/AffichageDocument.cs` : `AffichageDocumentService` (étiquettes, couleurs, modèles, vues) + entités `EtiquetteLigne`, `VueDocument`…
- `Web/SpecialisationDocument.cs`, `Handlers.cs`, `Contrats.cs` (`DocumentComplet`, `ReponseEnregistrement`, `CreationDocument`, `DemandeTransformation`, `DefinitionType`…), `DocumentDbContext.cs` (abstrait), `Infrastructure.cs` (`NettoyageHtml`), `Extensions.cs`.
- `db/010` schéma, `011` type_ligne, `012` verrou, `013` affichage.
- `tests/cas/*.json` (jeux partagés), `tests/resultats-js/` (sorties JS pour la parité C#).

## Modèle de données
- Paramétrage : `type_document` (`tyd_famille` V/A/S, `tyd_sens`, `tyd_numerotation_continue`, `tyd_handler` NULL = Standard, `tyd_validite_jours`), `statut_document` (`std_modifiable`, `std_terminal` ; codes BROUILLON, VALIDE), `propriete_definition` (niveau E/L, types texte/entier/decimal/date/booleen/liste), `taux_tva` (`ttv_categorie` N/A/I/E), `transformation_autorisee` (`tra_etape`, `tra_vaut_etapes[]`), `droit_document` (CREER, MODIFIER, VALIDER, TRANSFORMER, SUPPRIMER), `compteur_numero`, `unite`.
- `document` (`ent_*`) : numéro, date, objet, références, `ent_validite_jours` / `ent_date_validite`, `ent_std_id`, `ent_tiers_id`, adresses JSONB copiées, `ent_num_format` JSONB, `ent_precision_montant`, totaux NUMERIC(18,6), `ent_proprietes` JSONB, `ent_groupe_id` + `ent_indice` + `ent_is_reference` (indices), `ent_verrouille`, `ent_copie_de_id`, `ent_version` (optimiste), `ent_modele`, `ent_etiquettes`.
- `document_ligne` (`lig_*`) : `lig_parent_id`, `lig_chemin` LTREE (trigger), `lig_ordre`, `lig_tyl_id`, numérotation (`lig_num_depart`, `lig_num_manuelle`), libellés html/affiché/brut, `lig_qte` + `lig_qte_type` R/A, `lig_pv`, `lig_coef_remise` (0,90 = 10 %), `lig_type_prix` V/O/M/A, `lig_variante_de_id`, `lig_st_depuis_id`, pied (`lig_pied_mode` P/M/C, `lig_pied_base`, `lig_pied_base_id`, `lig_pied_sens`, `lig_pied_valeur`, `lig_base_calcul`), TVA, `lig_origine_id`, `lig_proprietes`, `lig_etiquette`.
- TL (`011`, ids fixes) : 1 TITRE, 2 OUVRAGE, 3 ELEMENT, 4 TEXTE, 5 SOUS_TOTAL, 6 IMAGE, 7 SAUT_PAGE, 8 PIED_HT, 9 PIED_TTC, 10 TVA, 11 SECTION.
- Liens : `document_lien` (TRANSFORMATION | COPIE), `document_ligne_lien` (`lil_etape`, `lil_qte` négative pour retour, avancement % / qté), `document_ligne_solde`. Étapes facultatives RETOUR, AVOIR.
- `document_origine` (IMPORT, format, fichier GED, rapport) ; `document_historique` (CREATION, MODIFICATION, VALIDATION, ANNULATION ; `his_instantane` JSONB lz4 de l'état avant) ; `document_tva` ; `calcul_cas_test` (écarts client/serveur arbitrés S/A).
- `verrou_document` (`vdo_jeton` UUID par fenêtre, sans expiration).
- `013` : `etiquette_ligne` (globales ; `ent_etiquettes` complète par document), `couleur_type_prix` (O/M/A, seconde couleur de la pastille).
- `013` : `modele_document` (COMPLET, CHIFFRAGE, VOLEE), `vue_document` (`vdo_definition` { colonnes, debogage, systeme } ; globale si `vdo_proprietaire` NULL, une par défaut par type × modèle).
- Colonnes métier ajoutées par le cœur (`ALTER TABLE` dans `db/`) ; entités C# étendues par héritage (`DocumentBtp`, `DocumentLigneBtp`).

## Points de spécialisation
- JS `MoteurDocument` : getters `colonnesDocument/Ligne/Decimales/Dates/PrixCalcules/QteCalculees` (étendre via `union`), `preparerLignes`, `valider`/`validerLigne`, `avantQuantites`, `quantiteBase`, `quantiteVendue`, `ecrireQuantites`, `apresLigne`, `prixLigne`, `apresPrix`, `pvAffiche`, `ecrireMontants`, `horsCumulPied`, `ecrireTotaux`, `lireVariable`, `completerResultat`. C# : mêmes noms en PascalCase (`protected virtual`), plus `PrixCalcules`, `QuantitesCalculees`, `Composantes`, `ViderMontants`, `EcrireSomme`, `EcrireSousTotalPied`, `CreerResultat`, classe `Prix` extensible.
- `SpecialisationDocument<TDoc,TLigne,TComplet>` : `VersionMoteur`, `PeutDeverrouiller`, `Comparateur`, `CreerEntree`, `Calculer`, `VersComplet`, `CopierEnteteSaisie`, `ControlerValidation`, `ChargerComplements`, `PreparerLigneAEcrire`, `EcrireComplements`, `RenumeroterComplements`, `FiltrerComplements`, `EstLigneCalculee`, `AjusterLigneTransformee`.
- `IDocumentHandler` (Stratégie, choisi par `tyd_handler` via `RegistreHandlers.Pour`) : `Initialiser`, `Controler`, `Calculer`, `AvantValidation`, `QuantiteCible` ; `HandlerStandard` (propriétés, `TYPE_PRIX_HERITE`), `HandlerFactureAvancement` (cumul % − déjà transformé).
- Branchement : `AddModuleDocument<TDoc,TLigne,TComplet,TContexte,TSpecialisation>()` + `MapModuleDocument<…>()` ; `DocumentDbContext` abstrait, `DocumentComplet<TDoc,TLigne>`.
- `EditeurDocument` : `creerRegles`, `creerPressePapiers`, `calculer`, `entree`, `nouvelleLigne`, `identifiants`, `colonnes`, `estLigneCalculee`, `apresSuppression`, `variablesLibelle`, `champsSysteme` ; callbacks constructeur `surSelection`, `surMessage`, `appelerCode`, `rechercher` ; propriétés posées par l'hôte `surVue`, `surFiltre`, `surDepotExterne`. API : `appliquerVue`, `filtrer`, `filtrerMarqueurs`, `allerA`, `marquer`, `insererContenu(…, { position })`.
- `PanneauxDocument` : `champsEntete`, `champTiers`, `sectionsEntete`, `lierEntete`, `champsDetail`, `aideLigneAbsente`, `lignesTotaux`, `controlesSupplementaires`. `ReglesDocument` (`appliquerContexte`, `apresModification`, `depotAutorise`) ; `PressePapiers` (`extraireComplements`, `renumeroterComplements`, `insererComplements`).
- `Disposition({ surOnglet, surDock, racine })` ; `PlanDocument` / `RechercheLignes` (`{ editeur }`) ; fournisseurs mémoire pour la démo hors ligne.

## Routes HTTP (préfixe du groupe `api`)
- Paramétrage : `GET /types-document`, `GET /types-document/{code}/definition`, `GET /unites`, `GET|PUT /etiquettes-ligne`, `GET|PUT /couleurs-type-prix`, `GET /modeles-document`, `GET|PUT /vues-document`, `DELETE /vues-document/{id}`.
- Documents : `GET /documents?type=`, `GET|PUT|DELETE /documents/{id}`, `POST /documents`, `POST …/valider|indices|reference|copie`, `GET …/historique`, `GET /historique/{hisId}`, `GET …/tracabilite`, `PUT …/origine`.
- Verrou : `GET|POST|DELETE /documents/{id}/verrou` (jeton), `DELETE …/verrou/force` ; `PUT /documents/{id}` contrôle le verrou.
- Transformations : `POST …/transformer`, `GET …/suivi`, `POST /lignes/{ligId}/soldes`, `GET …/lot-archivage`.
- Calcul : `POST /calcul` (recalcul serveur), `POST /cas-test`, `GET /cas-test/{id}/export`.

## Règles répliquées JS / C# et jeux de cas
- Toute règle de `MoteurDocument` / `Numerotation` / `TL` existe dans les deux langages ; ajouter un cas dans `tests/cas`.
- Jeux : 01 PV saisi, remise, option, TVA multi-taux ; 02 ligne composée (qté relatives/absolues) ; 03 pied remise HT, retenue après TVA, caution pour mémoire ; 04 TVA autoliquidée / intracom ; 05 sous-totaux pointés, numérotation A.1.a, départ, numéro manuel ; 06 pied en tranches, bases, coefficient, totaux masqués ; 07 section.
- C# (`CasDocumentTests`) : `Cas_partage`, `Stabilite`, `Parite_avec_le_moteur_js` (lit `tests/resultats-js`, régénéré par `exporter-resultats`), `Colonnes_generiques_alignees_avec_le_module_js`.
- Écarts client/serveur détectés à l'enregistrement (`ComparateurCalcul`, `comparerResultats`) puis arbitrés dans `calcul_cas_test`.

## Conventions et pièges
- Ne jamais comparer `lig_tyl_id` numériquement : utiliser les prédicats (`estPied`, `estTranche`…). SECTION : racine seulement (`SECTION_RACINE`), pied à la racine (`PIED_RACINE`).
- Codes d'erreur moteur à garder identiques (ex. `VARIABLE_INCONNUE`, `TVA_MANQUANTE`, `TVA_DOUBLE`, `PIED_BASE`, `SOUS_TOTAL_POINTE`, `PRIX_INTERDIT`, `QTE_NON_CALCULEE`) ; services : `VERSION` (409), `DOCUMENT_BLOQUE`, `DOCUMENT_VERROUILLE`, `DOCUMENT_LIE`, `DOCUMENT_VALIDE`, `TIERS_OBLIGATOIRE`, `CONTROLES`, `VALIDATION`, `TRANSFORMATION_INTERDITE`, `SOURCE_NON_VALIDEE`, `RIEN_A_TRANSFORMER`.
- Numéro : à la création sauf `tyd_numerotation_continue` (factures, avoirs : à la validation). Validation : statut VALIDE, `ent_verrouille`, `ent_date_validite` = aujourd'hui + jours (serveur).
- Enregistrement : l'entête saisi est recopié champ par champ (ajouter les champs métier dans `CopierEnteteSaisie`) ; libellés HTML nettoyés par `NettoyageHtml` ; ID négatifs temporaires → `CorrespondanceLignes`.
- Suppression bloquée par un lien TRANSFORMATION seulement (COPIE retiré avec le document).
- Lignes virtuelles du pied : `_virtuelle`, `ID_PIED` (−9·10¹¹), ids ≤ −10¹², jamais saisissables.
- Verrou sans expiration : seul `PeutDeverrouiller` (admin par défaut) force. `Disposition` cherche dans `racine` (deux pages coexistent pendant une ouverture).
- Commentaires anciens citent `LogiBTP.Document(.Tests)` : les projets s'appellent `LogiBTP.Documents*`.

## Tests
- `npm test --workspace modules/document/js` (vitest, `js/test/cas-document.test.js` : cas + stabilité).
- `npm run exporter-resultats --workspace modules/document/js` puis `dotnet test modules/document/dotnet/LogiBTP.Documents.Tests` (ou `dotnet test LogiBTP.slnx`).
