# Module Installation – référence détaillée

Référence lue à la demande (hors contexte par défaut). Les règles que le code doit respecter sont dans [CLAUDE.md](../../modules/installation/CLAUDE.md) ; une règle modifiée l'est là, l'inventaire ici.

## État actuel
- Lot 1 : image (`Dockerfile` à la racine : client Vite → `wwwroot`, publication .NET avec la clé de construction en
  secret BuildKit, scripts SQL sous `/app/sql`, compte `app`, `TZ=Europe/Paris`), projets Compose `docker/base`
  (postgres:17 officiel, `config_file` du volume `logibtp-base-config`) et `docker/api` (service `logibtp-api`,
  service d'outils `logibtp-installation` au profil `outils`) ; client servi par l'API (`ClientWeb` du socle : CSP
  bloquante, alignée sur `client/vite.config.js` par test) ; sociétés dans `societes.json` (dossier `LOGIBTP_CONFIG`),
  connexions déduites du modèle (`ModeleConnexion` du socle : `LOGIBTP_BASE_HOTE`…, base `logibtp` ou
  `logibtp_<code>`, rôle `logibtp_app`) ; conversions de données hors du démarrage (développement excepté). Données de démonstration séparées
  (plan versionnement-schema, lot 2) : voir « Démonstration et empreintes acceptées » ci-dessous.

- Lot 2 : HTTPS par Kestrel (`LogiBTP.Installation.Web` : `AddHttpsInstallation` — certificat du dossier
  `LOGIBTP_CERTIFICATS` (/app/certificats), écoute 8443 en HTTPS et 8080 en HTTP ; `CertificatServeur` relu à chaud au
  plus toutes les 30 s ; `UseHttpsInstallation` — redirection 308 vers HTTPS sur le domaine `LOGIBTP_DOMAINE` ou l'un
  de ses sous-domaines, jamais vers un autre hôte, sauf `/certificat` et la santé depuis le conteneur ; `MapAmorcage` —
  page publique `/certificat` sans script : empreinte, consignes AD / postes / TSE / tablettes, `logibtp-racine.cer`,
  `Installer-Certificat-LogiBTP.ps1`, `logibtp.mobileconfig`) ; autorité LogiBTP (`AutoriteCertificats` : racine RSA 3072
  de 10 ans à contrainte de noms sur le domaine, serveur RSA 2048 de 730 jours au plus, domaine + joker, clé de la
  racine chiffrée par la clé des données) ; certificats fournis (PKCS#12 ou PEM, couverture du domaine et du joker
  contrôlée) ; rappel 30 jours avant l'échéance aux administrateurs (`SourceCertificat` du cœur).

- Lot 3 : scripts Windows `windows/` (PowerShell 5.1 et 7, UTF-8 avec BOM ; tout passe par `docker`, aucun dossier
  Windows monté : même procédure avec Docker Desktop, WSL ou une machine virtuelle) : `Commun.ps1` (appels de docker par
  `$args` — jamais de fonction à paramètres : `-v`, `-d`, `-u` seraient pris pour `-Verbose`, `-Debug` —, en
  « Continue » : seul le code de retour compte ; passage de fichiers par `docker cp` et un conteneur arrêté ; hôte A / B /
  C ; conservation 7 / 4 / 12), `Installer-LogiBTP.ps1` (rôles Complet, Api avec `-BaseDistante`, Base avec
  `-ConfigurationBase` ; rejouable ; droits du dossier par SID sur la seule racine ; pare-feu, tâches planifiées S4U de
  sauvegarde et de renouvellement, autorité sur le serveur, rapport `INSTALLATION.txt` avec les commandes DNS),
  `Sauvegarder-LogiBTP.ps1` (pg_dump de chaque base, GED et configuration en tar, `-Chiffrer`, copie, rotation,
  `derniere-sauvegarde.json`), `Restaurer-LogiBTP.ps1` (API arrêtée, déchiffrement, bases recréées par le SQL de
  pg_restore rejoué avec `search_path = public`, `installation base droits`, GED, `-AvecConfiguration`) ; base sur une
  autre machine (`installation certificat base`, `hostssl` de tous les rôles depuis l'API, surcharge
  `docker/base/compose.distant.yml`) ; chiffrement des sauvegardes (`ChiffrementSauvegarde` : AES-256-GCM par blocs de
  1 Mo, HKDF de la clé des données, dernier bloc authentifié) ; page `/parametres/installation` (nœud de droits
  `administration/installation`, `GET /api/installation/etat` : `EtatInstallation` du module).

- Lot 11 des demandes du 25/10/2026 (A35, A36) : TLS de la base toujours actif — certificat de la base émis par `installation preparer` (`CertificatBaseLocal` du cœur : autorité LogiBTP, `base.<domaine>`, renouvelé à 60 jours), `pg_hba.conf` en `hostssl` + SCRAM seulement (`ReglagesPostgres.Ssl` obligatoire), API en `VerifyCA` par la racine (`VerifyFull` pour une base distante) ; `EtatBase.Chiffree` (`pg_stat_ssl`) ; installation existante : relancer la préparation puis redémarrer `logibtp-base` ; Windows (plan securite-base-suites, lot 2) : `MettreAJour-LogiBTP.ps1` rejoue `installation preparer --code-certificat` avant les scripts SQL et redémarre la base seulement sur le code de sortie 10 (certificat de la base créé ou renouvelé ; une base sur un autre serveur : message), la tâche « LogiBTP - certificat » lance `Renouveler-Certificats-LogiBTP.ps1` (certificat HTTPS puis `certificat base-renouveler`, base redémarrée si changé) ; fonctions `Invoquer-InstallationCode`, `Redemarrer-Base`, `Renouveler-CertificatBase` de `Commun.ps1` ; Linux (lot 3) : `mettre-a-jour-logibtp.sh` rejoue la préparation (`--code-certificat`) avec retour arrière en cas d'échec, la minuterie `logibtp-certificat` lance `renouveler-certificats-logibtp.sh` (HTTPS puis `certificat base-renouveler`), fonctions `installation_code`, `redemarrer_base`, `renouveler_certificat_base` de `commun.sh` ; une installation existante relance l'installeur une fois pour recréer la minuterie.
- Versionnement du schéma, lot 0 ([plan](../conception/plans/versionnement-schema.md)) : `BaseDonnees.AppliquerAsync` parcourt le manifeste dans son ordre (non rejouable absent du journal : appliqué à sa place ; rejouable : rejoué à sa place ; un chemin présent deux fois — 019n, 176 — est appliqué à la première occurrence puis rejoué à la seconde), même ordre que `initialiser-developpement.sh`. Marquage `rejouable` établi empiriquement par `scripts/reperer-rejouables.sh` (rejeu double sur base neuve, `pg_dump` avant / après) puis revue : seuls les scripts de pur DDL, et les générés 121, 131, 191 ; un script qui écrit des données modifiables par la société (INSERT, UPDATE, DELETE) ne l'est pas ; un rejouable dont le rejeu à sa place échoue sur base complète (vue étendue ensuite : 267, 287) ne l'est pas. Tests d'intégration `ScriptsBaseTests` (`LOGIBTP_TEST_PG_ADMIN`) : base neuve par `AppliquerAsync` = base neuve par l'ordre du manifeste, seconde et troisième applications sans changement, `adopter` sans exécution.
- Versionnement du schéma, lot 1 ([plan](../conception/plans/versionnement-schema.md)) : `InstantaneSchema` (catalogue du schéma public en JSON stable : tables, colonnes, contraintes, index, vues, fonctions par empreinte de source, déclencheurs ; sans `installation_*` ni objets d'extension), tables du moteur créées par `JournalSchema.AssurerTablesAsync` (`installation_schema` : un instantané par application réussie ; `installation_prefixe` ; `installation_forcage`). `DeriveSchema.Comparer` : `ajoute` sans conflit, `modifie` / `supprime` en conflit, `dependance` (vue ou clé étrangère d'un objet préfixé vers un objet LogiBTP, `pg_depend`) en conflit ; objets dont un nom commence par `x_` ou par un préfixe déclaré ignorés ; une table ajoutée ou supprimée est rapportée seule. `installation base mettre-a-jour [--forcer --motif \"…\"]` contrôle toutes les bases avant d'en toucher une (rapport attendu / réel / effet ; arrêt code 2 sans `--forcer`, sinon inscription dans `installation_forcage` : utilisateur système, date, base, écarts JSON, motif) ; base sans instantané : instantané pris après la mise à jour, sans contrôle préalable. `base comparer --base A --reference B`, `base adopter (--base N | --toutes)` vérifié par une base de référence temporaire `<base>_ref_<horodatage>` construite par le manifeste puis supprimée (`--confirmer-sans-controle` : ancien comportement), `prefixe ajouter P --integrateur N` (refus d'un préfixe pris, trop court, ne finissant pas par `_`, ou qui recouvre un nom de table ou de colonne LogiBTP). Tests : `DeriveSchemaTests` (unitaires sur instantanés à la main ; intégration `LOGIBTP_TEST_PG_ADMIN`).
- Versionnement du schéma, lot 3 : versions par module. `VersionModule` (majeur, mineur ; comparaison numérique, `1.9` avant `1.10` ; `Analyser` refuse tout sauf `majeur.mineur`) ; `VersionsModules` : module d'un script déduit du chemin (`modules/<m>/db/…` → `m`, `db/…` → `coeur`), version (tous les scripts actuels = `1.0` ; un fichier `<majeur>.<mineur>_<nom>.sql` porte sa version : prévu pour le lot 4), colonnes ajoutées à `installation_script` par `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (`isc_module`, `isc_version`, `isc_type` : socle / mineure / rejouable / zone, `isc_origine` défaut `logibtp`, `isc_duree_ms`, `isc_version_produit`), vue `v_version_module` (`vmo_module`, `vmo_version` = plus haute version appliquée, `vmo_applique_le`) en `CREATE OR REPLACE`, le tout créé par le code au début de `AppliquerAsync` (aucun script du manifeste) ; lignes d'avant le lot complétées sans réappliquer aucun script ; la vue est exclue de l'instantané (comme `installation_*`). Les rejouables ne sont toujours pas inscrits (lot 4). Version produit : `db/installation/version.txt` (ex. `2026.11`), lue par l'installeur et inscrite à chaque ligne écrite. `VersionsModulesAsync(connexion)` ; `installation etat` affiche la version produit et, par base, les versions des modules ; `GET /api/installation/etat` ajoute `Versions` et `VersionProduitBase` à chaque `EtatBase` (écran au lot 6). Tests : `VersionsModulesTests` (unitaires ; intégration `LOGIBTP_TEST_PG_ADMIN` : ancien journal à 3 colonnes reconnu en 1.0 sans script appliqué, lignes et instantané inchangés).
- Versionnement du schéma, lot 4 (guide d'écriture : [MIGRATIONS.md](../MIGRATIONS.md)) : `PlanScripts` calcule le plan depuis `db/installation/socle-1.0.txt` (copie figée du manifeste d'avant le lot, tous indicateurs ; repère `# ---- rejouables de fin du socle` avant 019n et 176) puis les mineures découvertes (`modules/<m>/db/<majeur>.<mineur>_<nom>.sql`, `db/…` pour le cœur) en tri topologique (ordre numérique dans un module, `-- requiert: module M.m` entre modules, à égalité module puis version en ordre binaire ; deux mineures de même version, requiert inconnu, cycle, version 1.0 : `PlanInvalideException`). `ManifesteScripts.Generer` écrit `db/installation/scripts.txt` (en-tête « FICHIER GÉNÉRÉ ») : commande `installation manifeste generer`, `npm run manifeste` ; sans mineure il reproduit l'ancien manifeste (même ordre, même chemins). Les rejouables de fin passent après les mineures (choix : leurs vues et reprises supposent les mineures appliquées). `AppliquerAsync` : verrou `pg_advisory_lock(CleVerrou)` pour toute l'application ; empreinte modifiée d'un script inscrit = `EmpreinteModifieeException` avant toute application (liste), sauf empreinte acceptée ou `--forcer --motif` (inscrit à `installation_forcage`) ; rejouables inscrits (`isc_type = rejouable`) avec leur empreinte, rejoués si empreinte changée, non inscrits, ou mineure de leur module / d'un module requis (le cœur : tous) appliquée dans l'exécution (ceux placés avant la mineure sont rejoués après elle) ; `-- hors-transaction` exécuté sans transaction et signalé. Tests : `MineuresTests` (plan, graphe, générateur ; intégration `LOGIBTP_TEST_PG_ADMIN` : deux mineures de deux modules dont l'une requiert l'autre, base montée = base neuve, rejouable non rejoué sans changement puis rejoué après modification, base d'avant le lot, empreinte refusée puis forçage, deux applications simultanées sérialisées).
- Versionnement du schéma, lot 5 : `IMigrationCode` (`MigrationCode.cs` : module, version, nom, `ExecuterAsync(cnx, tx, ct)`, `EmpreinteDeclaree` facultative) et `MigrationsCode` (chemin `code:<module>/<version>_<nom>`, empreinte, vérification) ; `PlanScripts.Calculer(racine, migrations)` les place comme des mineures (un fichier SQL de même module et version : plan invalide), `ManifesteScripts.AvecMigrations`, `AppliquerAsync(…, migrations:)` les joue à leur place dans la transaction de la mineure et les inscrit (`isc_type = mineure`) ; exclues de `scripts.txt`, de la détection d'empreinte modifiée et de `Ecarts` ; le cœur déclare la liste dans `MigrationsCoeur` (vide). La conversion des métrés est retirée de `installation conversions` (commande supprimée) et de `mettre-a-jour` ; code archivé dans `documentation/archive/conversion-metres/`. Tests : `MineuresTests` (migration fictive).
- Lot 4 : mise à jour (`installation base mettre-a-jour` : scripts du manifeste absents du journal sur toutes les
  bases, rejouables, droits, conversions ; `base adopter --base N|--toutes` pour une base créée hors de
  l'installeur ; `MettreAJour-LogiBTP.ps1` : image (empreinte SHA-256 d'un fichier vérifiée), sauvegarde, scripts, API ;
  en échec : image précédente et sauvegarde restaurées), Let's Encrypt par défi DNS (`Certificat-LetsEncrypt.ps1` : image
  `goacme/lego` épinglée, volume `logibtp-letsencrypt`, identifiants du fournisseur dans `<Dossier>\letsencrypt.env`,
  import d'origine LETSENCRYPT, `-Renouveler` en tâche hebdomadaire ; installeur `-Certificat LetsEncrypt`), rotation de
  la clé des données (`installation cle-donnees changer | rechiffrer`, `RotationCle` : valeurs `chiffre:v1:` des
  colonnes texte et JSON, empreintes déclarées par le cœur — adresse des comptes de messagerie, compte OAuth —, une
  transaction par base ; ancienne clé gardée dans `LOGIBTP_CLE_CHIFFREMENT_PRECEDENTES`, lue par `Chiffrement` du socle
  et par le déchiffrement des sauvegardes ; clé de l'autorité rechiffrée ; `Changer-CleDonnees-LogiBTP.ps1`).

- Debian 13 : scripts bash `linux/` (même déroulé que `windows/`, fichiers par `docker cp`, `commun.sh` ; root, dossier
  `/opt/logibtp` en 700) : `installer-logibtp.sh` (mêmes rôles et options en `--kebab-case`, `--installer-docker` : dépôt
  officiel de Docker et journaux bornés ; autorité par `update-ca-certificates` ; minuteries systemd `logibtp-sauvegarde`
  et `logibtp-certificat` à la place des tâches planifiées ; pare-feu non géré : chaîne `DOCKER-USER` documentée),
  `sauvegarder-logibtp.sh`, `restaurer-logibtp.sh`, `mettre-a-jour-logibtp.sh`, `certificat-letsencrypt.sh`,
  `changer-cle-donnees-logibtp.sh` ; procédure : [INSTALLATION-DEBIAN.md](../../documentation/INSTALLATION-DEBIAN.md).

## Bibliothèque (`dotnet/LogiBTP.Installation`)
- `ManifesteScripts` (`Lire`, `Analyser`, `Ecarts`), `BaseDonnees` (`DefinirRolesAsync`,
  `CreerBaseAsync`, `AppliquerAsync(connexion, racine, scripts, adopter, acceptees)` → `BilanScripts`, `ADeLaDemoAsync`, `ScriptsAppliquesAsync`,
  `ExecuterFichierAsync`, `Empreinte`), `ConfigurationPostgres` (`PgHba`, `PostgresqlConf` depuis `ReglagesPostgres` :
  réseau Docker, adresses de l'API distante en `hostssl`, mémoire, fuseau), `SocietesInstallation` (`Preparer`,
  `Ajouter`, `VerifierCode`, `Societes`), `Secrets`, `AutoriteCertificats` (`CreerRacine`, `Emettre`, `ContrainteNoms`,
  `NomsPermis`, `NomsDns`, `Couvre`, `Empreinte`, `ChiffrerCle` / `DechiffrerCle`, `ProfilApple`, `ScriptPostes`),
  `DossierCertificats` (serveur.crt, serveur.key, racine.crt, racine.key chiffrée, certificat.json ; `Ecrire`,
  `LireFourni`, `Infos`), `OrigineCertificat` (LOGIBTP, IMPORTE, LETSENCRYPT), `ChiffrementSauvegarde` (`Chiffrer`,
  `Dechiffrer`, `ChiffrerDossier`, `DechiffrerDossier` par une ou plusieurs clés, extension `.chiffre`), `RotationCle`
  (`RechiffrerBaseAsync(connexion, lecture, ecriture, empreintes)`, `RechiffrerJson`, `EmpreinteDeclaree`). `LogiBTP.Installation.Web` :
  `AddHttpsInstallation`, `UseHttpsInstallation`, `MapAmorcage`, `MapModuleInstallation` (`EtatInstallation`).

## Démonstration et empreintes acceptées (plan versionnement-schema, lot 2)
- Manifeste `db/installation/scripts.txt` : indicateur `demo` (script de données de démonstration, combinable avec `rejouable`) ;
  indicateur `extrait-de=CHEMIN` (script extrait d'un script déjà publié, voir plus bas). `ManifesteScripts.Retenus(demo)` : scripts à
  appliquer à une base (sans `demo` : aucun script de démonstration). `initialiser-developpement.sh` et `scripts/demo/initialiser-base-demo.sh`
  appliquent tout, démonstration comprise (les indicateurs sont ignorés) : `logibtp`, `logibtp_demo`, e2e.
- Installeur : `base creer [--demo]` et `societe ajouter CODE [--demo]` ; sans `--demo`, ni tiers, ni individu, ni chantier, ni salarié, ni
  matériel, ni article de bibliothèque fictif (restent : référentiels — niveaux, casquettes, natures et leurs comptes —, chantiers internes
  `INT-*`, affaires de gestion `G`, services, modèles de parcours, calendriers). `base mettre-a-jour` applique les scripts `demo` seulement aux bases
  qui en ont déjà reçu un (`BaseDonnees.ADeLaDemoAsync` : un chemin `demo` au journal) ; `base adopter` construit sa base de
  référence avec ou sans démonstration selon le même repérage, ou `--demo` pour une base sans journal ; `etat` indique « avec / sans démonstration ».
- Scripts de démonstration : `116` (bibliothèques, familles, articles, tarifs), `120b` (80 salariés, 50 matériels, 12 équipes, 40 sous-traitants de la
  table `demo_sous_traitant`), `141` (personnes, individus, coordonnées), `142` (individus des salariés), `161` (affaires, projets, chantiers, marchés),
  `163` (intervenants), `196b` (fermeture estivale de l'atelier), `210b` (reprise des sous-traitants de démonstration dans l'annuaire, avant 211),
  `235b` (plans d'entretien d'exemple). Référentiels extraits, hors démonstration : `115b` (natures, regroupements, coefficients de période), `140b`
  (niveaux, casquettes, types de lien, rôles). Les fichiers générés (115b, 116, 140b, 141) le sont par `client/scripts/generer-vues-liste.mjs`.
- Empreintes acceptées : `db/installation/empreintes-acceptees.txt` (`EmpreintesAcceptees`, lignes `chemin empreinte-sha256  # raison`, ancienne
  empreinte = `git show <commit>:<chemin>` aux fins de ligne normalisées). Un script publié (116, 120, 141, 196, 211, 235) réduit par une extraction
  n'est pas signalé « modifié » sur une base dont le journal porte son ancienne empreinte : le journal reçoit la nouvelle empreinte et les scripts
  extraits (`extrait-de=`) y sont inscrits **sans exécution**, dans une même transaction (`BilanScripts.Acceptes`). Tout nouveau script réduit
  de la même façon ajoute sa ligne ; le test `DemonstrationTests` vérifie que chaque extraction a la sienne.

## Commandes (image de l'API)
`docker compose -f docker/api/compose.yml run --rm logibtp-installation installation …` :
`preparer --domaine D [--deploiement] [--confiance] [--reseau] [--memoire] [--libelle] [--base-hote]`,
`base creer [--demo]`, `societe ajouter CODE [--libelle] [--demo]`, `societes`, `scripts verifier`, `conversions`, `etat`,
`certificat creer [--organisation] [--jours] [--nouvelle-racine] | renouveler [--avant 60] | importer --certificat F [--cle K]
[--origine IMPORTE|LETSENCRYPT] | etat | base --nom N --adresses-api A` (mot de passe d'un PKCS#12 :
`LOGIBTP_CERTIFICAT_MOT_DE_PASSE`), `base droits`, `sauvegarde chiffrer|dechiffrer DOSSIER`, `base mettre-a-jour`,
`base adopter (--base N | --toutes) [--confirmer-sans-controle] [--demo]`, `base comparer`, `prefixe ajouter`, `cle-donnees changer | rechiffrer`.
Windows (suite) : `MettreAJour-LogiBTP.ps1 (-Image I | -FichierImage tar [-Empreinte sha256])`,
`Changer-CleDonnees-LogiBTP.ps1 [-Confirmer]`, `Certificat-LetsEncrypt.ps1 -Fournisseur ovh -FichierIdentifiants f
-Courriel c -AccepterConditions [-Essai] | -Renouveler`.
Windows : `Installer-LogiBTP.ps1 -Domaine D [-Confiance CIDR] [-Administrateur pseudo] [-Certificat LogiBTP|Importer|Aucun]
[-FichierImage tar] [-FichierEnv .env]…`, `Sauvegarder-LogiBTP.ps1 [-Chiffrer] [-Copie \\nas\x]`,
`Restaurer-LogiBTP.ps1 -Sauvegarde <jeu> [-AvecConfiguration] [-Confirmer]`.
Variables : `LOGIBTP_CONFIG` (/app/config), `LOGIBTP_CONFIG_BASE` (/app/base-config), `LOGIBTP_SQL` (/app/sql),
`LOGIBTP_CERTIFICATS` (/app/certificats), `LOGIBTP_PORT_HTTPS_PUBLIC` (port public de la redirection, 443).
Personnalisation de l'installation (module Personnalisation : `fr.json` partiel, `theme.css`, `images/`) : dossier
`personnalisation/` du volume de configuration (`/app/config/personnalisation`), ou `LOGIBTP_PERSONNALISATION` ; relue sans redémarrage.
