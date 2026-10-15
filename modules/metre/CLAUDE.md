# Module Métré – contexte

## Rôle
- Métrés (lignes de calcul arborescentes) qui donnent la quantité d'une ligne de l'hôte, et variables de calcul à portées (`$$` document, `$` titre, `@@` ouvrage, `@` ligne), affectées (`=`) ou incrémentées (`+=`).
- Évaluation : le niveau de sous-détail le plus bas d'abord, dans l'ordre des lignes, puis remontée ; dans un niveau, chaque ligne s'applique au cumul précédent sans priorité mathématique. Valeurs arrondies à 6 décimales (`arr6`).

## Dépendances
- Dépend de : socle seul (`D`, `S`, `ZERO`, `arr6`, `evaluerExpression`, `analyserCibleVariable`, `ErreurCalcul` ; UI : `GrilleArbre`, `CFG_METRE`, `formatLibre`…). Ne dépend PAS du module Document : il ignore la structure de l'hôte.
- Utilisé par le cœur : moteur BTP `client/src/calcul/moteur-btp.js` et `src/LogiBTP.Calcul/MoteurDevisBtp.cs` (`Portees`, `EvaluateurMetre`, `evaluerVariable` / `Variables.Evaluer`, `repartirVariables`) ; `client/src/app/editeur-btp.js` (hôte du panneau, `DictionnaireBtp extends DictionnaireMetre`) ; `pages/document.js` (`#metre`) et `fiches/fiche-element.js` (composition d'ouvrage) ; `ElementsBibliotheque.cs`, `LogiBtpContext.cs`, `SpecialisationBtp.cs`.

## Structure
- `db/020_metre_schema.sql` : `metre`, `metre_ligne`, `variable_definition` (sans FK vers l'hôte).
- `js/src/evaluateur-metre.js` : `EvaluateurMetre` ; `portees.js` : `Portees` ; `variables.js` : `evaluerVariable`, `repartirVariables`, `parOrdre`.
- `js/ui/panneau-metre.js` : `PanneauMetre` (onglets Définition / Lignes, même grille et pile d'annulation que l'hôte) ; `dictionnaire.js` : `DictionnaireMetre` ; `metre.css`.
- `dotnet/LogiBTP.Metres` : `Domaine.cs` (`Metre`, `MetreLigne`, `VariableDefinition`), `EvaluateurMetre.cs`, `Portees.cs`, `Variables.cs` (`Evaluer`, `Repartir`, `RepartitionVariables`). Pas de projet Web ni de routes.

## Modèle de données
- `metre` (`mtr_id`, `mtr_lig_id` ligne de l'hôte, `mtr_libelle`, `mtr_unt_code`, `mtr_variable` ex. `@surface`, `mtr_resultat`).
- `metre_ligne` (`mli_mtr_id`, `mli_parent_id` sous-détail, `mli_ordre`, `mli_type` V valeur / D sous-détail / S sous-total, `mli_operateur` + − × ÷, `mli_formule`, `mli_valeur`, `mli_st_depuis_id`, `mli_variable`, `mli_commentaire`).
- `variable_definition` (`var_ent_id` document, `var_lig_id` null = document, `var_mtr_id` = onglet Définition d'un métré, `var_portee`, `var_nom`, `var_operation` `=` / `+=`, `var_formule`, `var_ordre`, `var_valeur`).
- Cœur (`db/100_btp.sql`) : FK `fk_mtr_ligne`, `fk_var_document`, `fk_var_ligne` ; colonnes `document_ligne.lig_mtr_id`, `lig_qte_source` (`S` saisie, `M` métré).

## Points de spécialisation
- `Portees(hote)` : `hote.chaine(portee, ligneId)` → contextes du plus proche au plus lointain, `hote.messagePortee?(portee)` ; écriture au plus proche, lecture en remontant. Cœur : `$` = titres englobants (la ligne si titre), `@@` = ouvrages englobants. C# : `new Portees(chaine, messagePortee)`.
- `EvaluateurMetre({ resolveur, affecter })` : `appliquer`, `valeurFormule`, `arrondir` surchargeables.
- `DictionnaireMetre(hote)` : `accessible(portee, proprietaireId, ligId)`, `donnees(ligId, options)`, `entrees(ligId, options)`.
- `PanneauMetre(racine, hote, { fermer, message, dictionnaire })` ; hôte : `magasin`, `saisie` (metres, metre_lignes, variables, document.ent_id), `resultat` (metres, metre_lignes, variables, erreurs), `titreLigne`, `metreDeLigne`, `peutAvoirMetre`, `creerMetre`, `variablesDocumentSur` (facultatif ; cœur : ligne SECTION → variables `$$` du document). Méthodes `suivre(ligId)`, `ouvrir`, `fermer`, `aideSansMetre`.

## Règles répliquées JS / C# et jeux de cas
- `evaluateur-metre.js` ↔ `EvaluateurMetre.cs`, `portees.js` ↔ `Portees.cs`, `variables.js` ↔ `Variables.cs`.
- Jeux du module (sans hôte, une ligne id 1, un contexte unique) : `tests/cas/01_sous_details_sous_totaux.json`, `02_somme_de_produits.json`, `03_definitions_affectation.json`, `04_erreurs.json`.
- Jeux du cœur qui l'exercent via le moteur BTP : `tests/cas/03_metres_sous_details.json`, `04_variables_increment_poids.json`, `12_variables_metre_affectation.json`, `15_ensemble_tranche_parametree.json`.
- Codes d'erreur : `PORTEE`, `VARIABLE_INCONNUE`, `OPERATION_INVALIDE`, `DIVISION_ZERO`, `METRE_SOUS_TOTAL` (sous-total pointé = sous-total précédent du même niveau) ; côté moteur BTP : `METRE_ABSENT`.

## Conventions et pièges
- Ne jamais importer `@logibtp/document` ni le cœur dans ce module ; toute connaissance de l'hôte passe par `hote` / `chaine` / le résolveur.
- Première ligne d'un niveau : initialise le cumul (`-` → négatif) ; sous-total sans `mli_st_depuis_id` = cumul courant.
- Ordre des définitions : `var_ordre` puis `var_id` (`parOrdre`) ; variables `$$` évaluées en premier par les moteurs ; définitions d'un métré évaluées après ses lignes et la quantité de la ligne.
- `+=` exige une variable déjà définie dans la chaîne ; `@` exige une ligne.
- Toute règle modifiée : JS + C# + cas, puis `npm test`, `npm run exporter-resultats`, `dotnet test LogiBTP.slnx` (le moteur BTP en dépend).

## Tests
- `npm test --workspace modules/metre/js` (vitest, `test/cas-metre.test.js`).
- `dotnet test modules/metre/dotnet/LogiBTP.Metres.Tests` (`CasMetreTests.cs`) ; jeux du cœur : `npm test` et `dotnet test LogiBTP.slnx`.
