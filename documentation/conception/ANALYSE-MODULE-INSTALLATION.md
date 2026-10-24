# LogiBTP – analyse du module Installation

> Analyse préalable (24/10/2026). Cible retenue par la demande : **un conteneur Docker pour l'API** (qui sert aussi le
> client) et **un second conteneur indépendant pour la base**, sur un **serveur Windows en réseau local**, avec un
> **certificat SSL** intégré. Suite de l'analyse des droits ([ANALYSE-MODULE-DROITS.md](ANALYSE-MODULE-DROITS.md),
> § 3.5 rôles PostgreSQL, § 3.6 clés, § 10 déploiement) et de la tâche « Module d'installation » de [TODO.md](../../TODO.md).
> Modules qui l'attendent : Droits (rôles, `pg_hba.conf`, certificat, § 10.6), OAuth (adresse de retour publique en
> HTTPS), Pointage et Stock (borne sur tablette : contexte sécurisé), gestion des versions de la base (mise à jour).
>
> **État** : questions I1 à I14 tranchées le 24/10/2026 (§ 9) : toutes les propositions retenues.
>
> **Réalisation** : lot 1 réalisé le 24/10/2026 (`Dockerfile`, `modules/installation` : `LogiBTP.Installation`,
> projets Compose `docker/base` et `docker/api` ; manifeste `db/installation/scripts.txt` ; `roles.sql` sans méta-commande
> psql ; cœur `CommandeInstallation` ; socle `ClientWeb`, `ModeleConnexion`, `AjouterConnexionsModele`) ; écarts : les
> données de démonstration ne sont pas séparables (211 insère des tiers qui dépendent des niveaux de 141) : toute base
> neuve les reçoit, I11 attend leur séparation (TODO) ; l'ordre du manifeste est l'ordre binaire des noms (le Compose de
> développement suivait celui de la locale : 007b avant 007) ; `db/164_ged_elements.sql`, absent du Compose, est au
> manifeste ; les volumes de configuration sont des volumes Docker (et non des dossiers Windows montés), pour que la
> même procédure vaille avec Docker Desktop, WSL ou une machine virtuelle ; Npgsql sans chiffrement GSS. Lot 2 réalisé le
> 25/10/2026 (`LogiBTP.Installation.Web` : `AddHttpsInstallation`, `UseHttpsInstallation`, `MapAmorcage` ;
> `AutoriteCertificats`, `DossierCertificats` ; commandes `installation certificat creer | renouveler | importer | etat` ;
> `SourceCertificat`) ; écarts : le certificat est rechargé à chaud par Kestrel (relecture du fichier au plus toutes les
> 30 s), sans redémarrage ; la page d'amorçage ne vérifie pas le DNS du poste (aucun script) : elle liste les adresses de
> chaque société ; le mot de passe d'un PKCS#12 importé passe par une variable d'environnement, jamais par la ligne de
> commande ; la clé de la racine est un PKCS#8 chiffré (AES-256, 600 000 itérations) par la clé des données. Lot 3
> réalisé le 25/10/2026 (`modules/installation/windows` : `Installer-LogiBTP.ps1`, `Sauvegarder-LogiBTP.ps1`,
> `Restaurer-LogiBTP.ps1`, `Commun.ps1` ; `installation certificat base`, `base droits` ; `EtatInstallation`, page
> `/parametres/installation`) ; écarts : le chiffrement des sauvegardes (prévu au lot 4) est fait dès ce lot ; la
> sauvegarde contient la configuration (.env, autorité) : chiffrée avec `-Chiffrer`, elle se restaure par la clé du
> `.env` en place (nouveau serveur : installer d'abord avec `-FichierEnv`) ; la restauration rejoue le SQL de
> pg_restore avec `search_path = public` (fonctions appelées sans schéma dans des expressions indexées : TODO) ; base
> distante : le serveur de la base reçoit sa configuration par un dossier exporté (`base-distante`), et sur Docker
> Desktop l'adresse source vue par PostgreSQL est la passerelle : la restriction tient alors au pare-feu ; la
> vérification du coffre de la GED après restauration (`installation verifier`) n'est pas faite ; rôles Api et Base non
> essayés sur deux machines (rôle Complet essayé de bout en bout).

## 1. Demande

- Installer LogiBTP chez un client sur **deux conteneurs** : l'API (et le client web) d'un côté, PostgreSQL de l'autre,
  chacun avec son cycle de vie (arrêt, mise à jour, sauvegarde, déplacement sur une autre machine).
- Usage principal : **Windows en réseau local** (postes du réseau, serveur TSE pour les distants, tablettes de la borne).
- **HTTPS** sur le réseau local, avec un certificat reconnu par les postes sans alerte du navigateur.
- Enchaîner ce que la TODO laisse en attente : `env initialiser`, création des bases et des rôles, `pg_hba.conf`,
  certificat joker et DNS, premier administrateur, rotation de la clé des données.

## 2. Ce qui existe déjà

| Élément | État | Limite pour une installation |
|---|---|---|
| `docker-compose.yml` | Base de **développement** : `postgres:17`, port 5433, compte `logibtp/logibtp`, 140 scripts montés un à un dans `docker-entrypoint-initdb.d`, `900_societe_demo.sh` | Ne s'applique qu'à la création du volume ; ordre des scripts tenu **seulement** dans ce fichier ; compte superutilisateur unique ; aucune API |
| `CommandeEnv` (`env initialiser [LOCAL\|INTERNET] \| chiffrer \| verifier`) | Fait : clé des données générée, `.env` chiffré par la clé de construction, `.env` fourni conservé | La chaîne de connexion est à compléter à la main |
| `CleConstruction.targets` | Clé du `.env` injectée à la compilation (`LOGIBTP_CLE_CONSTRUCTION` ou `cle-construction.secret`) | À passer à la construction de l'image **sans** la laisser dans ses couches |
| `db/installation/roles.sql` | Rôles `logibtp_schema` / `logibtp_app` / `logibtp_lecture`, rejouable | Lancé à la main ; `pg_hba.conf` seulement décrit |
| `CommandeComptes` (`comptes creer-admin\|reinitialiser\|deverrouiller\|liste`) | Fait | À enchaîner par l'installeur |
| Sécurité web (`UseSecurite`, `OptionsSecurite`) | Fait : `LOGIBTP_DEPLOIEMENT`, proxys, CORS, adresses de confiance, HSTS sur internet en HTTPS | **Kestrel n'écoute qu'en HTTP** ; aucune configuration de certificat |
| Sociétés (`OptionsSocietes`) | Une base par sous-domaine, connexions dans `appsettings.json` (`Societes:Liste`) | Mots de passe en clair dans `appsettings.json` ; chaque société répète sa chaîne de connexion entière |
| Client | Construit par Vite (`npm run build` → `client/dist`), CSP en mode rapport, aucun script en ligne | **L'API ne sert pas le client** (ni `UseStaticFiles` ni repli sur `index.html`) : en développement, Vite sert le client et relaie `/api` |
| Cookies de session | `Secure = http.Request.IsHttps` | En HTTP, cookies non `Secure` : jetons en clair sur le réseau |
| Conversions au démarrage (`ConversionMetresBases`) | Supprime `metre_ligne` | Exige le rôle de schéma : incompatible avec `logibtp_app` (écart du lot 4 des droits) |
| Tâches de fond | 16 services (archivage GED à 02:30, notifications, production des éditions, purge des journaux, relève IMAP…) | Heures locales : un conteneur est en UTC par défaut |
| GED | Fichiers sous `Ged:Repertoire` (`stockage-ged/<base>`) | À placer sur un volume persistant et sauvegardé |
| Éditions | Moteur JS dans Jint, polices livrées (`AppContext.BaseDirectory/polices`) | Aucune dépendance native : convient à une image Linux |

**Le client a besoin d'un contexte sécurisé.** Il utilise `crypto.randomUUID` (5 appels), `crypto.subtle.digest` (chaîne
du coffre de la GED), `navigator.clipboard` (copier-coller de lignes) : ces API n'existent pas sur une page servie en
HTTP depuis une autre adresse que `localhost`. Ouvert en `http://serveur/`, LogiBTP **ne fonctionne pas entièrement**.
Le HTTPS n'est donc pas une option de confort mais une condition de fonctionnement en réseau local.

## 3. Architecture cible

```
 Postes Windows, TSE, tablettes de la borne
        │  https://societe.logibtp.entreprise.fr  (443)
        │  http://… (80) → redirection, page d'amorçage du certificat
        ▼
 ┌──────────────── Serveur Windows (hôte Docker, § 4) ────────────────┐
 │  Projet « logibtp-api »                Projet « logibtp-base »      │
 │  ┌──────────────────────────┐         ┌──────────────────────────┐ │
 │  │ logibtp-api               │  5432   │ logibtp-base              │ │
 │  │ ASP.NET (Kestrel HTTPS)   │────────▶│ postgres:17 (image        │ │
 │  │ + client (wwwroot)        │ réseau  │ officielle), pg_hba et    │ │
 │  │ utilisateur non root      │ docker  │ postgresql.conf générés   │ │
 │  └──────────────────────────┘ logibtp └──────────────────────────┘ │
 │   volumes : config (.env, sociétés)     volume : données PostgreSQL │
 │             certificats (lecture)       dossier : sauvegardes       │
 │             stockage-ged, journaux                                  │
 └─────────────────────────────────────────────────────────────────────┘
```

### 3.1 Conteneur de l'API

- **Image construite en plusieurs étapes** : Node (installation des workspaces, `npm run build --workspace client`) →
  SDK .NET (`dotnet publish src/LogiBTP.Api -c Release`, clé de construction passée en **secret BuildKit**
  `--secret id=cle_construction`, jamais en `ARG` qui resterait dans l'historique de l'image) → image d'exécution
  `aspnet:10.0` avec le client copié dans `wwwroot`.
- **L'API sert le client** : `UseDefaultFiles`, `UseStaticFiles` (cache long des fichiers à empreinte de Vite, pas de
  cache pour `index.html`), repli `MapFallbackToFile("index.html")` hors de `/api`. La CSP passe en **mode bloquant**
  sur ces réponses (le § 10.4 des droits la confiait au proxy, absent ici). Deux conteneurs suffisent donc, sans proxy.
- **Kestrel termine le HTTPS** : port 8443 dans le conteneur (utilisateur `app` non root : pas de port < 1024), publié
  en 443 sur l'hôte ; port 8080 publié en 80 pour la redirection et la page d'amorçage du certificat (§ 5.5). Certificat
  lu en PEM (`Kestrel:Certificates:Default:Path` et `KeyPath`) depuis un volume en lecture seule.
- **Volumes** : `/app/config` (`.env`, déclaration des sociétés), `/app/certificats` (lecture seule),
  `/app/stockage-ged`, `/app/journaux`. Le `.env` est lu depuis `/app/config` (`AjouterFichierEnv` cherche déjà dans le
  dossier de l'API et ses parents : ajouter ce chemin).
- **Fuseau** `TZ=Europe/Paris` (archivage à 02:30, notifications, horodatage des pointages). L'image Debian contient
  `tzdata` ; une image « chiseled » non, à écarter tant que ce n'est pas vérifié.
- **Santé** : `HEALTHCHECK` sur `/api/sante` ; redémarrage `unless-stopped`.
- **Commandes de l'image** : la même image porte les commandes de serveur (`env …`, `comptes …`) et les nouvelles
  commandes `installation …` (§ 6), lancées par `docker compose run --rm logibtp-api installation …`.

### 3.2 Conteneur de la base

- **Image officielle `postgres:17`, non modifiée** : le schéma n'est plus monté dans `docker-entrypoint-initdb.d`
  (réservé au développement) ; il est créé par la commande d'installation de l'image de l'API (§ 6), qui porte les
  scripts SQL de la version installée. Ainsi l'image de la base ne change qu'avec la version de PostgreSQL.
- **Superutilisateur** `postgres` à mot de passe aléatoire (connu de l'installeur seulement, rangé chiffré dans le
  `.env`) ; rôles de l'application par `roles.sql`.
- **`pg_hba.conf` et `postgresql.conf` générés** par l'installeur et montés : `scram-sha-256` partout, connexion de
  `logibtp_app` et `logibtp_lecture` limitée au réseau Docker (ou à l'adresse du serveur de l'API, § 3.3), `hostssl`
  dès que la base est sur une autre machine ; réglages mémoire selon la RAM (`shared_buffers`, `effective_cache_size`,
  `work_mem`), `TZ` et `log_timezone`.
- **Données sur un volume nommé** (dans le disque virtuel de WSL ou de la VM), jamais sur un dossier Windows monté :
  lent et source d'erreurs de droits pour PostgreSQL. Les **sauvegardes** vont, elles, dans un dossier Windows (§ 7.1).
- **Port** : non publié quand l'API est sur le même hôte (réseau Docker seul) ; publié en 5432 avec TLS seulement si
  l'API est ailleurs.

### 3.3 Deux projets indépendants

Deux fichiers Compose dans deux dossiers (`logibtp-base/compose.yml`, `logibtp-api/compose.yml`), chacun avec son
nom de projet : arrêter ou mettre à jour l'API ne touche pas la base, et inversement. Ils se rejoignent par un réseau
Docker **externe** `logibtp` créé par l'installeur. Deux dispositions :

| | Même hôte (cas courant) | Base sur une autre machine |
|---|---|---|
| Liaison | Réseau Docker `logibtp`, nom `logibtp-base` | Réseau local, port 5432 publié |
| Chiffrement | Inutile (aucun port publié) | `hostssl` + certificat de la base émis par la même autorité, client `SSL Mode=VerifyFull;Root Certificate=/app/certificats/racine.crt` |
| `pg_hba.conf` | Sous-réseau du réseau `logibtp` | Adresse du serveur de l'API `/32` |

## 4. L'hôte Windows

Docker exécute des conteneurs **Linux** (PostgreSQL, ASP.NET sous Debian) ; sous Windows il lui faut une machine
virtuelle Linux. Trois façons, très différentes pour un serveur qui doit redémarrer seul :

| Option | Pour | Contre |
|---|---|---|
| A. **Docker Desktop** (WSL 2) | Installation la plus simple ; ports publiés sur toutes les adresses de Windows | Démarre avec la **session de l'utilisateur** (pas un service : un serveur redémarré sans session ouverte n'a plus LogiBTP) ; non pris en charge sur Windows Server ; licence payante au-delà de 250 salariés ou 10 M$ de chiffre d'affaires |
| B. **Docker Engine dans une distribution WSL 2** (Debian, `systemd`) | Gratuit ; pas d'interface ; démarrage au boot par une tâche planifiée | Réseau WSL à régler (mode « mirrored » de Windows 11 22H2+ ou `netsh portproxy`) ; prise en charge variable selon la version de Windows Server ; mises à jour de WSL à suivre |
| C. **Machine virtuelle Hyper-V** Linux avec Docker Engine | Le plus robuste : service au démarrage, adresse IP propre sur le réseau, sauvegarde de la VM entière, aucun particularisme Windows | Une VM à administrer (mises à jour Debian) ; Hyper-V requis (Windows Pro / Server) |

**Proposition** : C pour un serveur (Windows Server ou poste dédié toujours allumé), A accepté pour un essai ou une
très petite structure (un poste qui reste ouvert). B seulement si Hyper-V est indisponible. L'installeur détecte
l'option (§ 6.2) et ne gère que ce qui diffère : démarrage automatique, réseau, pare-feu.

Ce qui reste côté Windows dans tous les cas : **pare-feu** (443 et 80 entrants depuis le réseau local seulement),
**DNS** (§ 5.2), **autorité du certificat sur les postes** (§ 5.4), tâches planifiées (sauvegarde, renouvellement du
certificat), dossier des sauvegardes.

## 5. Certificat SSL en réseau local

### 5.1 Nom de l'installation

Une base par société impose un nom par société : `societe.logibtp.<domaine>` et la base principale sur
`logibtp.<domaine>`. Le certificat couvre donc **`logibtp.<domaine>` et `*.logibtp.<domaine>`** (un joker ne couvre
qu'un niveau et pas le nom lui-même). Pas d'adresse IP nue : aucun sous-domaine, donc aucune société.

| Domaine | Pour | Contre |
|---|---|---|
| **Sous-domaine du domaine réel de l'entreprise** (`logibtp.entreprise.fr`), résolu en interne | Let's Encrypt possible (§ 5.3, B) ; **retour OAuth de Google accepté** (Google exige un domaine de premier niveau public dans l'adresse de retour : `/api/oauth/retour` du module OAuth) ; noms cohérents si l'on ouvre un jour sur internet | L'entreprise doit avoir un domaine (presque toujours le cas : messagerie) |
| `logibtp.internal` (réservé à l'usage privé) | Aucun domaine à posséder | Ni Let's Encrypt ni OAuth Google ; autorité interne obligatoire |
| `.local` | — | **À proscrire** : réservé au mDNS (Bonjour, tablettes Apple, imprimantes), résolutions aléatoires |

**Proposition** : sous-domaine du domaine réel par défaut, `.internal` en repli sans domaine ni Gmail.

### 5.2 DNS interne

- **Active Directory** (cas courant avec un TSE) : l'installeur produit la commande pour le serveur DNS
  (`Add-DnsServerResourceRecordA` de `logibtp` et `*.logibtp` dans la zone de l'entreprise, ou une zone dédiée
  `logibtp.entreprise.fr` pour ne pas masquer la zone publique) ; à lancer par l'administrateur du domaine.
- **Sans AD** : DNS de la box ou du routeur s'il accepte un joker ; sinon fichier `hosts` des postes (pas de joker : une
  ligne par société, générée par l'installeur avec le script des postes, § 5.4).
- La page d'amorçage (§ 5.5) et le contrôle de l'installeur vérifient que chaque nom répond à l'adresse du serveur.

### 5.3 Origine du certificat

| Option | Confiance sur les postes | Renouvellement | Quand |
|---|---|---|---|
| A. **Autorité de l'Active Directory** (AD CS) | Automatique sur les postes du domaine et le TSE | Par l'administrateur AD (modèle « serveur web », 1 à 2 ans) | AD CS déjà en place |
| B. **Let's Encrypt par défi DNS** (domaine réel) | Partout, sans rien installer (tablettes comprises) | Automatique tous les 60 jours (durée en baisse annoncée) : client ACME avec l'API du fournisseur DNS (OVH, Cloudflare, Infomaniak…) | Domaine réel chez un fournisseur à API, accès internet sortant |
| C. **Autorité LogiBTP créée par l'installeur** | Racine à installer sur les postes, le TSE et les tablettes (§ 5.4) | Par l'installeur (certificat de 2 ans, racine de 10 ans) | Ni AD CS ni Let's Encrypt ; défaut |
| D. **Certificat fourni** (PFX ou PEM d'un prestataire) | Selon l'émetteur | À la charge du client | Politique imposée par le client |

**Proposition** : C par défaut (fonctionne partout, sans dépendance), A ou D importés quand le client a déjà une
autorité, B proposé quand le domaine est chez un fournisseur à API.

**Autorité LogiBTP (C), règles proposées** :

- Créée en C# (`CertificateRequest` de .NET, sans OpenSSL) par la commande `installation certificat creer` :
  racine RSA 3072 ou ECDSA P-256, 10 ans, **contrainte de noms** limitée à `logibtp.<domaine>` (et au nom de la base
  si elle est ailleurs) : la racine installée sur les postes ne peut garantir aucun autre site, même si sa clé fuit.
- Certificat du serveur : `logibtp.<domaine>`, `*.logibtp.<domaine>`, **730 jours** (les appareils Apple refusent au-delà
  de 825 jours, même d'une racine privée), usage « authentification serveur ».
- **Clé de la racine** : chiffrée par la clé des données du `.env` dans `/app/config`, exportable une fois par
  l'installeur pour être gardée hors du serveur ; sans elle, le renouvellement impose de redéployer une nouvelle racine.
- Renouvellement par `installation certificat renouveler` 60 jours avant l'échéance (tâche planifiée), puis
  redémarrage de l'API (quelques secondes, la nuit) ; rappel aux administrateurs par le module Notifications
  30 jours avant (source « certificat » lisant la date du certificat chargé).

### 5.4 Confiance sur les postes

| Cible | Moyen fourni par l'installeur |
|---|---|
| Postes d'un domaine AD | Instructions de **stratégie de groupe** (Configuration ordinateur › Stratégies › Paramètres Windows › Paramètres de sécurité › Stratégies de clé publique › Autorités de certification racines de confiance) et fichier `logibtp-racine.cer` |
| Postes hors domaine | Script `Installer-Certificat-LogiBTP.ps1` (administrateur : `Import-Certificate` dans `Cert:\LocalMachine\Root`, empreinte vérifiée avant import) |
| Serveur TSE | Même script, une fois dans le magasin de l'**ordinateur** : vaut pour toutes les sessions |
| Edge, Chrome | Magasin de Windows : rien de plus |
| Firefox | Lit les racines de Windows par défaut depuis la version 120 ; sinon stratégie `ImportEnterpriseRoots` |
| Tablettes de la borne | iPad : profil à installer puis confiance totale à activer (Réglages › Général › Informations › Réglages des certificats) ; Android : certificat utilisateur, reconnu par Chrome |

### 5.5 Page d'amorçage

Le port 80 ne sert que deux choses : la **redirection vers HTTPS** et une page `http://logibtp.<domaine>/certificat`
(publique, statique, hors du client) qui affiche l'empreinte SHA-256 de la racine, propose `logibtp-racine.cer`, le
script des postes et le profil iPad, et vérifie le DNS du poste. Téléchargée en HTTP, la racine pourrait être substituée
sur le réseau : l'empreinte est aussi affichée par l'installeur pour comparaison. Option A, B ou D : page sans
téléchargement (rien à installer, ou fourni par l'AD).

### 5.6 Effets dans l'application

- Cookies toujours `Secure` hors du développement (aujourd'hui : selon `IsHttps`) ; HTTP refusé par l'API hors de la
  redirection et de la page d'amorçage.
- HSTS reste réservé à `INTERNET` (§ 10.6 des droits : un certificat expiré en réseau local bloquerait tout le monde
  sans recours).
- `UseHttpsRedirection` avec le port public 443 (et non 8443).
- La borne passe en HTTPS : caméra, presse-papiers et `crypto` disponibles sur les tablettes.

## 6. Installeur

### 6.1 Répartition

- **Logique dans l'image de l'API** (C#, testable, la même sous Windows et Linux) : commandes `installation …`
  rangées dans un module `modules/installation` (sans métier : génération des secrets, autorité et certificats,
  `pg_hba.conf`, `postgresql.conf`, exécution d'une liste ordonnée de scripts SQL sous un rôle donné) ; le cœur fournit
  la liste des scripts (§ 6.3), la création du premier administrateur (`CommandeComptes`) et les données de départ.
- **Script Windows mince** `Installer-LogiBTP.ps1` (PowerShell, administrateur) : ce qui ne peut se faire que sur
  l'hôte — prérequis, dossiers, Compose, pare-feu, tâches planifiées, DNS (commande proposée), racine sur le serveur
  lui-même.

### 6.2 Déroulé

1. **Prérequis** : Docker joignable (option A, B ou C du § 4), version de Compose, ports 80 / 443 libres, RAM et disque ;
   en option C ou B, démarrage automatique.
2. **Dossier de l'installation** (par défaut `C:\LogiBTP`) : `base\`, `api\config`, `api\certificats`, `sauvegardes\` ;
   droits NTFS restreints aux administrateurs.
3. **Configuration** : `.env` fourni conservé (D28), sinon `env initialiser LOCAL` ; mots de passe aléatoires du
   superutilisateur et des trois rôles, chiffrés ; adresses de confiance (réseau local détecté, adresse du TSE
   demandée) ; nom de l'installation (§ 5.1).
4. **Base** : réseau `logibtp`, `pg_hba.conf` et `postgresql.conf` générés, démarrage du projet `logibtp-base`.
5. **Schéma** : `installation base creer [--societe <code>]` : base créée sous le superutilisateur, scripts appliqués
   dans l'ordre sous `logibtp_schema`, `roles.sql`, données de départ (sans la démonstration, sauf demande).
6. **Certificat** : option choisie (§ 5.3), fichiers dans `api\certificats`.
7. **API** : démarrage du projet `logibtp-api`, contrôle de `/api/sante` en HTTPS.
8. **Premier administrateur** : `comptes creer-admin` (mot de passe provisoire affiché une fois, `MDP_A_CHANGER`).
9. **Windows** : règles de pare-feu (443, 80 ; 5432 seulement si base séparée), tâches planifiées (sauvegarde nocturne,
   renouvellement du certificat, démarrage de WSL en option B), racine installée sur le serveur.
10. **Rapport** : adresses, empreinte de la racine, commande DNS, script des postes, emplacement des sauvegardes et
    rappel : **sauvegarder le `.env` et la clé de la racine hors du serveur**.

Chaque étape est **rejouable** (rien n'est recréé s'il existe) ; une reprise après échec repart de l'étape en défaut.

### 6.3 Liste des scripts SQL : une seule source

Aujourd'hui l'ordre des 140 scripts n'existe que dans `docker-compose.yml`. Proposition : un manifeste
`db/installation/scripts.txt` (un chemin par ligne, dans l'ordre, scripts de démonstration marqués), lu par
l'installeur, embarqué dans l'image et **utilisé pour générer** le `docker-compose.yml` de développement (ou monté en
un seul script `000_installer.sh` qui le parcourt). Un test vérifie que chaque fichier `modules/*/db/*.sql` et
`db/*.sql` y figure.

### 6.4 Sociétés

Ajouter une société = créer sa base (étape 5 avec `--societe`), la déclarer, redémarrer l'API. Pour ne plus répéter de
chaîne de connexion avec son mot de passe : hôte, port et mot de passe de `logibtp_app` une fois dans le `.env`
(chiffrés), nom de la base déduit du code (`logibtp_<code>`), déclaration des sociétés (code, libellé) dans
`/app/config/societes.json`. `Societes:Liste` reste accepté (développement, cas particuliers). Le joker DNS et le
certificat couvrent la nouvelle société sans autre action.

## 7. Exploitation

### 7.1 Sauvegarde et restauration

- **Nuit** (tâche planifiée Windows, `installation sauvegarder`) : `pg_dump -Fc` de chaque base par
  `docker exec logibtp-base`, copie du stockage de la GED (incrémentale), du `.env`, de `societes.json` et des
  certificats, vers `C:\LogiBTP\sauvegardes` (ou un partage réseau / NAS) ; conservation : 7 nuits, 4 semaines,
  12 mois ; échec → notification aux administrateurs.
- La GED et la base sont sauvegardées **au même moment** (le coffre lie l'empreinte des fichiers à la base) ; un
  contrôle `installation verifier` relit les empreintes après restauration.
- **Restauration** : `installation restaurer <dossier>` (base vide recréée, `pg_restore`, rôles, GED, `.env` conservé
  ou repris) ; procédure **essayée** à l'installation sur une base de test.
- Chiffrement des sauvegardes (§ 10.9 des droits) : par la clé des données, lot 4.

### 7.2 Mise à jour

1. Nouvelle image (registre ou fichier `docker load` pour un serveur sans internet), empreinte vérifiée.
2. Sauvegarde (§ 7.1).
3. Arrêt de l'API, scripts de la nouvelle version sous `logibtp_schema`, **conversions** (métrés, aujourd'hui au
   démarrage de l'API sous un rôle qui n'en a pas le droit) passées dans la commande de mise à jour.
4. Redémarrage, contrôle de `/api/sante` ; retour à l'image précédente et à la sauvegarde en cas d'échec.

L'étape 3 suppose le **module de gestion des versions de la base** (TODO : scripts ordonnés et rejouables, numéro de
version par base). D'ici là, la mise à jour reste manuelle et documentée ; l'installation neuve ne l'attend pas.

### 7.3 Supervision

État des deux conteneurs et du certificat (échéance), dernière sauvegarde, espace disque : page
`/parametres/installation` (lecture, administrateurs), alimentée par une route qui n'expose ni chemin ni secret.

## 8. Faisabilité et risques

| Risque | Mesure |
|---|---|
| Docker Desktop arrêté au redémarrage du serveur sans session | Option C (VM) ou B (tâche au démarrage) proposée par défaut sur un serveur (§ 4) |
| Racine non installée sur un poste : alerte du navigateur, puis contournement par l'utilisateur (habitude dangereuse) | GPO, script, page d'amorçage, contrôle de l'empreinte ; option B quand c'est possible |
| Fuite de la clé de la racine | Contrainte de noms (ne garantit que LogiBTP), clé chiffrée, export hors serveur |
| Certificat expiré : tout le réseau bloqué | Renouvellement planifié 60 jours avant, notification 30 jours avant, pas de HSTS en local |
| Données PostgreSQL sur un dossier Windows | Volume nommé imposé, sauvegardes seules dans un dossier Windows |
| Clé de construction laissée dans l'image | Secret BuildKit (§ 3.1) ; la clé reste dans le binaire, limite assumée par D25 |
| Ordre des scripts tenu en deux endroits | Manifeste unique (§ 6.3) et test |
| Conversions au démarrage sous le rôle de l'application | Passées dans la commande de mise à jour (§ 7.2) |
| Heures des tâches de fond décalées (UTC) | `TZ=Europe/Paris` dans les deux conteneurs |
| Société ajoutée sans redémarrer | Hors périmètre : redémarrage de quelques secondes, la nuit ou à la demande |

Charge estimée : lot 1 et 2 de taille moyenne (image, service des fichiers, commandes C#, autorité), lot 3 surtout du
PowerShell et des essais sur Windows Server / Windows 11, lot 4 dépendant du module des versions de la base.

## 9. Questions et propositions

| N° | Question | Proposition | Décision |
|---|---|---|---|
| I1 | Hôte Docker sous Windows ? | VM Hyper-V Linux (C) sur un serveur ; Docker Desktop (A) toléré pour un essai ou un poste toujours ouvert ; WSL 2 sans Desktop (B) en repli (§ 4). | ✔ Retenue. |
| I2 | Qui sert le client et termine le HTTPS ? | L'API (Kestrel, fichiers statiques, CSP bloquante) : deux conteneurs, pas de proxy en réseau local ; un proxy (Caddy) seulement pour internet. | ✔ Retenue. |
| I3 | Origine du certificat par défaut ? | Autorité LogiBTP créée par l'installeur (C), import d'un AD CS ou d'un certificat fourni (A, D), Let's Encrypt par DNS proposé (B) (§ 5.3). | ✔ Retenue. |
| I4 | Nom de l'installation ? | Sous-domaine du domaine réel (`logibtp.entreprise.fr`) résolu en interne ; `.internal` en repli ; `.local` refusé (§ 5.1). | ✔ Retenue. |
| I5 | Durées du certificat et de la racine ? | Serveur 730 jours, racine 10 ans avec contrainte de noms ; renouvellement 60 jours avant. | ✔ Retenue. |
| I6 | Clé de la racine : gardée sur le serveur ? | Oui, chiffrée par la clé des données, plus un export à garder hors du serveur. | ✔ Retenue. |
| I7 | Page d'amorçage en HTTP pour diffuser la racine ? | Oui, avec empreinte affichée et vérification DNS (§ 5.5). | ✔ Retenue. |
| I8 | Base sur une autre machine dès le premier lot ? | Non : même hôte d'abord (réseau Docker, sans TLS) ; base séparée avec TLS au lot 3. | ✔ Retenue. |
| I9 | Scripts SQL : où vit l'ordre ? | Manifeste `db/installation/scripts.txt`, source du Compose de développement et de l'installeur (§ 6.3). | ✔ Retenue. |
| I10 | Connexions des sociétés ? | Hôte et mot de passe une fois dans le `.env`, base déduite du code, liste des sociétés dans `societes.json` (§ 6.4). | ✔ Retenue. |
| I11 | Données de démonstration à l'installation ? | Non par défaut ; société `demo` sur demande (`--demo`). | ✔ Retenue. |
| I12 | Forme de l'installeur ? | Commandes C# dans l'image + script PowerShell mince (§ 6.1) ; pas d'installeur graphique (MSI) pour commencer. | ✔ Retenue. |
| I13 | Distribution de l'image ? | Registre (GitHub Container Registry) et fichier `docker save` signé pour les serveurs sans internet. | ✔ Retenue. |
| I14 | Sauvegardes : où et combien ? | Dossier de l'installation ou partage réseau, 7 / 4 / 12, GED et base ensemble, essai de restauration à l'installation (§ 7.1). | ✔ Retenue. |

## 10. Découpage en lots proposé

| Lot | Contenu | Prérequis |
|---|---|---|
| 1 | Image de l'API (Dockerfile en plusieurs étapes, secret de construction, client servi par l'API, CSP bloquante, `TZ`, santé), Compose de la base et de l'API en deux projets sur un réseau commun, manifeste des scripts, commandes `installation base creer` (scripts sous `logibtp_schema`, `roles.sql`, `pg_hba.conf`) et `societe ajouter`, sociétés dans `societes.json`, conversions sorties du démarrage ; HTTP seulement, sur l'hôte | — |
| 2 | HTTPS : Kestrel en PEM, redirection, cookies `Secure` ; autorité LogiBTP (création, émission, contrainte de noms, renouvellement), import AD CS / PFX / PEM, page d'amorçage, script des postes, profil iPad, rappel d'échéance | 1 |
| 3 | `Installer-LogiBTP.ps1` : prérequis et détection de l'hôte (A, B, C), dossiers, pare-feu, DNS proposé, tâches planifiées, premier administrateur, rapport ; base sur une autre machine (TLS PostgreSQL) ; sauvegarde et restauration ; page `/parametres/installation` | 2 |
| 4 | Mise à jour (avec le module de gestion des versions de la base), Let's Encrypt par défi DNS, chiffrement des sauvegardes, rotation de la clé des données (rechiffrer les valeurs `chiffre:v1:`) | 3, versions de la base |
