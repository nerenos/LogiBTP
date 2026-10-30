# Module Planning – contexte

## But
Planifier les tâches des chantiers et des services sur des ressources : composant d'affichage sans métier (`VuePlanning`), tâches théoriques et affectées, calcul par les plages travaillées, charge, alertes, dépendances, jalons.

## Contraintes absolues
- Ne connaît ni chantiers, ni ressources, ni calendriers, ni équipes : tout vient de `SpecialisationPlanning` (cœur : `SpecialisationPlanningBtp`). JS → socle seulement ; .NET → `LogiBTP.Socle.Web`. Jamais du cœur ni d'un autre module.
- Temps en minutes depuis 1970, calculé en UTC sans changement d'heure ; heures et durées en minutes.
- Règles répliquées JS ↔ C# avec un jeu commun (toute modification passe par les deux et par le jeu) : `calcul.js` ↔ `ReglesPlanning.cs` (`01_calcul`), `charge.js` ↔ `ReglesCharge.cs` (`02_charge`), `dependances.js` ↔ `ReglesDependances.cs` (`03_dependances`).
- Calcul des tâches côté serveur ; verrou optimiste `tac_version` (409 `PLA_VERSION`) ; chaque écriture publie l'événement « planning » par le `Diffuseur` du socle ; les dépendances FIXE sont propagées après chaque écriture.
- Tâches gérées (`TacheGeree`) : jamais modifiables depuis le planning (409 `PLA_TACHE_GEREE`), écrites par l'application avec `application: true`.
- Affichage : seules les lignes et barres visibles sont dessinées ; pas de calcul pendant un glisser ; préférences d'affichage dans le navigateur ; raccourcis par `actionDe` (groupe `planning`).
- Scripts SQL rejouables, pas de migrations EF.

## État actuel
- **JS** : `temps.js` (instants, échelles HEURE / DEMI_JOUR / JOUR / SEMAINE, en-têtes), `axe.js` (axe à périodes masquées), `disposition.js` (voies, lignes visibles), `calcul.js`, `charge.js`, `dependances.js` ; `ui/vue-planning.js` + `planning.css` : `VuePlanning`, avec ses options (`masque`, `feries`, `lignesTexte`, `aujourdhui`, `ligneFixe`), ses actions (déplacer, agrandir, Ctrl = copie, Alt + clic = scinder, dépôt HTML5, Échap), ses méthodes publiques (`definirDonnees`, `majTache`, `ajouterTache`, `supprimerTache`, `regler`, `zoomer`, `allerA`, `reglerLargeurEntete`) et ses points d'accroche (`contenuBarre`, `classeBarre`, `avancementBarre`, `bulleBarre`, `titreBarre`, `enteteLigne`, `classeLigne`, `decorationsLigne`).
- **Base** : `089` (`pla_tache`, `pla_affectation`, `pla_vue` + vues fournies), `089b` (`pla_parametre`, `pla_notification`), `089c` (`pla_dependance`, `tac_serie`, `pla_jalon`), `089d` (`pla_prevision`, `tac_equipes`, état facultatif), `089e` (`pla_avancement` : avancement réel daté, un relevé par tâche et par jour).
- **.NET** : `ServicePlanning` (vues, données d'une période, écritures, déplacement, scission, à planifier), `ServiceCharge` (charge, notifications SUROCCUPATION / SOUSOCCUPATION / MATERIEL / HABILITATION / EQUIPE, premier créneau), `ServiceLiens` (dépendances, propagation, répétition, jalons), `ServiceRessources` (copies d'équipes, changements, disponibilités), `Extensions` (`AddModulePlanning<T>`, `MapModulePlanning`).
- **Spécialisation** : `RessourcesAsync`, `PlagesAsync`, `PlagesServiceAsync`, `EquipesAsync`, `MembresAsync`, `ChangementsEquipeAsync`, `ElementsAsync`, `BudgetsAsync`, `ServicesAsync`, `SourcesAsync` / `TypesSources`, `HabilitationsAsync`, `TypesHabilitationAsync`, `JalonsAsync`, `ChangerServiceAsync`, `TacheGeree`.

## Routes (`/api/planning`, module activé par société)
`GET|PUT /vues`, `GET /referentiels`, `GET /donnees?vue=&du=&au=&recherche=&services=`, `GET /ressources`, `GET /elements`, `GET /sources`, `GET /a-planifier`, `PUT /a-planifier/prevision`, `POST /calcul`, `POST /taches`, `GET|PUT|DELETE /taches/{id}`, `POST /taches/{id}/deplacer|scinder|repeter`, `GET|PUT /taches/{id}/dependances`, `POST /taches/{id}/equipes/{equipe}/appliquer`, `GET /equipes/{equipe}/membres`, `PUT /ressources/{type}/{id}/service`, `GET /disponibilites`, `GET /creneau`, `GET /charge`, `GET|PUT /notifications`, `GET|PUT /parametres`, `DELETE /series/{serie}`, `GET|POST /jalons`, `DELETE /jalons/{id}`, `GET /taches/{id}/avancements` (écriture par l'application : `EnregistrerAvancementAsync`).

## Tests
`npm test --workspace modules/planning/js` ; `dotnet test modules/planning/dotnet/LogiBTP.Planning.Tests` (mêmes jeux). Prototype : `/planning/prototype?ressources=500&taches=20000`.
