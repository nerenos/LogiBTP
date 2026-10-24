# LogiBTP – analyse du module Droits

> Analyse préalable (24/10/2026) à partir de la note « Module Droit ». Suite du module d'authentification
> ([ANALYSE-MODULE-AUTHENTIFICATION.md](ANALYSE-MODULE-AUTHENTIFICATION.md), lots 2 à 4 du § 9) et de l'analyse
> transverse ([ANALYSE-MODULES-TRANSVERSE.md](ANALYSE-MODULES-TRANSVERSE.md)). Modules qui l'attendent : Mail
> (comptes, boîtes, « À rapprocher »), OAuth (reconnexion), Exécution (délégation du contrôle N+1, E30), Pointage
> (borne, profil de saisie mobile), Stock (droits portés par la borne).
>
> **État** : questions D1 à D31 tranchées le 24/10/2026 (§ 8) ; propositions retenues sauf D1 (JWT avec rotation,
> jetons hachés en base), D3 (code par courriel seulement pour commencer), D9 (validation par règle sans contrôle des
> droits), D14 (usurpation réservée aux administrateurs), D21 (comptage par base), D22 et D25 (clé du `.env` dans les
> binaires fournis : protection contre les curieux, `.env` lisible sur une autre machine), D28 (`.env` fourni
> conservé) ; D32 (CSP : option C) et D33 (limites de débit) retenues le 24/10/2026. Déploiement en
> réseau local et sur internet : § 10.

## 1. Note d'origine (résumé)

- Droits par **profil**, chaque identifiant lié à un profil.
- Deux types d'identifiants : **personne** (interface, lié à un interlocuteur de l'annuaire) et **service** (API
  seule, sans interface).
- Le **serveur** applique les droits : l'API ne fournit pas les données et refuse les requêtes non permises.
- Droits par module, puis par document / fiche / liste ; la modification du parent se répercute sur les enfants.
  Niveaux à la façon de `rwx` : consultation, modification, validation, création, suppression, déverrouillage,
  forçage ; activer un niveau active les précédents.
- Transformation d'un document : consultation du type source et création du type cible.
- Droits supplémentaires : usurpation d'un autre identifiant, gestion des profils, des identifiants, des journaux,
  accès à certains modules (Pointage, borne…), RGPD.
- Montants de validation (désactivés par défaut : −1) : deux montants par type de document, l'un par pièce, l'autre
  sur une période flottante (éviter les nombreuses petites commandes).
- Jetons de rafraîchissement rotatifs (JWT, un jour au plus), machines connues (avec ou sans double facteur),
  déconnexion à distance et gestion des sessions, mots de passe longs avec caractères spéciaux.
- Connexion toujours par identifiant et mot de passe (jamais par un ID).
- ID de la gestion des droits en **UUID** (non consécutifs, contre la force brute).
- Requêtes paramétrées (injection SQL), validation stricte des entrées, moindre privilège.
- Base de données : compte propre, ni superutilisateur ni multi-bases, créé à l'installation ; connexion limitée à
  l'IP du serveur si la base est ailleurs.
- Données RGPD jamais envoyées sauf déverrouillage.
- Journaux à plusieurs niveaux (défaut : erreurs seulement, en base), niveau lu au démarrage dans le `.env` ; jamais
  de données RGPD, mot de passe, identifiant ou jeton dans les journaux.
- `.env` chiffré par une clé générée côté serveur à la compilation.
- Code client non obscurci (open source), mais allégé en production.
- Ajout du 24/10/2026 : **exclusion d'une adresse IP** après trop de connexions fausses, sauf si l'IP est liée à une
  machine connue.

## 2. Ce qui existe déjà

| Sujet | Aujourd'hui | Conséquence |
|---|---|---|
| Session | Jeton opaque (32 octets) en cookie HttpOnly `logibtp_session`, SameSite=Strict, empreinte SHA-256 seule en base ; relue à chaque appel (cache 30 s) ; 10 h glissantes, 7 jours avec « Rester connecté » | Déconnexion à distance et fermeture immédiate déjà possibles ; un JWT ferait reculer la révocation |
| Verrouillage | Par compte : 5 échecs → 15 min ; refus identique pour identifiant inconnu (empreinte factice) | Rien par adresse IP |
| Mots de passe | PBKDF2-SHA256 210 000 itérations, longueur minimale en points de code, 128 au plus, courants refusés | Politique longue déjà en place ; manque la normalisation Unicode |
| Profils | Un profil par compte (`ADMIN`, `SAISIE`, `SERVICE`) ; intérimaire jamais ADMIN | Base du modèle par profil |
| Droits | `droit_document` (profil × type × action), `droit_fiche` (`VOIR`, `MODIFIER`, `DEBLOQUER`, `CONFIDENTIEL`, `SUPPRIMER`), `crm_droit` ; `Utilisateur.EstAdmin` | À reprendre dans le nouveau modèle |
| Droits hors profil | Pointage : le salarié, le responsable de son service, RH = service ADMINISTRATIF ; OAuth et notifications : `service:<code>` ; Exécution : responsable du service | Un profil seul ne dit pas « soi » ni « son service » |
| Comptes de service | `archivage_ged`, `editions_fond` : jamais de connexion | Les identifiants API sont un nouveau cas |
| Borne | Appareil enregistré, jeton `X-Borne-Jeton`, PIN haché, aucune session ; crée des pièces au nom du salarié | Troisième type d'identifiant, déjà en service |
| RGPD | `pcf_confidentiel` des champs de fiche, notes privées du CRM (levée journalisée) | Mécanisme partiel, à généraliser |
| Journaux | `journal_connexion`, journaux du Mail, de la GED (protégé par triggers), historique des prix et coordonnées | Pas de journal technique en base ni de niveau |
| Requêtes | EF Core et `ConstructeurRequete` (identifiants en liste blanche) ; listes de valeurs par SELECT et listes par requête SQL saisies par l'utilisateur (lecture seule) | Seuls points d'injection assumés |
| Clés | Entiers `SERIAL` partout | Passer tout en UUID serait un chantier énorme |
| Secrets | `LOGIBTP_CLE_CHIFFREMENT` en clair dans `.env` | Le module d'installation est attendu (TODO) |

## 3. Décisions structurantes proposées

### 3.1 Session : JWT d'accès court et rafraîchissement rotatif (D1)

- **Jeton d'accès** : JWT court (5 min), signé par une clé de l'installation, portant les UUID du compte et de la
  session et le profil ; vérifié sans lecture de la base. Interface : cookie HttpOnly, SameSite=Strict (jamais le
  `localStorage`, lisible par un script injecté) ; identifiants API : `Authorization: Bearer`.
- **Jeton de rafraîchissement** : opaque, **haché en base** (comme le jeton de session actuel), à usage unique :
  chaque rafraîchissement le remplace (l'ancien accepté encore quelques secondes pour les requêtes en vol) ;
  présentation d'un jeton déjà remplacé = vol présumé, toute la famille de jetons (la session) fermée et
  journalisée.
- **Durée** : un jour au plus sans machine connue, 7 jours sur une machine connue, puis ressaisie du mot de passe
  (D2) ; connexion toujours par identifiant et mot de passe.
- **Révocation** : la fermeture d'une session (déconnexion à distance, compte désactivé, profil changé) agit au
  prochain rafraîchissement, donc dans les 5 min ; pour une fermeture immédiate, liste des sessions révoquées en
  mémoire par base, consultée à chaque appel (D26).
- Reprise du lot 1 d'authentification : `session_utilisateur` devient la famille de jetons, le cookie
  `logibtp_session` est remplacé par le couple accès / rafraîchissement.

### 3.2 Modèle de droits

- **Arbre des droits** : module › élément (type de document, type de fiche, liste, page, fonction) ; chaque nœud
  est « hérité » ou « propre » (D7). Les droits supplémentaires (usurpation, gestion des profils, des comptes, des
  journaux, RGPD, accès borne…) sont des nœuds de fonctions.
- **Actions** indépendantes en base (une case par action), cochées en cascade par l'interface (D5) : une échelle
  stricte ferait de tout créateur un valideur et rendrait inutiles les montants de validation.
- **Portée** (D6) : soi / mon service / tout, pour exprimer les règles actuelles du Pointage, de l'Exécution et du
  CRM sans les coder en dur.
- **Calcul des droits** répliqué entre JS (interface : masquer et griser) et C# (serveur : refuser), jeu de cas commun
  comme les autres règles du projet ; le serveur reste seul juge.

### 3.3 Contrôle par le serveur

Refus par défaut : chaque route déclare le droit qu'elle exige (métadonnée de route), un test vérifie qu'aucune route
n'en est dépourvue. Filtrage des accès indirects : listes génériques (vues SQL du module Liste), recherche globale,
graphe, fil d'actualité, diffusion temps réel (SSE du planning), éditions PDF, exports CSV, notifications, courriels,
GED (`acces.js`). Validation stricte des entrées : DTO typés, propriétés inconnues refusées, longueurs bornées.

### 3.4 UUID ciblés

UUID (v7, non devinables par ordre seul, mais triables) pour les comptes, profils, sessions, machines, identifiants
API et liens publics ; clés métier inchangées. La protection réelle contre l'accès à un objet d'autrui est le contrôle
du droit sur chaque objet, pas l'imprévisibilité de l'ID.

### 3.5 Base de données : trois rôles

| Rôle | Droits | Utilisé par |
|---|---|---|
| Schéma | Propriétaire des tables, DDL, création des bases de société | Installeur, mise à jour, scripts SQL et conversions (aujourd'hui lancés par l'API au démarrage) |
| Exécution | DML seulement, **non propriétaire** (les triggers du coffre de la GED ne peuvent pas être désactivés) | API |
| Lecture | SELECT seul, délai maximal | Listes, listes de valeurs par SELECT, requêtes saisies |

Une base par société : les rôles valent pour toutes les bases de l'installation (un rôle par base multiplierait les
secrets). Restriction par IP : `pg_hba.conf`, écrit par l'installeur.

### 3.6 Secrets : deux clés (D22, D25, D28)

| Clé | Créée | Chiffre | Rangée |
|---|---|---|---|
| Clé du `.env` | Une fois pour le projet, injectée à la construction des binaires fournis (secret de la construction des versions, jamais dans le dépôt) ; stable d'une version à l'autre | Valeurs sensibles du `.env` (mot de passe de la base, clé des données, secrets OAuth, clé de signature des JWT) | Dans le binaire |
| Clé des données | À l'installation | Données chiffrées en base (mots de passe des fiches, comptes de messagerie, jetons OAuth : aujourd'hui `LOGIBTP_CLE_CHIFFREMENT`) | Dans le `.env`, chiffrée par la clé du `.env` |

**But du chiffrement du `.env`** (D25) : écarter les **curieux en interne** (un `.env` ouvert dans un éditeur ne
montre aucun secret) tout en gardant un `.env` **utilisable ailleurs** : copie, sauvegarde, dépannage sur une autre
machine avec le même binaire. La clé n'est donc liée ni à la machine ni à l'installation.

**Limite assumée** : la clé est la même dans tous les binaires fournis ; quiconque dispose d'un binaire et d'un
`.env` (donc de la clé des données) lit les secrets. La protection contre un attaquant qui a pris le serveur n'est
pas l'objet de cette clé : elle repose sur les droits du système de fichiers (`.env` lisible par le seul compte du
service) et les rôles PostgreSQL. Une construction personnelle (open source) a sa propre clé, incompatible avec les
binaires fournis. Valeurs préfixées par la version de la clé (`env:v1:`) pour pouvoir la changer un jour.

**Installation** (D28) : un `.env` fourni (copie, reprise d'une autre machine) est conservé tel quel ; sans `.env`,
l'installeur crée une configuration neuve (clé des données, comptes PostgreSQL, clé de signature). La perte de la
clé des données rend illisibles les données chiffrées : le `.env` se sauvegarde avec la base.

### 3.7 Journaux

- **Journal technique** : niveau lu au démarrage (`.env`), en base ; repli sur fichier si l'écriture en base échoue
  (cas typique : l'erreur à journaliser est une erreur SQL).
- **Journal d'audit**, toujours actif quel que soit le niveau : connexions, droits et profils modifiés, usurpations,
  déverrouillages RGPD, exclusions d'IP.
- **Masquage** à la source (filtre de journalisation) : corps des requêtes, paramètres SQL, en-têtes `Authorization`
  et cookies, URL à jeton (`/connexion?jeton=` de la réinitialisation), messages d'exception Npgsql qui citent les
  valeurs (`Key (col)=(valeur) already exists`).

## 4. Exclusion d'une adresse IP (D19)

Complète le verrouillage par compte, qui ne protège pas contre l'essai d'un mot de passe courant sur de nombreux
comptes (pulvérisation).

- **Comptage** : échecs de connexion par adresse sur une fenêtre glissante, tous comptes confondus (identifiants
  inconnus compris) ; au-delà du seuil, l'adresse est **exclue** pour une durée croissante (15 min, puis 1 h, puis
  24 h si elle récidive).
- **Effet** : toute connexion depuis l'adresse est refusée par la même réponse générique (`CONNEXION_REFUSEE`, sans
  dire qu'elle est exclue, pour ne pas renseigner l'attaquant) ; les sessions déjà ouvertes continuent ; journal
  d'audit (`EXCLUSION_IP`), notification aux administrateurs.
- **Exception des machines connues** (D20) : n'est pas exemptée l'adresse entière mais la **requête** qui présente
  un jeton de machine connue valide (bureau, dépôt, serveur TSE, borne derrière une même adresse) ; un attaquant sur
  le même réseau (Wi-Fi d'un chantier, NAT d'opérateur mobile) n'en profite pas.
- **Levée** : automatique à l'échéance ; manuelle par un administrateur (droit « gestion des journaux » ou des
  comptes) depuis la liste des adresses exclues ; liste d'adresses jamais exclues (réseau de l'entreprise) en
  paramètre.
- **Points techniques** :
  - derrière un proxy inverse, l'adresse vient de `X-Forwarded-For` **seulement** depuis les proxys déclarés
    (`ForwardedHeaders` d'ASP.NET), sinon tout le monde se donne l'adresse voulue ;
  - IPv6 : compter par préfixe /64 (une machine dispose de milliards d'adresses) ;
  - comptage **par base** (société, D21) : un attaquant qui vise plusieurs sociétés dispose du seuil dans chacune ;
    le limiteur global du proxy (§ 10) couvre l'installation ;
  - l'adresse IP est une donnée personnelle : conservation limitée (D24).
- Mêmes règles pour la borne (PIN : 4 à 6 chiffres, donc plus exposé) et la route `POST /oubli`.

## 5. Synthèse fonctionnelle

- **Identifiants** : personne (interface, individu de l'annuaire), service (API, secret, adresses permises),
  appareil (borne). Profil unique par identifiant (A2), profil par défaut à la création = **saisie mobile**
  (pointage MO), pour limiter les droits (révision de A5, le 24/10/2026).
- **Profils** : création, copie, arbre des droits, portée ; profils système non supprimables (ADMIN, SERVICE).
- **Montants de validation** par profil et type de document (−1 = contrôle désactivé, D10) : par pièce et
  cumul sur période flottante.
- **Transformation** : consultation de la source, création de la cible ; une validation automatique par règle ne contrôle pas les droits (D9).
- **Usurpation** (D14) : réservée aux **administrateurs**, pour tester des droits et dépanner ; motif saisi au
  début ; identité réelle et usurpée dans toutes les traces (journal d'audit au début et à la fin, chaque écriture
  signée de l'usurpé dans les colonnes `*_par` et de l'administrateur dans le journal d'audit) ; ni changement de
  mot de passe ni gestion des droits pendant l'usurpation ; 1 h au plus ; bandeau visible ; notification à
  l'usurpé selon un paramètre.
- **RGPD** : champs confidentiels jamais envoyés (fiches, listes, exports, éditions, recherche, tri) ; déverrouillage
  journalisé, d'une fiche, pour une durée (D13).
- **Sessions** : liste des sessions et machines du compte (navigateur, adresse, dernière activité), fermeture à
  distance par l'utilisateur ou un administrateur ; machines connues (D4) ; double facteur par **code envoyé par
  courriel** (module Mail) pour commencer, l'application d'authentification (TOTP) plus tard (D3).
- **Client** : construction de production (minification) facultative, le code reste lisible (open source).

## 6. Liens avec les autres modules

| Module | Ce que le module Droits apporte |
|---|---|
| Authentification | JWT d'accès et rafraîchissement rotatif, identifiants API, machines connues, double facteur, exclusion d'IP |
| Document | Droits par type et action, montants de validation, transformation ; reprise de `droit_document` |
| Fiche | Droits par type de fiche, RGPD ; reprise de `droit_fiche` |
| Liste | Filtrage des lignes et des colonnes confidentielles ; requêtes sous le rôle lecture |
| CRM | Reprise de `crm_droit`, notes privées |
| Pointage, Exécution | Portée « soi / mon service » au lieu des règles en dur ; délégation du contrôle N+1 (E30) |
| Mail, OAuth | Droits des comptes, des boîtes et des connexions (aujourd'hui profils ou `service:<code>`) |
| Borne (Pointage, Stock) | Identifiant d'appareil, droits portés par la borne, exclusion sur échec de PIN |
| Mail | Envoi du code du double facteur (`EnvoyerAutomatiqueAsync`, usage dédié) |
| Installation (à venir) | Rôles PostgreSQL, clé des données, chiffrement du `.env`, commande de mise à jour, premier administrateur |

## 7. Faisabilité et risques

- **Le plus lourd** : l'audit de toutes les routes existantes et des accès indirects (§ 3.3). Un test qui énumère
  les routes et exige une métadonnée de droit rend l'oubli visible.
- **Rôles PostgreSQL** : les scripts SQL et conversions lancés par l'API au démarrage doivent passer sous le rôle
  schéma (outil séparé ou connexion distincte au démarrage).
- **Reprise des droits** existants : migration automatique des trois tables vers l'arbre ; tests de non-régression
  par profil.
- **Démonstration hors ligne** : sans serveur, les droits ne sont qu'affichés (D23).

## 8. Questions et propositions

| N° | Question | Proposition | Décision |
|---|---|---|---|
| D1 | JWT pour l'interface ? | Non : jeton opaque en cookie avec rotation ; JWT réservé aux identifiants API. | ✘ Autrement : **JWT** avec rotation du jeton de rafraîchissement, jetons **hachés en base** (§ 3.1). |
| D2 | « Un jour au plus » : durée de quoi ? | Durée absolue d'une session sans machine connue ; sur une machine connue, renouvellement sans mot de passe jusqu'à 7 jours ; ressaisie du mot de passe au-delà. | ✔ Retenue. |
| D3 | Double facteur : lequel, pour qui ? | TOTP avec codes de secours ; code par courriel en repli ; obligatoire pour ADMIN et la gestion des droits, facultatif ailleurs ; demandé à la première connexion d'une machine inconnue. | ✔ Précisé : **code par courriel (module Mail) seulement** pour commencer ; TOTP plus tard. |
| D4 | Machine connue : comment la reconnaître ? | Jeton d'appareil de longue durée (cookie HttpOnly séparé, empreinte en base, nommable, révocable) ; pas d'empreinte du navigateur. | ✔ Retenue. |
| D5 | Niveaux cumulatifs stricts ou indépendants ? | Indépendants en base, cochés en cascade par l'interface, décochables (§ 3.2). | ✔ Retenue. |
| D6 | Portée soi / mon service / tout ? | Oui, par action ; remplace les règles en dur du Pointage et de l'Exécution. | ✔ Retenue. |
| D7 | Héritage parent → enfants : écraser ou défaut ? | Défaut : un enfant « hérité » suit le parent, un enfant « propre » garde sa valeur ; « réappliquer aux enfants » explicite. | ✔ Retenue. |
| D8 | Déverrouillage et forçage : quel sens ? | Déverrouillage = reprendre un élément verrouillé par un autre et dévalider ; forçage = valider malgré un contrôle bloquant ou un montant dépassé, avec motif journalisé ; le RGPD est un droit à part. Fiche : ni validation ni forçage. | ✔ Retenue. |
| D9 | Validations automatiques (type intermédiaire, avoir d'annulation, pièces du magasin et de la borne) ? | Validation « système » couverte par le droit de l'action déclenchante. | ✘ Autrement : quand une **règle de validation** est définie (validation automatique), les droits n'entrent pas en compte. |
| D10 | Montants : HT ou TTC ; −1 = sans limite ou validation interdite ? | HT ; −1 = contrôle désactivé (sans limite), 0 = validation interdite. | ✔ Retenue. |
| D11 | Cumul sur période flottante : par qui ? | Par identifiant, type de document et tiers, sur N jours glissants. | ✔ Retenue. |
| D12 | Au-delà du seuil ? | Refus `MONTANT_VALIDATION` et demande de validation (tâche du CRM au valideur du niveau supérieur) ; circuit d'approbation complet plus tard. | ✔ Retenue, **y compris pour une limite à 0** (demande de validation plutôt que refus sec). |
| D13 | Déverrouillage RGPD : portée ? | Une fiche, pour la durée de la page ouverte, motif facultatif, journalisé ; recherche et tri sur un champ confidentiel interdits. | ✔ Retenue. |
| D14 | Usurpation : limites ? | Jamais vers un profil supérieur ; ni gestion des droits ni mot de passe ; 1 h au plus ; notification à l'usurpé (paramètre). | ✔ Précisé : **réservée aux administrateurs** (tests des droits, dépannage), avec une **trace** de chaque action (§ 5). |
| D15 | Identifiants API : profil, IP ? | Profil comme les autres ; adresses permises facultatives ; secret affiché une fois, renouvelable. | ✔ Retenue. |
| D16 | La borne devient-elle un identifiant ? | Oui : identifiant d'appareil avec profil ; jeton actuel conservé. | ✔ Retenue. |
| D17 | UUID : périmètre ? | Comptes, profils, sessions, machines, identifiants API, liens publics (§ 3.4). | ✔ Retenue **pour commencer** (but : pas d'ID consécutifs à essayer) ; à étendre aux ID exposés si besoin. |
| D18 | Rôles PostgreSQL ? | Trois rôles schéma / exécution / lecture (§ 3.5). | ✔ Retenue. |
| D19 | Exclusion d'une IP après trop d'échecs ? | Sauf machine connue (§ 4) ; seuil : 20 échecs en 10 min, exclusion de 15 min, 1 h, puis 24 h. | ✔ Retenue (seuils compris). |
| D20 | Exemption de l'adresse ou de la requête ? | De la requête qui présente un jeton de machine connue (§ 4). | ✔ Retenue : le jeton. |
| D21 | Comptage par base ou global ? | Global à l'installation. | ✘ Autrement : **par base** (société). |
| D22 | Clé du `.env` générée à la compilation ? | Non : à l'installation, rangée par le système. | ✘ Autrement : **deux clés**, celle du `.env` dans les binaires, celle des données créée à l'installation (§ 3.6). |
| D23 | Démonstration hors ligne ? | Profil choisi comme aujourd'hui, droits appliqués à l'affichage seulement. | ✔ Retenue. |
| D24 | Conservation des journaux et des adresses IP ? | Technique : 30 jours ; audit : 1 an ; adresses des sessions : 6 mois ; purge nocturne par base. | ✔ Retenue. |
| D25 | Distribution : chaque installation compile-t-elle son serveur, ou des binaires tout faits sont-ils fournis ? | Compilation sur place ; à défaut, clé du `.env` générée à l'installation. | ✔ **Binaires fournis** ; le chiffrement du `.env` écarte les curieux en interne et garde le `.env` lisible sur une autre machine (copie, sauvegarde, dépannage) : clé commune aux binaires fournis (§ 3.6). |
| D26 | Révocation : délai de 5 min acceptable, ou fermeture immédiate ? | Fermeture immédiate : sessions révoquées en mémoire par base, consultées à chaque appel (sans lecture de la base). | ✔ Retenue. |
| D27 | Un administrateur peut-il usurper un autre administrateur ? | Non (droits égaux, sans intérêt pour un test, et traces brouillées). | ✔ Retenue. |
| D28 | Clé du `.env` avec des binaires fournis tout faits (D25) ? | Générée par l'installeur, protégée par le système. | ✘ Autrement : un `.env` **fourni est conservé** ; sinon l'installeur crée une configuration neuve (§ 3.6). |
| D29 | Un réglage de déploiement (`LOGIBTP_DEPLOIEMENT` = `LOCAL` ou `INTERNET`) fixe-t-il les valeurs par défaut de sécurité ? | Oui (§ 10.3) ; chaque valeur reste modifiable. | ✔ Retenue. |
| D30 | Double facteur en réseau local et via TSE ? | Facultatif depuis les adresses de confiance, obligatoire depuis internet pour ADMIN et la gestion des droits, proposé aux autres. | ✔ Retenue (le réseau local et le TSE sont réputés sûrs). |
| D31 | Accès du prestataire chez ses clients ? | Compte nominatif (ADMIN, double facteur obligatoire, validité limitée, désactivable par le client), jamais de compte partagé. | ✔ Retenue. |
| D32 | Politique de sécurité du contenu (CSP) : quelle option ? | Option C (§ 10.4) : scripts du domaine seulement, après sortie des deux scripts en ligne de `client/index.html`, d'abord en mode rapport. | ✔ Retenue. |
| D33 | Limites de débit ? | Tableau du § 10.5. | ✔ Retenue. |

## 9. Découpage en lots proposé

| Lot | Contenu | Prérequis |
|---|---|---|
| 1 | Modèle de droits (arbre, actions, portée, héritage), calcul répliqué JS / C#, reprise de `droit_document`, `droit_fiche`, `crm_droit`, refus par défaut et métadonnées des routes, écran des profils ; profil de saisie mobile par défaut | — |
| 2 | Montants de validation, transformation, usurpation, RGPD (envoi, déverrouillage, recherche) | 1 |
| 3 | JWT d'accès et rafraîchissement rotatif, liste des sessions, machines connues, double facteur par courriel, exclusion d'IP, identifiants API, borne en identifiant d'appareil | 1 |
| 4 | Journal technique et d'audit, masquage ; rôles PostgreSQL, clés du `.env` et des données, commande de mise à jour (avec le module d'installation) ; construction de production du client | 1 |

## 10. Déploiement : réseau local et internet

Objectif : un logiciel open source déployable sur un serveur public avec un bon rapport bénéfice / risque, pas une
forteresse. Le code étant public, la sécurité ne repose jamais sur le secret du code mais sur les clés de chaque
installation, le contrôle par le serveur et une exposition réduite.

### 10.1 Deux situations

| | Réseau local (distants par TSE) | Internet (serveur public) |
|---|---|---|
| Qui atteint le serveur | Postes du réseau et serveur TSE | Tout le monde, robots compris |
| Menace principale | Poste compromis, salarié curieux, écoute du réseau (HTTP en clair) | Essais de mots de passe automatisés, failles connues non corrigées, XSS, vol de session |
| Adresse IP vue | Postes ; **tous les distants derrière l'adresse du serveur TSE** | Adresses publiques, NAT d'opérateur mobile, proxy |
| « Machine » | Navigateur du profil Windows de l'utilisateur (sur le TSE : une par utilisateur, si le profil est conservé) | Navigateur |

### 10.2 Ce que le plan couvre déjà, et ce qui manque

**Couvert (suffisant pour les deux situations)** : contrôle des droits par le serveur et refus par défaut (§ 3.3),
mots de passe longs hachés (PBKDF2), verrouillage par compte et exclusion d'IP (§ 4), jetons hachés en base et
rotation (§ 3.1), révocation immédiate (D26), cookies HttpOnly SameSite=Strict, rôles PostgreSQL séparés (§ 3.5),
journaux sans secrets (§ 3.7), modes de développement refusés hors environnement Development (lot 1
d'authentification).

**Manques constatés dans le code actuel** (à traiter avant une exposition sur internet) :

1. ✔ **Fichiers de la GED affichés en ligne dans l'origine de l'application** (`ServiceGed` : `Content-Disposition:
   inline` avec le type MIME déposé ; aperçu `modules/ged/js/ui/apercu.js` dans une `iframe` sans `sandbox`). Un
   fichier HTML ou SVG déposé (ou reçu par courriel et rangé dans la GED) exécute son script avec la session de
   celui qui l'ouvre : **XSS stocké**. Correction : `inline` seulement pour une liste blanche (PDF, images matricielles,
   texte brut), `attachment` pour tout le reste (SVG et HTML compris), en-tête `X-Content-Type-Options: nosniff`,
   `Content-Security-Policy: sandbox` sur les réponses de contenu, `iframe` de l'aperçu en `sandbox`.
2. ✔ **HTML saisi ou reçu** : libellés HTML à variables, textes de l'édition, rédacteur, courriels reçus. **Aucun
   script dans un HTML** : assainisseur par liste blanche de balises et d'attributs, répliqué JS / C# (jeu de cas),
   appliqué à l'enregistrement (serveur) et à l'affichage (client) ; retirés : `<script>`, `<iframe>`, `<object>`,
   `<embed>`, `<form>`, `<base>`, `<meta>`, attributs `on*`, URL `javascript:` et `data:` hors images, `<style>` et
   `style` limités aux propriétés de mise en forme ; les variables `{{…}}` sont échappées à l'insertion (déjà le cas
   pour `{{lig_libelle_html}}`). Un courriel reçu s'affiche dans une `iframe` `sandbox` sans script.
3. **En-têtes de sécurité absents** : ni HSTS, ni CSP, ni `nosniff`, ni `frame-ancestors` ; options au § 10.4.
4. ✔ **Requêtes entre sous-domaines** : une société = un sous-domaine, et pour le navigateur tous les sous-domaines
   sont le **même site** : SameSite=Strict ne bloque pas une requête de `a.exemple.fr` vers `b.exemple.fr`.
   Le cookie reste propre à son sous-domaine (bien), mais une page piégée sur un sous-domaine peut envoyer des
   écritures vers un autre. Correction peu coûteuse : refuser toute requête d'écriture dont l'en-tête `Origin` n'est
   pas l'hôte lui-même.
5. ✔ **CORS** : la politique autorise `http://localhost:5173` en dur ; origines permises en paramètre
   (`LOGIBTP_CORS_ORIGINES`, vide par défaut : même origine seulement).
6. ✔ **Limitation de débit** : aucune ; limites proposées au § 10.5.
7. ✔ **Proxy** : `UseForwardedHeaders` absent ; sans lui l'exclusion d'IP voit l'adresse du proxy (tout le monde exclu
   d'un coup), et mal réglé chacun se donne l'adresse voulue ; réglage au § 10.7.
8. **Code exécuté sur le serveur** : modèles d'édition (Jint) et SELECT saisis : modification réservée à un droit de
   paramétrage, Jint borné (durée, mémoire, récursion, aucun accès .NET), SELECT sous le rôle lecture avec délai.

### 10.3 Réglage de déploiement (D29, ✔)

Un réglage `LOGIBTP_DEPLOIEMENT` (`LOCAL` ou `INTERNET`) dans le `.env` fixe les valeurs par défaut, chacune
modifiable :

| Mesure | LOCAL (TSE) | INTERNET | Bénéfice / coût |
|---|---|---|---|
| HTTPS | **Indispensable** (certificat interne ou Let's Encrypt par DNS) | **Indispensable**, HSTS | Sans lui, jetons et mots de passe circulent en clair ; coût faible |
| Certificat des sous-domaines | Joker `*.domaine` (DNS interne) | Joker `*.domaine` par défi DNS (Let's Encrypt) | Une base par société impose le joker ; à prévoir dans l'installeur |
| Double facteur par courriel | Facultatif depuis les adresses de confiance (D30) | Obligatoire pour ADMIN et la gestion des droits, proposé aux autres | Le plus efficace contre les mots de passe volés |
| Adresses de confiance | Réseau local et **serveur TSE** dans la liste jamais exclue | Aucune par défaut | Sur TSE, une exclusion bloquerait tous les distants |
| Exclusion d'IP | Active (adresses de confiance exemptées) | Active | Coût nul |
| Durée de session | 1 jour, 7 jours sur machine connue | Idem | — |
| Borne | Réseau local seulement (adresses permises) | Adresses permises conseillées | PIN court : à ne pas exposer sans besoin |
| Base de données | Écoute locale ou réseau privé | Écoute locale uniquement, jamais publique | Coût nul |
| Ports ouverts | Réseau interne | 443 seulement (80 → redirection), API derrière le proxy | Coût nul |

### 10.4 En-têtes de sécurité et politique de contenu (D32, ✔ option C)

En-têtes sans risque, posés par l'application (valables aussi sans proxy, en réseau local) : `Strict-Transport-Security`
(HTTPS seulement, `max-age` d'un an), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
`Permissions-Policy` (caméra, micro, géolocalisation fermés sauf besoin de la borne), `Content-Security-Policy:
frame-ancestors 'self'` (pas d'intégration dans un site tiers). Pour la CSP elle-même :

| Option | Contenu | Gain | Coût |
|---|---|---|---|
| A. Pas de CSP | En-têtes ci-dessus seulement | Aucun contre le XSS | Nul |
| B. CSP permissive | `script-src 'self' 'unsafe-inline'` | Faible : bloque seulement les scripts d'un autre site | Nul |
| **C. CSP stricte des scripts** (proposée) | `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'` | **Fort** : un script injecté malgré l'assainisseur ne s'exécute pas | Sortir en fichiers les deux scripts en ligne de `client/index.html` (thème, aperçu au rechargement) ; le client n'utilise ni `eval` ni `new Function` (vérifié) ; styles en ligne gardés (`'unsafe-inline'` en style, risque faible) |
| D. CSP à nonces | Comme C, scripts en ligne gardés avec un nonce par réponse | Égal à C | `index.html` réécrit par le serveur à chaque réponse, pas d'intérêt face à C |

Mise en place : d'abord en `Content-Security-Policy-Report-Only` avec remontée des violations au journal technique,
puis en mode bloquant quand le journal est vide. Les éditions (aperçu SVG), l'aperçu de la GED (`blob:`) et les
polices livrées restent dans `'self'`.

### 10.5 Limites de débit (D33, ✔)

Limiteur d'ASP.NET (`AddRateLimiter`, fenêtre glissante) par société ; les adresses de confiance (réseau local, TSE)
sont comptées par session et non par adresse, pour ne pas mettre tous les distants dans le même compteur.

| Route | Clé | Limite proposée | Au-delà |
|---|---|---|---|
| `POST /api/auth/connexion` | Adresse | 10 par minute (en plus des 5 échecs par compte et de l'exclusion à 20 échecs en 10 min) | 429, délai indiqué |
| `POST /api/auth/oubli`, `/reinitialiser` | Adresse | 5 par heure (en plus des 3 demandes par heure et par compte) | 429 |
| Rafraîchissement du jeton | Session | 10 par minute | 429 |
| Code du double facteur | Compte | 5 essais par code, 3 envois par heure | Code annulé, nouvel envoi |
| Borne : PIN | Salarié | 5 échecs → 15 min de blocage du salarié sur toutes les bornes | Message à la borne |
| Borne : appels | Appareil | 60 par minute | 429 |
| API, session ouverte | Session | 600 par minute (10 par seconde en moyenne, rafales de 50) | 429 |
| Identifiant API | Identifiant | 300 par minute (paramétrable par identifiant) | 429 |
| Éditions PDF, exports, imports | Session | 2 traitements simultanés | File d'attente |
| Taille des requêtes | — | JSON 10 Mo ; dépôt de la GED : 100 Mo par fichier (paramètre) | 413 |
| Diffusion temps réel (SSE) | Session | 5 connexions ouvertes | 429 |

Au proxy (internet) : limite globale par adresse pour toute l'installation (par exemple 50 requêtes par seconde),
qui couvre aussi le comptage par base (D21).

### 10.6 Prérequis DNS et certificat

- **Nom de domaine** propre à l'installation (`logibtp.exemple.fr`) ; chaque société est un sous-domaine
  (`societe.logibtp.exemple.fr`).
- **DNS** : enregistrement joker `*.logibtp.exemple.fr` vers le serveur (réseau local : DNS interne ou serveur DNS de
  l'Active Directory ; internet : DNS public). Sans joker, une entrée par société à créer à chaque nouvelle société.
- **Certificat** joker `*.logibtp.exemple.fr` : sur internet, Let's Encrypt par **défi DNS** (le seul qui délivre un
  joker ; il faut un fournisseur DNS doté d'une API, OVH, Cloudflare, Infomaniak…), renouvelé tous les 60 jours par
  le proxy (Caddy le fait seul) ou par l'installeur ; en réseau local, autorité de certification interne (Active
  Directory) ou le même certificat Let's Encrypt si le domaine est public, déployé sur les postes et le TSE.
- **HTTPS partout**, même en réseau local : cookies `Secure`, HSTS seulement sur internet (en local, un certificat
  expiré bloquerait tout le monde).
- Le développement garde `*.localhost` (aucun certificat).

### 10.7 Proxy inverse et adresses

- Internet : proxy (Caddy, nginx ou IIS) qui termine le HTTPS et transmet à l'API sur l'adresse locale ; ports 443
  (et 80 pour la redirection) seuls ouverts.
- Réglage `LOGIBTP_PROXYS` (adresses des proxys déclarés) : l'API lit `X-Forwarded-For`, `X-Forwarded-Proto` et
  `X-Forwarded-Host` (`UseForwardedHeaders`) **seulement** depuis ces adresses ; vide = aucun proxy, adresse de la
  connexion. L'exclusion d'IP, les limites de débit et les journaux utilisent l'adresse ainsi obtenue.
- Le sous-domaine (donc la société) vient de l'en-tête `Host` transmis : le proxy ne doit accepter que les hôtes du
  domaine de l'installation.

### 10.8 TSE : points particuliers

- **Réseau réputé sûr** : le réseau local et le TSE sont des adresses de confiance (pas d'exclusion d'IP, double
  facteur facultatif, D30) ; le verrouillage par compte reste actif.
- **Machines connues** : le jeton est un cookie du profil Windows de l'utilisateur sur le TSE (profils conservés).
- **Poste partagé** : sur le TSE, chaque utilisateur a sa propre session Windows, donc ses cookies ; rien à faire.
- L'application ne doit être joignable que depuis le réseau local et le TSE : pare-feu, pas d'ouverture vers
  internet ; le TSE lui-même doit avoir sa propre protection (passerelle RD, double facteur Windows), hors du
  périmètre de LogiBTP.

### 10.9 Exploitation (binaires fournis, D25)

- **Versions signées** et somme de contrôle publiée ; procédure de mise à jour par l'installeur (sauvegarde, arrêt,
  scripts SQL sous le rôle schéma, redémarrage).
- **Dépendances** : `npm audit` et `dotnet list package --vulnerable` dans la construction des versions ; le
  rapport `DEPENDANCES.md` existe déjà pour l'inventaire.
- **Correctifs de sécurité** publiés rapidement et signalés aux prestataires ; politique de signalement des failles
  (`SECURITY.md` du dépôt).
- **Sauvegardes** chiffrées, clé des données sauvegardée à part (sa perte rend les données chiffrées illisibles).
- **Prestataire** : un compte nominatif par intervenant chez chaque client, jamais de compte commun (D31).

### 10.10 Priorités

| Priorité | Mesures | Pourquoi |
|---|---|---|
| Avant toute exposition sur internet | HTTPS et HSTS (§ 10.6), GED en `attachment` + `nosniff` + `sandbox`, HTML sans script, contrôle de l'`Origin`, CORS en paramètre, limiteur de débit, en-têtes transmis par le proxy, contrôle des droits par le serveur (lot 1) | Failles exploitables à distance sans compte ou avec un compte quelconque |
| Lot 3 des droits | JWT et rafraîchissement rotatif, machines connues, double facteur par courriel, exclusion d'IP | Vol de mot de passe et essais automatisés |
| Avec le module d'installation | Rôles PostgreSQL, clés, réglage de déploiement, certificats, pare-feu | Limiter les dégâts d'une faille |
| Ensuite | TOTP, contrôle des mots de passe divulgués | Gains réels mais moindres |

Hors du rapport bénéfice / risque visé : obscurcissement du code, chiffrement de toute la base, pare-feu applicatif
dédié, détection d'intrusion.
