# Module Installation – contexte

## But
Installer LogiBTP chez un client sur deux conteneurs Docker indépendants : l'API (qui sert aussi le client web) et
PostgreSQL ; hôte Windows en réseau local ([analyse](../../documentation/conception/ANALYSE-MODULE-INSTALLATION.md),
décisions I1 à I14).

## Contraintes absolues
- `LogiBTP.Installation` sans métier : dépend du socle et de Npgsql seulement ; le cœur fournit les commandes
  (`src/LogiBTP.Api/Btp/CommandeInstallation.cs`), les rôles (`db/installation/roles.sql`) et le manifeste.
- Ordre des scripts SQL : **une seule source**, `db/installation/scripts.txt` (indicateur `rejouable`), lue
  par la base de développement (`db/installation/initialiser-developpement.sh`) et l'installeur ; ordre binaire des
  noms (007 avant 007b), jamais celui de la locale. Tout nouveau script s'y ajoute (test `Manifeste_couvre_tous_les_scripts_du_depot`).
- Installation : scripts appliqués sous `logibtp_schema` (propriétaire), une transaction par script, inscrits dans
  `installation_script` (chemin, empreinte SHA-256) ; l'API tourne sous `logibtp_app` (jamais propriétaire).
- Secrets : générés (`Secrets`), rangés chiffrés dans le `.env` du volume `logibtp-config` (`env:v1:`), jamais
  affichés ; un `.env` fourni est conservé (variables manquantes ajoutées).
- Volumes et réseau **externes** (créés par l'installeur) : `docker compose down -v` ne détruit rien.

## État actuel
- Lot 1 : image (`Dockerfile` à la racine : client Vite → `wwwroot`, publication .NET avec la clé de construction en
  secret BuildKit, scripts SQL sous `/app/sql`, compte `app`, `TZ=Europe/Paris`), projets Compose `docker/base`
  (postgres:17 officiel, `config_file` du volume `logibtp-base-config`) et `docker/api` (service `logibtp-api`,
  service d'outils `logibtp-installation` au profil `outils`) ; client servi par l'API (`ClientWeb` du socle : CSP
  bloquante, alignée sur `client/vite.config.js` par test) ; sociétés dans `societes.json` (dossier `LOGIBTP_CONFIG`),
  connexions déduites du modèle (`ModeleConnexion` du socle : `LOGIBTP_BASE_HOTE`…, base `logibtp` ou
  `logibtp_<code>`, rôle `logibtp_app`) ; conversions de données hors du démarrage (développement excepté). Écart :
  les données de démonstration sont mêlées aux données de référence (211 dépend de 141) : toute base neuve les reçoit.

## Bibliothèque (`dotnet/LogiBTP.Installation`)
- `ManifesteScripts` (`Lire`, `Analyser`, `Ecarts`), `BaseDonnees` (`DefinirRolesAsync`,
  `CreerBaseAsync`, `AppliquerAsync(connexion, racine, scripts, adopter)` → `BilanScripts`, `ScriptsAppliquesAsync`,
  `ExecuterFichierAsync`, `Empreinte`), `ConfigurationPostgres` (`PgHba`, `PostgresqlConf` depuis `ReglagesPostgres` :
  réseau Docker, adresses de l'API distante en `hostssl`, mémoire, fuseau), `SocietesInstallation` (`Preparer`,
  `Ajouter`, `VerifierCode`, `Societes`), `Secrets`.

## Commandes (image de l'API)
`docker compose -f docker/api/compose.yml run --rm logibtp-installation installation …` :
`preparer --domaine D [--deploiement] [--confiance] [--reseau] [--memoire] [--libelle] [--base-hote]`,
`base creer`, `societe ajouter CODE [--libelle]`, `societes`, `scripts verifier`, `conversions`, `etat`.
Variables : `LOGIBTP_CONFIG` (/app/config), `LOGIBTP_CONFIG_BASE` (/app/base-config), `LOGIBTP_SQL` (/app/sql).

## Tests
`dotnet test modules/installation/dotnet/LogiBTP.Installation.Tests` (manifeste ↔ dépôt, ordre, pg_hba, postgresql.conf,
sociétés, connexions du modèle, CSP).
