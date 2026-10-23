# Analyse du module OAuth (connexions à des services externes)

Statut : **analyse validée** (23/10/2026). Décisions au § 8.

## 1. But

Module **séparé et réutilisable** qui obtient, conserve chiffrés et renouvelle les jetons OAuth 2.0 des connexions de
LogiBTP à des services externes. Premier utilisateur : le module Mail (SMTP / IMAP de **Gmail grand public** ;
l'Exchange hébergé OVH reste au mot de passe ; [analyse](ANALYSE-MODULE-MAIL.md)). Utilisateurs envisagés ensuite : stockage en ligne (OneDrive,
SharePoint, Google Drive), agenda, plateformes de facturation électronique, API de logiciels comptables ou bancaires,
API publiques à jeton (entreprises, géocodage).

Le module **ne remplace pas** l'authentification des utilisateurs dans LogiBTP (module Authentification : session par
cookie ; un fournisseur d'identité de l'entreprise en OpenID Connect est un autre sujet, lot 2 de l'Authentification).
Il ne sert qu'aux connexions **sortantes** de l'application.

## 2. Principes

- **Sans métier** : le module connaît des fournisseurs, des connexions, des jetons, des portées et des échéances ; il
  ignore à quoi sert la connexion. Le module consommateur (Mail…) la désigne par son identifiant et demande un jeton
  valable.
- **Aucune dépendance entre modules** : le socle définit le contrat `IFournisseurJeton`
  (`Task<JetonAcces> JetonAsync(long connexion, CancellationToken)` ; erreur typée `CONNEXION_A_RECONNECTER`) ; le
  module OAuth l'implémente ; le module Mail ne connaît que le contrat du socle. Le cœur branche les deux
  (`Program.cs`).
- **Le mot de passe reste possible** : c'est le consommateur qui choisit, compte par compte, entre mot de passe (dans
  son propre bloc chiffré) et connexion OAuth ; un compte passe de l'un à l'autre sans être recréé (« Passer en
  OAuth 2.0 »), le mot de passe est effacé une fois la connexion OAuth vérifiée.
- **Tout ce qui identifie ou ouvre l'accès est chiffré** (`Chiffrement` du socle, valeurs `chiffre:v1:`) : jetons,
  secret ou certificat du client, identifiant du client, locataire, **compte connecté (adresse)**. En clair : un
  **nom d'usage** (alias) choisi dans l'application, le fournisseur, l'état, les portées et les **dates d'échéance**
  (nécessaires aux rappels, non sensibles).
- **Une base par société** : connexions, renouvellement de fond et rappels par base.

## 3. Fournisseurs et flux

| Fournisseur | Flux | Usage typique | Échéances à surveiller |
|---|---|---|---|
| **Google (Gmail grand public, `@gmail.com`)** — lot 1 | **Authorization code + PKCE** : le propriétaire de la boîte se connecte une fois depuis l'application ; application Google « externe » déclarée par l'installation | boîtes système sur des adresses Gmail | jeton de rafraîchissement : **7 jours** tant que l'application Google est en mode test (non vérifiée), sinon sans échéance fixe mais perdu après 6 mois d'inactivité, un changement de mot de passe Google ou un retrait de l'accès |
| Microsoft Entra ID (Microsoft 365) | **Client credentials** (application, sans utilisateur) : secret ou certificat | boîtes système (`noreply@`, `commercial@`) en SMTP / IMAP | secret du client (date fixée dans Entra, 24 mois au plus) ; certificat (date du certificat) |
| Microsoft Entra ID | **Authorization code + PKCE** (délégué, au nom d'un utilisateur) | boîtes des utilisateurs (second temps du Mail) | jeton de rafraîchissement : glissant, perdu après une inactivité ou une révocation (changement de mot de passe, consentement retiré, stratégie d'accès conditionnel) |
| Google Workspace (plus tard) | Compte de service avec délégation sur le domaine, ou authorization code + PKCE | boîtes système ou utilisateur | clé du compte de service (rotation recommandée) ; jeton de rafraîchissement (application en mode test : 7 jours) |
| Générique OAuth 2.0 / OpenID Connect | Client credentials ou authorization code + PKCE, points de terminaison saisis ou découverts (`.well-known`) | autres API | celles déclarées par l'administrateur, celles renvoyées par le serveur (`expires_in`, `refresh_token_expires_in`) |

Le jeton d'accès (une heure environ) est renouvelé seul, sans rappel. Les rappels portent sur ce qui exige une
**personne** : secret ou certificat du client à renouveler, jeton de rafraîchissement dont l'échéance est connue, et
toute connexion passée « à reconnecter » (échec du renouvellement).

## 4. Modèle de données (proposition, `modules/oauth/db/004_oauth.sql`)

`oauth_fournisseur` (`ofo_*`) : modèles de fournisseurs (MICROSOFT, GOOGLE, GENERIQUE) : points de terminaison
d'autorisation et de jeton, portées proposées par usage (`https://outlook.office365.com/SMTP.Send`,
`IMAP.AccessAsUser.All`, `https://mail.google.com/`…). Livrés par le script, complétables.

`oauth_connexion` (`oco_*`)

| Colonne | Rôle |
|---|---|
| `oco_id`, `oco_code` (unique) | identification technique |
| `oco_nom` | **nom d'usage dans l'application** (« Microsoft 365 – Commercial ») ; jamais l'adresse |
| `oco_ofo_id`, `oco_flux` (`CLIENT`, `CODE_PKCE`, `COMPTE_SERVICE`) | fournisseur et flux |
| `oco_portees` | portées demandées (en clair) |
| `oco_client` | **chiffré** : `{ locataire, identifiant_client, secret \| certificat, points de terminaison propres }` |
| `oco_jetons` | **chiffré** : `{ acces, rafraichissement, type }` |
| `oco_compte` | **chiffré** : compte connecté (adresse, identifiant de l'utilisateur chez le fournisseur) |
| `oco_compte_empreinte` | HMAC du compte (clé dérivée de la chaîne de l'installation) : retrouver une connexion déjà faite pour le même compte sans déchiffrer |
| `oco_acces_expire_le` | fin du jeton d'accès (renouvellement anticipé : 5 min avant) |
| `oco_rafraichissement_expire_le` | fin connue ou estimée du jeton de rafraîchissement (nulle si inconnue) |
| `oco_secret_expire_le` | fin du secret ou du certificat du client (saisie ou lue dans le certificat) |
| `oco_etat` | `A_CONNECTER`, `OK`, `A_RECONNECTER`, `DESACTIVEE` |
| `oco_derniere_erreur`, `oco_renouvele_le`, `oco_connecte_le`, `oco_connecte_par` | santé et traçabilité |
| `oco_droits` | profils ou services autorisés à **reconnecter** la connexion (en plus des administrateurs) |
| `oco_utilisateur` | second temps : compte LogiBTP propriétaire d'une connexion déléguée personnelle |

`oauth_rappel` (`ora_*`) : délais de rappel avant échéance (30, 7 et 1 jours par défaut, paramètre global surchargeable
par connexion) et rappels déjà émis (clé de dédoublonnage : connexion, échéance, délai).

`oauth_journal` (`ojo_*`) : connexion, reconnexion, renouvellement en échec, révocation, modification du client,
lecture d'un jeton par un module (agrégée par jour) ; jamais de valeur secrète.

`oauth_autorisation` (`oau_*`, temporaire) : `state`, vérificateur PKCE (chiffré), connexion, utilisateur, expiration
(10 min) : protège le retour du fournisseur.

## 5. Parcours

### 5.1 Créer ou reconnecter une connexion

- **Gmail grand public** (lot 1) : l'administrateur déclare une fois l'application Google de l'installation
  (identifiant et secret du client, chiffrés, portée `https://mail.google.com/`, mode test ou vérifiée), puis
  « Se connecter » sur chaque connexion (flux par code ci-dessous) avec le compte Gmail de la boîte. En mode test,
  l'échéance du jeton de rafraîchissement est posée à la connexion + 7 jours (`oco_rafraichissement_expire_le`) : les
  rappels à 7 et 1 jour et le widget invitent à reconnecter chaque semaine ; la vérification de l'application par
  Google (évaluation de sécurité, portée restreinte) supprime cette contrainte (décision avant la mise en production,
  analyse Mail § 11). Aide pas à pas pour la console Google Cloud (écran de consentement, utilisateurs de test,
  adresse de retour).
- **Client credentials** (boîte système Microsoft 365, plus tard) : l'administrateur saisit le locataire, l'identifiant et le
  secret (ou dépose le certificat) et la date de fin du secret ; « Tester » obtient un jeton ; la connexion passe `OK`.
  Une aide pas à pas rappelle la déclaration côté Entra (application, permissions SMTP / IMAP, accès limité aux boîtes
  voulues par une stratégie d'accès d'application).
- **Authorization code + PKCE** : « Se connecter » ouvre la page du fournisseur dans une fenêtre séparée
  (`app.naviguer(url, { nouvelleFenetre: true })`) ; retour sur `GET /api/oauth/retour` (route publique contrôlée par
  `state`, puis rattachée à la session de l'utilisateur) ; jetons et compte chiffrés ; la fenêtre se ferme et l'écran
  de paramétrage se met à jour (`app.publier`).
- **Reconnecter** : même parcours sur une connexion existante ; si le compte connecté diffère de l'ancien (empreinte),
  confirmation obligatoire (on ne bascule pas une boîte sur une autre par erreur).

### 5.2 Renouvellement

- À la demande : `JetonAsync` renvoie le jeton d'accès s'il vaut encore plus de 5 min, sinon le renouvelle (verrou
  par connexion : un seul renouvellement à la fois, même entre plusieurs requêtes ou tâches de fond).
- De fond (`RenouvellementOAuth`, par base, toutes les heures) : renouvelle les jetons de rafraîchissement glissants
  inutilisés depuis longtemps (pour qu'une boîte peu active ne perde pas sa connexion), relève les échéances.
- Échec (révocation, `invalid_grant`, secret expiré) : `A_RECONNECTER`, erreur notée, **notification immédiate**
  aux personnes autorisées ; le consommateur reçoit `CONNEXION_A_RECONNECTER` (le Mail garde ses messages en file,
  § 6 de son analyse).

### 5.3 Rappels avant échéance

- Source de notifications du cœur (`SourceEcheancesOAuth`, `NotificationsBtp.cs`, comme les habilitations) : chaque
  jour, pour chaque connexion active, échéances `oco_secret_expire_le` et `oco_rafraichissement_expire_le` à moins de
  30, 7 puis 1 jour : notification (lien direct « Reconnecter » vers `/parametres/connexions?id=`) aux
  **utilisateurs ayant le droit de reconnecter** (administrateurs et `oco_droits`), dédoublonnée par échéance et délai.
- Le widget « Connexions à reconnecter » de l'accueil liste les connexions `A_RECONNECTER` et celles dont l'échéance
  est à moins de 7 jours (visible des seules personnes autorisées).
- Le paramétrage affiche chaque connexion avec une pastille (vert, orange à moins de 30 jours, rouge à moins de 7 jours
  ou à reconnecter) et ses utilisateurs (comptes de messagerie qui s'en servent : fournis par les consommateurs).

## 6. Écrans et routes

- Page `/parametres/connexions` (administrateur et personnes autorisées en lecture / reconnexion) : liste au format
  des pages de paramétrage (`.tableau-compact`), fiche d'une connexion (fournisseur, flux, portées, client,
  échéances, droits, journal), boutons Tester, Se connecter / Reconnecter, Révoquer.
- Routes `/api/oauth` : `GET connexions`, `GET|PUT connexions/{id}` (le client et les jetons ne sont jamais renvoyés :
  « configuré » / « non configuré »), `POST connexions/{id}/client` (réécrit le bloc chiffré), `POST connexions/{id}/autoriser`
  (adresse de la page du fournisseur), `GET retour` (publique, `state`), `POST connexions/{id}/tester`,
  `POST connexions/{id}/revoquer`.

## 7. Sécurité

- Jetons et secrets jamais journalisés, jamais renvoyés au navigateur, jamais dans une adresse.
- PKCE obligatoire pour le flux par code, `state` à usage unique et de courte durée, adresse de retour fixe par
  installation (déclarée chez le fournisseur ; une par sous-domaine de société ou une commune qui redirige : OA6).
- Portées minimales par usage (Gmail : `https://mail.google.com/`, seule portée qui ouvre IMAP et SMTP ; Microsoft :
  `SMTP.Send` pour l'envoi seul).
- La perte de `LOGIBTP_CLE_CHIFFREMENT` rend toutes les connexions à refaire (même règle que les mots de passe des
  fiches) : à traiter avec le module d'installation (rotation de clé : rechiffrer `oco_client`, `oco_jetons`,
  `oco_compte` et recalculer les empreintes HMAC).

## 8. Questions et décisions

Décisions du 23/10/2026.

| # | Question | Décision |
|---|---|---|
| OA1 | Module séparé ou partie du Mail ? | ✔ Module séparé `modules/oauth` (`LogiBTP.OAuth(.Web)`, `004`), contrat `IFournisseurJeton` dans le socle ; réutilisable par tout module. |
| OA2 | Mot de passe encore possible ? | ✔ Oui, au choix du consommateur compte par compte (Exchange OVH : mot de passe) ; bascule vers OAuth sans recréer le compte. |
| OA3 | Que chiffrer ? | ✔ Jetons, client (locataire, identifiant, secret, certificat), compte connecté ; en clair : nom d'usage, fournisseur, flux, portées, état, dates d'échéance ; empreinte HMAC du compte. |
| OA4 | Délais des rappels | ✔ 30, 7 et 1 jours avant l'échéance (paramètre global, surcharge par connexion) ; échec du renouvellement : immédiat. |
| OA5 | Qui reconnecte ? | ✔ Administrateurs et profils ou services désignés sur la connexion (`oco_droits`), qui reçoivent les rappels ; à rattacher au futur **module de droits**. |
| OA6 | Adresse de retour avec une base par sous-domaine | ✔ Adresse de retour commune à l'installation, qui relaie vers la bonne société par le `state`. |
| OA7 | Bibliothèque | ✔ Google (lot 1) : flux écrits dans le module avec le client HTTP du framework, sans dépendance. Microsoft (plus tard) : `Microsoft.Identity.Client` (MSAL) accepté ; on verra alors si l'on peut s'en passer. |
| OA8 | Révocation à la suppression | ✔ « Révoquer » appelle le point de révocation du fournisseur s'il existe, efface les jetons et passe `DESACTIVEE` ; suppression refusée tant qu'un consommateur l'utilise. |
| OA9 | Premier fournisseur | ✔ **Google, Gmail grand public**, par code + PKCE (premiers clients : Gmail et Exchange OVH, ce dernier au mot de passe). |

## 9. Lots

| Lot | Contenu |
|---|---|
| 1 | Module, contrat du socle, fournisseur **Google** (code + PKCE, application de l'installation, mode test ou vérifiée), adresse de retour commune, test, renouvellement, échéances (7 jours en mode test), rappels et widget, révocation, page `/parametres/connexions` ; utilisé par le lot 1 du Mail |
| 2 | Microsoft (client credentials : secret et certificat ; code + PKCE), compte de service Google Workspace, fournisseur générique |
| Second temps | Connexions personnelles des utilisateurs (boîtes des utilisateurs du Mail) |
