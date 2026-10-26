# Module Pointage – contexte

## But
Heures de main-d'œuvre des salariés et des intérimaires : saisie (bureau, borne), contrôles, synthèse et validation, variables de paie et export, valorisation, congés et absences.

## Contraintes absolues
- Ne connaît ni salariés, ni chantiers, ni natures, ni ordres, ni équipes : identifiants fournis par `SpecialisationPointage` (cœur : `SpecialisationPointageBtp`), clés étrangères posées par le cœur (`db/199`). JS sans dépendance ; .NET → `LogiBTP.Socle.Web`. Jamais du cœur ni d'un autre module.
- Un pointage est toujours rattaché à un chantier (chantiers internes pour le temps hors chantier). Durées en minutes entières, heures en minutes depuis minuit, dates « AAAA-MM-JJ ».
- Règles répliquées JS ↔ C# avec un jeu commun : `controles.js` ↔ `ReglesPointage.cs` (`01_controles`), `validation.js` ↔ `ReglesValidation.cs` (`02_validation`), `paie.js` ↔ `ReglesPaie.cs` (`03_paie`), `conges.js` ↔ `ReglesConges.cs` (`04_conges`).
- Deux couches : la SAISIE n'est jamais altérée par la validation ; la couche VALIDE (`poi_semaine`) la remplace quand elle existe. Un jour validé est bloqué (409 `POI_VALIDE`), y compris depuis la borne.
- Jamais de calcul de salaire : uniquement des variables de paie.
- Borne : routes publiques sans session, jeton d'appareil `X-Borne-Jeton` (empreinte SHA-256 en base), PIN haché PBKDF2 (5 essais, 15 min de blocage), jeton de saisie glissant de 5 min en mémoire.
- Droits : saisie = le salarié, le responsable de son service ou un administrateur (`PeutSaisirAsync`) ; RH = `EstRhAsync` ; chef = `ChefDeAsync`.
- Scripts SQL rejouables, pas de migrations EF.

## État actuel
- **JS** : `controles.js` (+ `lundiDe`, `joursSemaine`, `lireDuree`, `ecrireDuree`), `validation.js`, `paie.js`, `conges.js`.
- **Base** : `086` (paramètres, sous-types, `poi_pointage`), `087` (seuils, `poi_semaine`, `poi_validation`, `poi_correction`, `poi_journal`), `088` (profils, rubriques, règles, saisies, zones, exports, valorisation), `088b` (`poi_appareil` avec son paramétrage, `poi_pin`), `088c` (`poi_nature_absence`, `poi_conge`), `088d` (`poi_repas` : un repas au restaurant par salarié et par jour, règle de paie REPAS acceptée).
- **.NET** : `ServicePointage` (paramètres, référentiels, semaine d'un salarié, `Retenus`, `EtatsAsync`), `ServiceSynthese` (synthèse, couche validée, valider / dévalider, corrections), `ServicePaie` (profils, variables, zones, export CSV, valorisation), `ServiceBorne` (appareils, PIN, borne, journée, pointage d'équipe `poi_groupe`, borne d'essai, `SalarieIdentifieAsync` : salarié identifié pour les écrans que l'application ajoute à la borne), `ServiceConges` (demandes, traitements, natures, `AbsencesAsync`), `ServiceRepas` (repas d'un salarié, jour validé refusé, restaurant « non trouvé » créé par l'application), `Extensions` (`AddModulePointage<T>`, `MapModulePointage`).
- **Spécialisation** : `SalariesAsync`, `ChantiersAsync`, `TypesMoAsync`, `ServicesAsync`, `OrdresAsync`, `PeutSaisirAsync`, `EstRhAsync`, `ChefDeAsync`, `SalarieDeAsync`, `JoursTravaillesAsync`, `TauxAsync`, `MotifsAsync`, `EquipesAsync`, `FonctionsAsync`, `OrdreParNumeroAsync`, `ChantiersDuJourAsync`, `ApresCorrectionAsync`, `ApresNonConformiteAsync`, `ApresCongeAsync`, `TousChantiersAsync`, `RestaurantsAsync` (triés par distance au chantier), `CreerRestaurantAsync`.

## Routes (`/api/pointage`, module activé par société)
- Saisie : `GET|PUT /parametres`, `GET|PUT /sous-types`, `GET /referentiels`, `GET /chantiers`, `GET /chantiers/{id}/ordres`, `GET /salaries`, `GET /pointages/{id}/position`, `GET|PUT /semaine/{salarie}/{lundi}`.
- Synthèse : `GET /synthese`, `GET|PUT|DELETE /synthese/semaine/{salarie}/{lundi}`, `POST /synthese/valider|devalider`, `POST /corrections`, `POST /corrections/{id}/appliquer|rejeter`.
- Paie : `GET|PUT /profils`, `GET|PUT /variables/{salarie}/{lundi}`, `GET|PUT /zones/{chantier}`, `GET|POST /export`, `GET /exports`, `GET /exports/{id}/fichier`, `POST /valoriser`.
- Repas (lot 10, A29) : `GET /restaurants?chantier=&recherche=`, `GET|PUT /repas/{salarie}` (`?du=&au=` ; { date, restaurant_id | nouveau, ville, cha_id }) ; règle de paie `REPAS` (valeur par agence).
- Congés : `GET|PUT /natures-absence`, `GET|POST /conges`, `PUT /conges/{id}`, `POST /conges/{id}/valider|refuser|annuler`.
- Bornes (administration) : `GET|POST /appareils`, `PUT /appareils/{id}`, `POST /appareils/{id}/test`, `GET /pins`, `PUT /pins/{salarie}`, `GET|PUT /groupes/{groupe}`.
- Borne (publiques) : `GET /borne`, `POST /borne/identifier`, `GET /borne/ordre`, `GET /borne/chantiers?jeton=` (lot 10, A30 : tous les chantiers et ordres en cours, `SpecialisationPointage.TousChantiersAsync`), `GET /borne/restaurants?jeton=&chantier=&recherche=`, `POST /borne/repas` (journée : `repas`), `POST /borne/pointages`, `POST|PUT /borne/journee`.

## Tests
`npm test --workspace modules/pointage/js` ; `dotnet test modules/pointage/dotnet/LogiBTP.Pointage.Tests` (mêmes jeux).
