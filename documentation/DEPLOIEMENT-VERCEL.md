# Démonstration sur Vercel

Vitrine et environnement d'essai pour des utilisateurs non développeurs : l'application complète (client et API, une
seule image) et la documentation VitePress, sur une seule adresse Vercel, avec une base PostgreSQL hébergée à part
(Neon) qui reçoit les données de démonstration.

Ce n'est pas une installation de production : pour un client, l'installation reste celle du module Installation
(`Dockerfile`, `docker-compose`, [INSTALLATION-DEBIAN.md](INSTALLATION-DEBIAN.md)).

## Architecture

```
https://<projet>.vercel.app
├── /documentation/…  → service « documentation » : site statique VitePress (docs/)
└── /…, /api/…        → service « application » : image Dockerfile.vercel (API ASP.NET Core qui sert le client Vite)
                          └── PostgreSQL Neon (Francfort), base logibtp_demo
```

- `vercel.json` déclare les deux **services** (fonction bêta de Vercel) et les règles d'aiguillage ; région des
  fonctions `fra1` (Francfort), au plus près de la base.
- `Dockerfile.vercel` est lancé par le **Container Runtime** de Vercel (bêta, tous les forfaits) : une fonction qui
  démarre à la première requête et s'arrête après 5 minutes sans trafic.
- La base n'est pas sur Vercel : Neon, par la place de marché de Vercel (Storage → Neon) ou directement sur neon.tech,
  région AWS Europe (Francfort).

Le client et l'API restent sur la même origine : ni CORS, ni cookie tiers ; la session (`SameSite=Strict`) fonctionne
comme en installation normale.

## Ce qui diffère d'une installation

| Sujet | Sur la démonstration | Conséquence |
|---|---|---|
| Démarrage | à froid après 5 min sans visite | première page en quelques secondes |
| Disque | `/tmp` de l'instance, perdu à son arrêt | documents déposés dans la GED et sauvegardes non conservés |
| Tâches de fond (notifications, recalcul de nuit, archivage GED) | seulement quand une instance tourne | rappels et recalculs de nuit irréguliers |
| Temps réel (flux `/api/diffusion`) | par instance, coupé à la durée maximale d'une fonction | le navigateur se reconnecte seul ; pas de diffusion entre deux instances |
| Taille d'une requête | limite des fonctions Vercel (4,5 Mo) | gros dépôts dans la GED refusés |
| HTTPS | terminé par Vercel, HTTP dans le conteneur | aucun certificat à gérer |
| Configuration | variables du projet Vercel, pas de `.env` | la clé de construction n'est pas fixée (aucun `.env` chiffré à lire) |
| Courriels | aucun compte de messagerie configuré | aucun envoi |

Forfait : le forfait gratuit Hobby de Vercel est réservé à un usage personnel non commercial ; une vitrine montrée à des
prospects relève du forfait Pro.

## Mise en place

### 1. Base Neon

1. Créer un projet Neon (région Europe, Francfort) et une base vide `logibtp_demo`.
2. Noter l'adresse de connexion **directe** (pas celle du « pooler ») au format URI, pour l'étape 2, et la recopier au
   format Npgsql pour l'étape 4 :
   `Host=ep-….eu-central-1.aws.neon.tech;Database=logibtp_demo;Username=…;Password=…;SSL Mode=VerifyFull;GSS Encryption Mode=Disable`
3. Initialiser la base (scripts du manifeste, démonstration comprise ; base vide exigée), depuis la racine du dépôt :

   ```powershell
   docker run --rm -v "${PWD}:/logibtp:ro" -w /logibtp postgres:17 bash scripts/demo/initialiser-base-demo.sh "postgresql://…@ep-….neon.tech/logibtp_demo?sslmode=require"
   ```

   (ou `scripts/demo/initialiser-base-demo.sh "postgresql://…"` là où `psql` est installé).
4. Après la création du compte des visiteurs (§ 2), créer une branche Neon enfant `visiteurs` de la branche
   initialisée : c'est elle que la démonstration utilise (son hôte `ep-…` dans la chaîne du § 3), la branche
   principale restant l'état de référence (§ 4).

### 2. Compte des visiteurs

La démonstration n'a aucun compte de connexion. En créer un, administrateur, par la commande de secours de l'API
(même image que la démonstration, construite en local) :

```powershell
docker build -f Dockerfile.vercel -t logibtp/demo .
docker run --rm --entrypoint dotnet -e "ConnectionStrings__LogiBTP=Host=…;Database=logibtp_demo;…" -e LOGIBTP_CLE_CHIFFREMENT=<clé choisie au § 3> logibtp/demo LogiBTP.Api.dll comptes creer-admin visiteur --libelle "Visiteur de la démonstration"
```

La commande affiche un mot de passe provisoire, à changer à la première connexion : se connecter une fois, choisir le
mot de passe communiqué aux visiteurs, puis créer au besoin d'autres comptes (profils limités) depuis l'application.
Le pseudo `demo` est réservé.

### 3. Projet Vercel

1. Vercel → Add New → Project → importer le dépôt GitHub `nerenos/LogiBTP` ; garder la racine du dépôt (le
   `vercel.json` y est lu) ; branche de production : `main` (ou une branche dédiée `demo`).
2. Variables d'environnement (Settings → Environment Variables, environnement Production) :

| Variable | Valeur |
|---|---|
| `PORT` | `8080` (port d'écoute du conteneur ; le 80 par défaut est interdit au compte non root de l'image) |
| `ConnectionStrings__LogiBTP` | chaîne Npgsql de la branche `visiteurs` (§ 1 ; sans sous-domaine, toute requête va sur la base principale : ici la base de démonstration) |
| `LOGIBTP_CLE_CHIFFREMENT` | chaîne aléatoire, par exemple `openssl rand -base64 48` ; la même pour toujours (valeurs chiffrées en base, jetons de session) |
| `LOGIBTP_PROXYS` | `0.0.0.0/0,::/0` : le conteneur n'est joint que par Vercel, dont on croit les en-têtes `X-Forwarded-*` (hôte, HTTPS, adresse du visiteur) |
| `LOGIBTP_CORS_ORIGINES` | `https://<projet>.vercel.app` (et le domaine personnalisé s'il y en a un) |
| `Societes__LibellePrincipale` | `LogiBTP – démonstration` (nom affiché de la société) |

`LOGIBTP_DEPLOIEMENT=INTERNET` (HSTS) est déjà posé par l'image.

3. Déployer. Vérifier : `https://<projet>.vercel.app/api/sante` répond `{"statut":"ok",…}`, `/` affiche la page de
   connexion, `/documentation/` la documentation.

### 4. Remettre les données à zéro

Les visiteurs modifient les données. Pour revenir à l'état initial : Neon → Branches → `visiteurs` → Reset from
parent, sans toucher au projet Vercel (l'hôte de la branche ne change pas). Tout ce qui a été fait sur la démonstration
est perdu, comptes compris : un compte à garder se crée sur la branche principale.

## Essai local de l'image

```powershell
docker build -f Dockerfile.vercel -t logibtp/demo .
docker run --rm -p 8080:8080 -e PORT=8080 -e "ConnectionStrings__LogiBTP=Host=host.docker.internal;Port=5433;Database=logibtp_demo;Username=logibtp;Password=logibtp" -e LOGIBTP_CLE_CHIFFREMENT=essai logibtp/demo
```

puis http://localhost:8080 (base `logibtp_demo` du `docker-compose` de développement). L'image tourne aussi avec un
système de fichiers en lecture seule hors de `/tmp` (`--read-only --tmpfs /tmp`), comme sur Vercel.

## Si le Container Runtime ne convient pas

La même image `Dockerfile.vercel` tourne telle quelle sur un hébergeur de conteneurs toujours actif (Render, Fly.io,
Scaleway Serverless Containers à Paris…), avec les mêmes variables ; Vercel ne garde alors que la documentation
(projet séparé, racine `docs/`, préréglage VitePress, sortie `.vitepress/dist`). Les démarrages à froid et la perte des
dépôts de la GED disparaissent avec un disque persistant chez l'hébergeur.
