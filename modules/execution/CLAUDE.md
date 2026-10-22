# Module Exécution – contexte

## Rôle
- Suivi de l'exécution par élément (chantier) ([analyse](../../documentation/conception/ANALYSE-MODULE-EXECUTION.md) § 3, 4) : parcours des services (modèles, étapes amont), état de chaque service calculé d'après le parcours et les ordres, états imposés à la main, synthèse et vue détaillée.
- Les ordres eux-mêmes sont des documents de la famille E (module Document, spécialisés par le cœur : `Btp/ExecutionBtp.cs`) ; ce module ne les lit que par sa spécialisation. Ne connaît ni les chantiers, ni les services, ni les documents.

## Dépendances
- JS `@logibtp/execution` : aucune. .NET : `LogiBTP.Execution` (règles), `LogiBTP.Execution.Web` → `LogiBTP.Socle.Web`, EF Core Npgsql. Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`SpecialisationExecutionBtp` : services de `db/193`, chantiers suivis, ordres de la famille E ; `db/198` : services et modèles de démonstration ; pages `client/src/app/pages/execution.js`).

## Structure
- `js/src/etats.js` ↔ `dotnet/LogiBTP.Execution/ReglesEtats.cs` (jeu `tests/cas/01_etats.json`) : `ETATS_SERVICE` (SANS_OBJET, A_VENIR, EN_ATTENTE, EN_COURS, BLOQUE, TERMINE), `etatOrdre` (annulé / remplacé ignoré ; bloqué ; soldé ou terminé ; en cours ; brouillon = à faire ; en attente ; transmis sans état = en cours), `etatsServices` (étapes du parcours + ordres + états imposés : un service sans ordre est « à venir » tant qu'une étape amont n'est pas terminée, « en attente » ensuite ; un état imposé l'emporte, `ecart` s'il diffère de l'automatique ; services hors parcours mais avec ordres inclus), `controlerParcours` (PAR_CODE, PAR_DOUBLON, PAR_SERVICE, PAR_AMONT, PAR_BOUCLE), `MESSAGES_EXECUTION`.
- `db/085_execution.sql` (rejouable) : `exe_parcours_modele`, `exe_parcours_etape` (`pae_amonts` TEXT[] de codes), `exe_parcours` (un par élément : `par_type_element`, `par_id_element`, modèle d'origine), `exe_parcours_element_etape` (copie modifiable des étapes), `exe_etat_manuel` (élément, service, état, motif, auteur, date).
- `dotnet/LogiBTP.Execution.Web/ServiceExecution.cs` : entités, `ExecutionDbContext`, DTO, `SpecialisationExecution` (`TypeElement`, `ServicesAsync`, `ElementsAsync(filtre, ids)`, `OrdresAsync(ids)`), `ServiceExecution` (`ModelesAsync`, `EnregistrerModelesAsync` — administrateur, contrôle des étapes —, `EnregistrerParcoursAsync` — modèle copié ou étapes saisies, vide = parcours retiré —, `EnregistrerEtatManuelAsync` — état vide = retour à l'automatique —, `SyntheseAsync` — filtre recherche, service, état —, `DetailAsync`) ; un ordre sans service prend celui de l'étape de même type d'ordre. `Extensions.cs` (`AddModuleExecution<T>`, `MapModuleExecution`).

## Routes HTTP (préfixe `/api/execution`, module activé par société)
- `GET|PUT /parcours-modeles` ; `GET /synthese?recherche=&service=&etat=` ; `GET /elements/{type}/{id}` ; `PUT /elements/{type}/{id}/parcours` { pam_id?, etapes? } ; `PUT /elements/{type}/{id}/services/{srv}/etat` { etat, motif }.

## Tests
- `npm test --workspace modules/execution/js` ; `dotnet test modules/execution/dotnet/LogiBTP.Execution.Tests` (même jeu).
