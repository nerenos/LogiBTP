# Publier une version de LogiBTP

Une version publiée = un tag git `v<majeur>.<mineur>.<correctif>` et l'image de l'API (client web compris), poussée
sur deux registres : `ghcr.io/nerenos/logibtp-api:<version>` (GitHub) et `docker.io/nerenos/logibtp:<version>`
(Docker Hub, dépôt existant). PostgreSQL reste l'image officielle `postgres:17`
(projet Compose `modules/installation/docker/base`), jamais dans l'image de l'API.

## Numéros
- Version produit sémantique : `db/installation/version.txt` = `version` de `package.json` (et de `client/package.json`) =
  tag sans le `v`. Le workflow refuse un tag qui ne correspond pas. Elle est inscrite au journal des scripts de chaque
  base (`isc_version_produit`) et affichée par `installation etat`.
- Majeure du produit (1.0.0 → 2.0.0) : changement incompatible pour les installations (procédure de mise à jour,
  configuration, base trop ancienne). Mineure : fonctionnalités. Correctif : corrections seules.
- Sans lien automatique avec les versions de schéma des modules ([MIGRATIONS.md](MIGRATIONS.md)) : la 1.0.0 du produit
  porte le socle 1.0 de tous les modules et la mineure `fiche 1.1`. Passer un module en majeure de schéma
  (`installation module majeure`) reste une décision à part, module par module.

## Une fois pour toutes
- Secret du dépôt **`LOGIBTP_CLE_CONSTRUCTION`** (Settings → Secrets and variables → Actions) : la clé de construction
  de la distribution (caractères alphanumériques, au moins 32), la même pour toutes les versions d'une distribution,
  sinon les `.env` chiffrés des installations existantes ne se lisent plus. La clé est compilée dans les binaires :
  quiconque obtient l'image peut la retrouver. Image privée : la clé des installations peut servir. Image publique :
  clé propre à la distribution publique, jamais celle de ses propres installations.
- Secrets **`DOCKERHUB_UTILISATEUR`** (compte Docker Hub) et **`DOCKERHUB_JETON`** (Docker Hub → Account settings →
  Personal access tokens, droits Read & Write) ; variable facultative `DOCKERHUB_IMAGE` (onglet Variables, défaut
  `<compte>/logibtp` : le dépôt Docker Hub `nerenos/logibtp` existant, public).
- Dépôt Docker Hub public : la clé de construction de l'image y est lisible par tous ; `LOGIBTP_CLE_CONSTRUCTION` doit
  donc être une clé propre à la distribution publique, jamais celle de ses propres installations (ou rendre le dépôt
  privé : un dépôt privé gratuit par compte). L'ancienne étiquette `1.1` (05/11/2026, avant la numérotation produit)
  est antérieure à la 1.0.0 : à supprimer sur Docker Hub pour éviter la confusion.
- Après la première publication sur GHCR : page du paquet `logibtp-api` (onglet Packages du compte) → Package settings →
  visibilité (privée par défaut) et accès (comptes autorisés à tirer l'image).

## Publier
1. Sur `main` à jour : version dans `db/installation/version.txt`, `package.json`, `client/package.json` et
   `package-lock.json` ; notes dans [VERSIONS.md](VERSIONS.md).
2. Contrôles : `npm test`, `dotnet test LogiBTP.slnx`, `npm run publier:verifier -- --base <base de développement>`
   (`--depuis <dépôt de la version précédente>` dès la 2e version).
3. Tag et poussée : `git tag -a v1.0.0 -m "LogiBTP 1.0.0"` puis `git push origin v1.0.0`. Le workflow
   `.github/workflows/publier-image.yml` construit l'image une fois et pousse sur les deux registres `:<version>`, `:<majeur>.<mineur>`, `:<majeur>` et `:latest`.
   Relance manuelle possible (Actions → Publier l'image → Run workflow, tag existant).
4. Facultatif : release GitHub du tag avec les notes de version.

Un tag publié ne se déplace pas : une correction = nouvelle version (1.0.1).

## Installer depuis le registre
- Image privée : `docker login ghcr.io -u <compte>` avec un jeton GitHub (`read:packages`), ou `docker login -u <compte>`
  avec un jeton Docker Hub en lecture, sur le serveur.
- Debian : `installer-logibtp.sh … --image ghcr.io/nerenos/logibtp-api:1.0.0` (tire l'image si absente) ;
  Windows : `Installer-LogiBTP.ps1 … -Image ghcr.io/nerenos/logibtp-api:1.0.0`. Mise à jour : `--image` / `-Image` de la
  nouvelle version. Serveur sans accès au registre : `docker save` de l'image puis `--fichier-image`
  ([INSTALLATION-DEBIAN.md](INSTALLATION-DEBIAN.md) § 3).
