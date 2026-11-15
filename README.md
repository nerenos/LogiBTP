# LogiBTP

**La version 1.0.0 est sortie** (novembre 2026) : c'est la première version publiée de LogiBTP, et on peut dès maintenant
commencer à l'utiliser. Les fonctions de gestion sont en place et testées. Le travail continue, surtout sur l'interface
(voir [Travail restant](#travail-restant)).

- Notes de version : [VERSIONS.md](documentation/VERSIONS.md)
- Image Docker : `ghcr.io/nerenos/logibtp-api:1.0.0` (GitHub) ou `nerenos/logibtp:1.0.0` (Docker Hub)
- Démonstration en ligne : [https://logibtp.vercel.app/](https://logibtp.vercel.app/) (identifiant `visiteur`, mot de
  passe `visitlogibtp2026`, données de test remises à zéro régulièrement)
- Documentation développeur : [https://logibtp.vercel.app/documentation/](https://logibtp.vercel.app/documentation/)
- Captures : [thème clair](https://github.com/nerenos/LogiBTP/issues/9#issue-6232817397) /
  [thème sombre](https://github.com/nerenos/LogiBTP/issues/10#issue-6232840500)

## Présentation

LogiBTP est un logiciel de gestion d'entreprise (ERP) web et modulaire pour les entreprises du Bâtiment et des Travaux
Publics. Il couvre la vie d'un chantier, du devis à la facturation, la comptabilité et le suivi de la rentabilité. Les
postes fonctionnent dans un navigateur (Windows, Linux, Mac, Android, iOS), l'application Terrain aussi sans réseau ; le
serveur s'installe sous Windows ou Debian, dans Docker.

## Travail restant

Le gros du travail restant porte sur **l'interface utilisateur** : refonte visuelle, iconographie cohérente, affichage
adapté à toutes les tailles d'écran et trois modes d'usage (Technicien sur PC, Observateur pour les tableaux de bord,
Pointeur sur mobile et tablette). Le suivi est dans l'issue
[#18 « Évolution Interface utilisateur »](https://github.com/nerenos/LogiBTP/issues/18).

Vos retours sont précieux : anomalies, ergonomie ou fonctions manquantes, ouvrez une
[issue](https://github.com/nerenos/LogiBTP/issues).

## Fonctionnalités disponibles

### Commercial et études
- Devis, commandes, bons de livraison, situations de travaux et factures, avec numérotation, avoirs et éditions PDF
  personnalisables.
- Bibliothèque de prix : articles, ouvrages, familles, natures, coefficients par période, multi-unité, tarifs
  fournisseurs et historique des prix.
- Métrés par langage de script, révision et actualisation des prix, import de devis OptimBTP.
- Relances des devis et des factures.

### Achats, sous-traitance et stock
- Demandes de prix, commandes, réceptions et factures fournisseurs ; contrats et situations de sous-traitance.
- Stock multi-dépôts : mouvements, inventaires, prix moyen pondéré, dotations (EPI, outillage), ruptures prévues.
- SAV : équipements posés chez les clients, numéros de série et garanties.

### Chantier, planning et terrain
- Suivi de l'exécution par chantier : ordres, étapes et états des services.
- Planning des équipes et du matériel, calendriers de travail et jours fermés.
- Pointage des heures (salarié, chef d'équipe, borne d'atelier), validation et congés.
- Application Terrain (PWA) pour tablette et smartphone, utilisable hors ligne.

### Ressources
- Salariés, intérimaires, équipes, matériel et sous-traitants ; annuaire des tiers, avec recherche dans l'annuaire
  officiel des entreprises françaises (SIREN / SIRET).

### Suivi, documents et communication
- GED avec coffre-fort (documents scellés, journal chaîné, contrôle d'intégrité) et pièces jointes sur chaque fiche.
- CRM : fil d'actualité, notes, tâches, demandes, plans, visas et bordereaux.
- Courriel intégré (OAuth / IMAP, rattachement automatique) et centre de notifications.

### Gestion financière
- Règlements reçus et émis, échéances, cautions et retenues de garantie.
- Facturation électronique : réception, émission et e-reporting.
- Comptabilité : plan de comptes, ventilation, TVA (autoliquidation comprise), export vers Sage 100.
- Rentabilité des chantiers : budget, engagé, déboursé et facturé, mis à jour en continu.

### Administration
- Une base par société, comptes et authentification (double facteur), droits par profil et par écran, champs
  confidentiels journalisés.
- Listes et fiches paramétrables (vues, filtres, champs supplémentaires), textes, icônes et thèmes personnalisables.
- Module MCP : accès contrôlé pour les agents d'intelligence artificielle.
- Installeurs Windows et Debian, HTTPS, sauvegardes chiffrées, mises à jour du schéma par version.

Fonctionnement détaillé des écrans et structure du dépôt : [PRISE-EN-MAIN.md](documentation/PRISE-EN-MAIN.md).

## Installation

L'application tourne dans **deux conteneurs** : l'API (qui sert aussi le client web et contient l'installeur et les
scripts SQL) et PostgreSQL 17 (image officielle `postgres:17`, jamais dans l'image de l'API). Une installation neuve
crée la base principale avec les référentiels seuls, sans données de démonstration. Prérequis serveur, certificats,
sauvegardes et mises à jour : [INSTALLATION-DEBIAN.md](documentation/INSTALLATION-DEBIAN.md).

### Depuis Docker (image publiée)

Les scripts d'installation sont dans le dépôt, à la version voulue :

```bash
git clone --depth 1 --branch v1.0.0 https://github.com/nerenos/LogiBTP.git
```

Serveur Debian 13, en `root` :

```bash
cd LogiBTP/modules/installation/linux && chmod +x *.sh
./installer-logibtp.sh --installer-docker --domaine logibtp.entreprise.fr --confiance 192.168.1.0/24 \
  --image ghcr.io/nerenos/logibtp-api:1.0.0 --administrateur direction
```

Serveur Windows (Docker Desktop, Docker Engine sous WSL 2 ou machine virtuelle), PowerShell en administrateur :

```powershell
cd LogiBTP\modules\installation\windows
.\Installer-LogiBTP.ps1 -Domaine logibtp.entreprise.fr -Confiance 192.168.1.0/24 -Image ghcr.io/nerenos/logibtp-api:1.0.0 -Administrateur direction
```

L'image Docker Hub `nerenos/logibtp:1.0.0` est identique et peut remplacer celle de GitHub. Le script est rejouable,
affiche le mot de passe provisoire du premier administrateur et écrit un rapport (`/opt/logibtp/INSTALLATION.txt` sous
Debian). Mise à jour : `mettre-a-jour-logibtp.sh` / `MettreAJour-LogiBTP.ps1` avec l'image de la nouvelle version.

### Depuis GitHub (construire l'image)

Pour construire sa propre image depuis les sources, il faut Docker et un fichier `cle-construction.secret` (clé de
construction de la distribution, au moins 32 caractères alphanumériques, jamais versionnée) :

```bash
git clone --branch v1.0.0 https://github.com/nerenos/LogiBTP.git && cd LogiBTP
docker build --secret id=cle_construction,src=cle-construction.secret -t logibtp/api:1.0.0 .
```

Puis lancer l'installeur ci-dessus avec `--image logibtp/api:1.0.0` (`-Image` sous Windows), ou transporter l'image vers
un serveur sans accès Internet par `docker save` et l'option `--fichier-image`
([INSTALLATION-DEBIAN.md](documentation/INSTALLATION-DEBIAN.md) § 3). Publication d'une version :
[PUBLICATION.md](documentation/PUBLICATION.md).


### Poste de développement

```bash
docker compose up -d                                         # PostgreSQL de développement (port 5433)
dotnet run --project src/LogiBTP.Api --launch-profile http   # API
npm install && npm run dev                                   # client, http://localhost:5173
```

La société de démonstration est servie sur http://demo.localhost:5173. Sans API joignable, le client passe en démo hors
ligne (calcul local, sans enregistrement). `docker compose down -v` repart d'une base vide.

Tests : `npm test` et `dotnet test LogiBTP.slnx` ; parité des moteurs de calcul JS / C# :
`npm run exporter-resultats && dotnet test LogiBTP.slnx`.

## Architecture en bref

- Trois couches : `socle/` (sans métier) → `modules/<nom>/` (fonctions génériques, classes mères) → cœur BTP (`src/`,
  `client/`, `db/`). Liens entre modules : [MODULES.md](MODULES.md).
- Règles de calcul écrites deux fois, en C# (serveur) et en JavaScript (client), et testées à parité sur les mêmes jeux.
- PostgreSQL géré par scripts SQL versionnés par module ([MIGRATIONS.md](documentation/MIGRATIONS.md)).
- Client en JavaScript, HTML et CSS sans framework lourd ; aucun texte, icône ni couleur en dur (tout est
  personnalisable).
- Dépendances externes : [DEPENDANCES.md](documentation/DEPENDANCES.md).
