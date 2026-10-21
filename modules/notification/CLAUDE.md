# Module Notifications – contexte

## Rôle
- Centre de notifications commun ([transverse](../../documentation/conception/ANALYSE-MODULES-TRANSVERSE.md) § 5) : une boîte par utilisateur (code du compte de la session), compteur du bandeau, notifications lues / traitées, préférences par module et type (écran ; courriel avec le futur module Mail), planificateur de fond par base de société qui exécute les sources déclarées par l'application.
- Ne connaît pas les modules métier : une source (`ISourceNotifications`) est fournie par l'application ; un module est désigné par son code (`ntf_module`), un élément par (`type_element`, `id_element`), une page par son URL.

## Dépendances
- .NET seul : `LogiBTP.Notifications.Web` → `LogiBTP.Socle.Web` (`Utilisateur`, `IModulesActifs`, sociétés), EF Core Npgsql. Pas de paquet JS (interface dans le client).
- Utilisé par : cœur (`Program.cs` : `AddModuleNotifications`, sources `SourceRappelsCrm`, `SourceHabilitations` de `Btp/NotificationsBtp.cs` ; client : cloche du bandeau, `/notifications`, `/parametres/notifications`).

## Structure
- `ServiceNotification.cs` : `NouvelleNotification` (utilisateur, module, type, titre, texte, niveau INFO / ATTENTION / URGENT, URL, élément, clé), `ISourceNotifications` (`Code`, `Periode`, `Types`, `ProduireAsync(portée, maintenant)`), `ServiceNotification` (`PublierAsync` : préférence écran désactivée ignorée, clé déjà notifiée ignorée ; `BoiteAsync` à traiter / non lues / toutes ; `CompteurAsync` ; `MarquerAsync` lues ou traitées, par identifiants ou tout ; `PreferencesAsync` / `EnregistrerPreferencesAsync` ; `PurgerAsync` ; notifications des modules désactivés masquées par `IModulesActifs`, règle commune E24), entités et `NotificationDbContext`.
- `PlanificateurNotifications.cs` (`BackgroundService`, section `Notifications` : `Actif`, `IntervalleSecondes` 60, `PurgeJours` 90) : à chaque réveil, chaque base (`OptionsSocietes.Societes`, `CreerPorteeSociete`), chaque source dont la période est écoulée (`notification_execution`), erreurs notées sans arrêter les suivantes ; purge quotidienne des notifications traitées anciennes.
- `Extensions.cs` : `AddModuleNotifications(base, section)`, `AddSourceNotifications<T>()` (portée par base), `MapModuleNotifications`.
- `db/008_notification.sql` (rejouable) : `notification` (clé unique par utilisateur sans casse), `notification_preference` (type `*` = tout le module), `notification_execution`.

## Routes HTTP (préfixe `/api/notifications`)
- `GET /?etat=a_traiter|non_lues|toutes&module=&page=&taille=`, `GET /compteur` ({ non_lues, a_traiter, urgentes }), `POST /lues` et `POST /traitees` ({ ids } ou { tout: true } → compteur), `GET|PUT /preferences`, `POST /executer` (administrateur : sources de la base courante tout de suite).

## Règles
- Clé : la source la choisit pour ne notifier qu'une fois (rappel et couleur, synthèse par jour…) ; elle reste unique même après traitement.
- Sans préférence : notification à l'écran ; le courriel attend le module Mail.
