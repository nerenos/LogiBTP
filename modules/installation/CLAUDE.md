# Module Installation – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes) : [INSTALLATION.md](../../documentation/modules/INSTALLATION.md).

## But
Installer LogiBTP chez un client sur deux conteneurs Docker indépendants : l'API (qui sert aussi le client web) et
PostgreSQL ; hôte Windows ou Debian 13 en réseau local ([analyse](../../documentation/conception/ANALYSE-MODULE-INSTALLATION.md),
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

## Repères
- Réalisé (détail par lot dans le fichier de détail) : image et projets Compose (lot 1), HTTPS par Kestrel et autorité LogiBTP (lot 2), scripts Windows (lot 3), mise à jour, Let's Encrypt et rotation de la clé des données (lot 4), TLS de la base toujours actif (lot 11), scripts Debian 13 (`linux/`).
- PowerShell : appels de docker par `$args`, jamais de fonction à paramètres (`-v`, `-d`, `-u` seraient pris pour `-Verbose`, `-Debug`) ; fichiers en UTF-8 avec BOM ; aucun dossier Windows monté (passage par `docker cp`).
- Redirection HTTPS seulement vers le domaine `LOGIBTP_DOMAINE` et ses sous-domaines, jamais vers un autre hôte.
- Base : `pg_hba.conf` en `hostssl` + SCRAM seulement ; API en `VerifyCA` (`VerifyFull` pour une base distante).
- Commandes `installation …` de l'image de l'API et scripts Windows / Linux : liste dans le détail.
- Écart connu : les données de démonstration sont mêlées aux données de référence (211 dépend de 141).

## Tests
`dotnet test modules/installation/dotnet/LogiBTP.Installation.Tests` (manifeste ↔ dépôt, ordre, pg_hba, postgresql.conf,
sociétés, connexions du modèle, CSP ; autorité : contrainte de noms, chaîne validée et nom étranger refusé par
`X509Chain`, joker, chiffrement de la clé, profil Apple, script des postes, dossier, redirection ; chiffrement des
sauvegardes : tailles, autre clé, altération, troncature). Scripts PowerShell : essai de bout en bout sur Docker Desktop
(installation, rejeu, société, sauvegarde claire et chiffrée, restauration avec témoins ; mise à jour sans script,
avec un script, avec un script en échec et retour arrière ; rotation : valeurs et empreintes changées, doublon d'adresse
toujours détecté, comptes relus). Non essayés : Let's Encrypt réel (identifiants DNS), rôles Api / Base sur deux
machines.

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Secrets de l'installation dans `.env` (hors dépôt, modèle `.env.exemple`, lu par `AjouterFichierEnv`) : `LOGIBTP_CLE_CHIFFREMENT` chiffre les mots de passe des fiches (`Chiffrement` du socle) ; valeurs sensibles du `.env` chiffrées `env:v1:` par la clé de construction des binaires (`CleConstruction.targets`, `cle-construction.secret` jamais versionné ; commande `env initialiser | chiffrer | verifier`) ; réglages LOGIBTP_DEPLOIEMENT, LOGIBTP_ADRESSES_CONFIANCE, LOGIBTP_PROXYS, LOGIBTP_CORS_ORIGINES, LOGIBTP_JOURNAL_NIVEAU (module Droits, lot 4 : sécurité web du socle `UseSecurite`, journal technique masqué `JournalTechnique`, purge `PurgeJournaux`, rôles PostgreSQL `db/installation/roles.sql`, CSP du client en rapport : aucun script en ligne dans `client/index.html`) ; lot 5 : HTML sans script (jeu `socle/tests/html_sans_script.json` rejoué par les nettoyeurs du serveur — Document, CRM, Mail —, champs `html` des fiches nettoyés par `SpecialisationFiche.NettoyerHtml`, corps des courriels affiché dans un cadre `sandbox` sans script).
- Module Installation, lot 11 des demandes du 25/10/2026 : TLS de la base toujours actif (certificat de l'autorité LogiBTP émis par `installation preparer`, `pg_hba.conf` en `hostssl` + SCRAM seulement, API en `VerifyCA`, `VerifyFull` pour une base distante ; chiffrement visible dans `/parametres/installation`).
- Module Installation (`modules/installation/CLAUDE.md`, [analyse](documentation/conception/ANALYSE-MODULE-INSTALLATION.md)), lot 1 : image Docker de l'API (`Dockerfile` : client servi par l'API, clé de construction en secret BuildKit) et conteneur PostgreSQL officiel indépendant (projets Compose `modules/installation/docker/base|api`, volumes et réseau externes), ordre des scripts SQL dans le **manifeste** `db/installation/scripts.txt` (source unique : base de développement et installeur ; tout nouveau script s'y ajoute), commandes `installation preparer | base creer | societe ajouter | conversions | etat` (scripts sous `logibtp_schema`, API sous `logibtp_app`), sociétés dans `societes.json`, connexions déduites de `LOGIBTP_BASE_*` du `.env`. Lot 2 : HTTPS par Kestrel avec le certificat du volume `logibtp-certificats` (rechargé à chaud ; HTTP 8080 = redirection 308 et page d'amorçage `/certificat`), autorité LogiBTP à contrainte de noms (`installation certificat creer | renouveler | importer | etat`), rappel d'échéance `SourceCertificat`. Lot 3 : scripts Windows `modules/installation/windows` (`Installer-LogiBTP.ps1` rejouable — rôles Complet, Api, Base —, `Sauvegarder-LogiBTP.ps1` 7 / 4 / 12 chiffrable, `Restaurer-LogiBTP.ps1`), base sur une autre machine en TLS, page `/parametres/installation` (`GET /api/installation/etat`, nœud `administration/installation`). Lot 4 : mise à jour par le journal `installation_script` (`installation base mettre-a-jour`, `MettreAJour-LogiBTP.ps1` avec retour arrière), Let's Encrypt par défi DNS (`Certificat-LetsEncrypt.ps1`, client `lego`), rotation de la clé des données (`installation cle-donnees changer`, clés précédentes `LOGIBTP_CLE_CHIFFREMENT_PRECEDENTES` lues par `Chiffrement`). Serveur Debian 13 : scripts bash `modules/installation/linux` (mêmes étapes, minuteries systemd), procédure [INSTALLATION-DEBIAN.md](documentation/INSTALLATION-DEBIAN.md).
