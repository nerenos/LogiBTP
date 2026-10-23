# Conception – Module OAuth

Analyse : [ANALYSE-MODULE-OAUTH.md](ANALYSE-MODULE-OAUTH.md).

## Décisions techniques — session du 23/10/2026

### Principe
- **Module séparé du Mail** : OAuth 2.0 ne gère que des connexions sortantes vers des services externes. Il ignore à quoi sert une connexion ; le consommateur la désigne par son identifiant. Il ne remplace pas la connexion des utilisateurs à LogiBTP (module Authentification).
- **Contrat dans le socle** (`Connexions.cs`) : `IFournisseurJeton` (`JetonAsync`, `ConnexionsAsync`, erreur `CONNEXION_A_RECONNECTER`), implémenté par `ServiceOAuth` ; `IUtilisationsConnexion`, implémenté par les consommateurs (libellés des utilisations, suppression refusée). Aucun module ne dépend d'OAuth : le Mail ne connaît que le contrat.
- **Aucune bibliothèque OAuth** : flux écrits avec `HttpClient`, assertions JWT RS256 signées à la main (`AssertionsOAuth`). Raison : peu de code, aucune dépendance à suivre, comportement testable avec un faux fournisseur (méthodes virtuelles de `ClientOAuth`).

### Sécurité
- Client, jetons, compte connecté et vérificateur PKCE sont chiffrés par `Chiffrement` du socle, jamais renvoyés au navigateur ni journalisés. Le compte est comparé par une empreinte HMAC (`Chiffrement.Empreinte`, ajoutée au socle) ; seul le nom d'usage est affiché.
- **Adresse de retour publique commune à l'installation** (`/api/oauth/retour`, `OAuth:AdresseRetour`) : une seule adresse à déclarer chez le fournisseur. La société voyage dans le `state` (« code.aléatoire »), qui est à usage unique et valable 10 minutes. L'origine de la demande est contrôlée (domaine connu et sous-domaine = société courante, sinon 422 `OAUTH_ORIGINE`) : pas de redirection ouverte.
- Retour refusé si le compte diffère du précédent (empreinte) sans `autre_compte`, ou s'il n'y a pas de jeton de rafraîchissement.

### Flux
- **Lot 1 — code + PKCE (S256)** dans une fenêtre séparée : Google / Gmail grand public en premier (`access_type=offline`, `prompt=consent`). Le mode test de Google limite le jeton de rafraîchissement à 7 jours, d'où une échéance calculée (`FinRafraichissement`).
- **Lot 2 — flux sans utilisateur** : application Microsoft par client credentials, avec secret ou certificat (assertion `client_assertion`, en-tête x5t, fin de validité lue dans le certificat et reprise dans les rappels), et compte de service Google avec délégation sur le domaine (grant jwt-bearer, `sub` = boîte déléguée). Pas de jeton de rafraîchissement : un nouveau jeton est demandé à l'expiration. Un refus définitif (secret ou certificat expiré) fait passer la connexion à `A_RECONNECTER`. Changer de flux impose de révoquer d'abord.
- Fournisseurs : GOOGLE, MICROSOFT (`{locataire}` dans les adresses, délégué ou application) et GENERIQUE (adresses HTTPS saisies dans le client de la connexion).

### Cycle de vie
- Jeton renouvelé s'il expire dans moins de 5 minutes, sous verrou par base et par connexion. Refus définitif → `A_RECONNECTER` et signal URGENT, une seule fois. Fournisseur injoignable → 409 `OAUTH_INDISPONIBLE`, connexion inchangée.
- Passage de fond par base (60 min) : autorisations expirées effacées, connexions renouvelées, rappels avant échéance (30, 7 et 1 jours par défaut, délais propres possibles) émis une fois par connexion, échéance et délai, aux administrateurs et aux titulaires des droits.
- Pastilles : orange à moins de 30 jours, rouge à moins de 7 jours ou à reconnecter (widget `oauth-alertes`).
- Droit de reconnecter : administrateur, ou profil ou service (`service:<code>`) listé dans `oco_droits`, en attendant le futur module de droits. Paramétrage, client, révocation et suppression : administrateur.
