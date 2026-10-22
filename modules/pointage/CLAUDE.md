# Module Pointage – contexte

## Rôle
- Heures de main-d'œuvre des salariés et intérimaires, toujours rattachées à un chantier (chantiers internes pour le temps hors chantier) et éventuellement à un ordre ([analyse](../../documentation/conception/ANALYSE-MODULE-POINTAGE.md)) : paramètres de la société, sous-types de main-d'œuvre (le type est une nature du regroupement main-d'œuvre, fournie par l'application), pointages saisis (couche SAISIE ; couche VALIDE de la synthèse au lot 2), contrôles d'une semaine.
- Ne connaît ni les salariés, ni les chantiers, ni les natures, ni les ordres : identifiants fournis par la spécialisation, clés étrangères posées par le cœur (`db/199`).

## Dépendances
- JS `@logibtp/pointage` : aucune. .NET : `LogiBTP.Pointage` (règles), `LogiBTP.Pointage.Web` → `LogiBTP.Socle.Web`, EF Core Npgsql. Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`SpecialisationPointageBtp` : salariés actifs et service principal, chantiers ouverts et internes, natures MO, services, ordres de la famille E si l'Exécution est active, droit de saisie ; `db/199` ; pages `client/src/app/pages/pointage.js`, liste `pointages`).

## Structure
- `js/src/controles.js` ↔ `dotnet/LogiBTP.Pointage/ReglesPointage.cs` (jeu `tests/cas/01_controles.json`) : `controlerSemaine` (par pointage : POI_CHANTIER, POI_TYPE, POI_MINUTES — 1 à 1440 —, POI_PAS, POI_PLAGE — début et fin cohérents avec la durée —, POI_MOTIF — non-conformité —, POI_CHANTIER_CLOS (avertissement) ; puis POI_CHEVAUCHEMENT par date ; puis POI_JOUR par date et POI_SEMAINE (avertissements) ; durées invalides hors des totaux), `bloquant`, `MESSAGES_POINTAGE`, `PARAMETRES_DEFAUT` ; JS seul : `lundiDe`, `joursSemaine`, `lireDuree` (« 7:30 », « 7h30 », « 7,5 » = heures décimales), `ecrireDuree`. C# : `LundiDe`.
- Unités : durées en minutes entières, heures de début et de fin en minutes depuis minuit, dates « AAAA-MM-JJ ».
- `db/086_pointage.sql` (rejouable) : `poi_parametre` (une ligne : ordre nom / prénom, pas, amplitudes jour et semaine, validation SIMPLE / DOUBLE, blocage JOUR / SEMAINE, intérimaires imputés), `poi_sous_type` (productif, non-conformité ; PRODUCTION, PREPARATION, TRAJET, ATTENTE, NETTOYAGE, NON_CONFORMITE), `poi_pointage` (couche, origine, salarié, date, chantier, ordre, ligne, type de MO, sous-type, début / fin, minutes, motif, commentaire, groupe d'équipe, tâche du planning, auteur, appareil, version).
- `dotnet/LogiBTP.Pointage.Web/ServicePointage.cs` : entités, `PointageDbContext`, DTO, `SpecialisationPointage` (`SalariesAsync`, `ChantiersAsync`, `TypesMoAsync`, `ServicesAsync`, `OrdresAsync`, `PeutSaisirAsync`), `ServicePointage` (paramètres et sous-types — administrateur, sous-type retiré utilisé = inactif —, référentiels, salariés d'un service avec leurs minutes par jour — couche validée prioritaire —, semaine d'un salarié — pointages saisis, chantiers récents, ordres, contrôles —, enregistrement de la semaine — couche SAISIE remplacée, erreurs refusées en 422 avec la liste des contrôles, version incrémentée —, position d'un pointage). `Extensions.cs` (`AddModulePointage<T>`, `MapModulePointage`).

## Routes HTTP (préfixe `/api/pointage`, module activé par société)
- `GET|PUT /parametres`, `GET|PUT /sous-types`, `GET /referentiels`, `GET /chantiers?recherche=`, `GET /salaries?service=&recherche=&lundi=`, `GET /pointages/{id}/position`, `GET|PUT /semaine/{salarie}/{lundi}`.

## Tests
- `npm test --workspace modules/pointage/js` ; `dotnet test modules/pointage/dotnet/LogiBTP.Pointage.Tests` (même jeu).
