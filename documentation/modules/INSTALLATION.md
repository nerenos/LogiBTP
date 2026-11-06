# Module Installation – référence détaillée

Référence lue à la demande (hors contexte par défaut). Les règles que le code doit respecter sont dans [CLAUDE.md](../../modules/installation/CLAUDE.md) ; une règle modifiée l'est là, l'inventaire ici.

## État actuel
- Lot 1 : image (`Dockerfile` à la racine : client Vite → `wwwroot`, publication .NET avec la clé de construction en
  secret BuildKit, scripts SQL sous `/app/sql`, compte `app`, `TZ=Europe/Paris`), projets Compose `docker/base`
  (postgres:17 officiel, `config_file` du volume `logibtp-base-config`) et `docker/api` (service `logibtp-api`,
  service d'outils `logibtp-installation` au profil `outils`) ; client servi par l'API (`ClientWeb` du socle : CSP
  bloquante, alignée sur `client/vite.config.js` par test) ; sociétés dans `societes.json` (dossier `LOGIBTP_CONFIG`),
  connexions déduites du modèle (`ModeleConnexion` du socle : `LOGIBTP_BASE_HOTE`…, base `logibtp` ou
  `logibtp_<code>`, rôle `logibtp_app`) ; conversions de données hors du démarrage (développement excepté). Écart :
  les données de démonstration sont mêlées aux données de référence (211 dépend de 141) : toute base neuve les reçoit.

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

- Lot 11 des demandes du 25/10/2026 (A35, A36) : TLS de la base toujours actif — certificat de la base émis par `installation preparer` (`CertificatBaseLocal` du cœur : autorité LogiBTP, `base.<domaine>`, renouvelé à 60 jours), `pg_hba.conf` en `hostssl` + SCRAM seulement (`ReglagesPostgres.Ssl` obligatoire), API en `VerifyCA` par la racine (`VerifyFull` pour une base distante) ; `EtatBase.Chiffree` (`pg_stat_ssl`) ; installation existante : relancer la préparation puis redémarrer `logibtp-base`.
- Lot 4 : mise à jour (`installation base mettre-a-jour` : scripts du manifeste absents du journal sur toutes les
  bases, rejouables, droits, conversions ; `base adopter --base N|--toutes --confirmer` pour une base créée hors de
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
  `CreerBaseAsync`, `AppliquerAsync(connexion, racine, scripts, adopter)` → `BilanScripts`, `ScriptsAppliquesAsync`,
  `ExecuterFichierAsync`, `Empreinte`), `ConfigurationPostgres` (`PgHba`, `PostgresqlConf` depuis `ReglagesPostgres` :
  réseau Docker, adresses de l'API distante en `hostssl`, mémoire, fuseau), `SocietesInstallation` (`Preparer`,
  `Ajouter`, `VerifierCode`, `Societes`), `Secrets`, `AutoriteCertificats` (`CreerRacine`, `Emettre`, `ContrainteNoms`,
  `NomsPermis`, `NomsDns`, `Couvre`, `Empreinte`, `ChiffrerCle` / `DechiffrerCle`, `ProfilApple`, `ScriptPostes`),
  `DossierCertificats` (serveur.crt, serveur.key, racine.crt, racine.key chiffrée, certificat.json ; `Ecrire`,
  `LireFourni`, `Infos`), `OrigineCertificat` (LOGIBTP, IMPORTE, LETSENCRYPT), `ChiffrementSauvegarde` (`Chiffrer`,
  `Dechiffrer`, `ChiffrerDossier`, `DechiffrerDossier` par une ou plusieurs clés, extension `.chiffre`), `RotationCle`
  (`RechiffrerBaseAsync(connexion, lecture, ecriture, empreintes)`, `RechiffrerJson`, `EmpreinteDeclaree`). `LogiBTP.Installation.Web` :
  `AddHttpsInstallation`, `UseHttpsInstallation`, `MapAmorcage`, `MapModuleInstallation` (`EtatInstallation`).

## Commandes (image de l'API)
`docker compose -f docker/api/compose.yml run --rm logibtp-installation installation …` :
`preparer --domaine D [--deploiement] [--confiance] [--reseau] [--memoire] [--libelle] [--base-hote]`,
`base creer`, `societe ajouter CODE [--libelle]`, `societes`, `scripts verifier`, `conversions`, `etat`,
`certificat creer [--organisation] [--jours] [--nouvelle-racine] | renouveler [--avant 60] | importer --certificat F [--cle K]
[--origine IMPORTE|LETSENCRYPT] | etat | base --nom N --adresses-api A` (mot de passe d'un PKCS#12 :
`LOGIBTP_CERTIFICAT_MOT_DE_PASSE`), `base droits`, `sauvegarde chiffrer|dechiffrer DOSSIER`, `base mettre-a-jour`,
`base adopter (--base N | --toutes) --confirmer`, `cle-donnees changer | rechiffrer`.
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
