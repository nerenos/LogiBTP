# Module OAuth – contexte

## Rôle
- Connexions **sortantes** de l'application à des services externes par OAuth 2.0 ([analyse](../../documentation/conception/ANALYSE-MODULE-OAUTH.md)) : client du fournisseur et jetons chiffrés, autorisation par code + PKCE dans une fenêtre séparée, jeton d'accès valable fourni aux modules, renouvellement, rappels avant échéance, révocation, journal. Ne remplace pas la connexion des utilisateurs à LogiBTP (module Authentification).
- Sans métier : ignore à quoi sert une connexion ; le consommateur (module Mail) la désigne par son identifiant.

## Dépendances
- .NET : `LogiBTP.OAuth` (règles pures, sans dépendance), `LogiBTP.OAuth.Web` → `LogiBTP.Socle`, `LogiBTP.Socle.Web`, EF Core Npgsql ; aucun autre paquet (flux écrits avec `HttpClient`). Pas de paquet JS (page dans le client).
- Contrat du socle (`socle/dotnet/LogiBTP.Socle.Web/Connexions.cs`) : `IFournisseurJeton` (`JetonAsync`, `ConnexionsAsync`, code d'erreur `CONNEXION_A_RECONNECTER`) implémenté par `ServiceOAuth` ; `IUtilisationsConnexion` implémenté par les consommateurs (libellés des utilisations, suppression refusée). Aucun module ne dépend de celui-ci.
- Utilisé par : cœur (`Program.cs` : `AddModuleOAuth<SpecialisationOAuthBtp>(Base, section OAuth)`, `api.MapModuleOAuth()`, route publique `Extensions.RouteRetour` ; `Btp/OAuthBtp.cs` ; client : `pages/parametres-connexions.js`, widget `oauth-alertes`).

## Structure
- `db/004_oauth.sql` (rejouable) : `oauth_fournisseur` (GOOGLE livré : points de terminaison, portées `openid email https://mail.google.com/`, paramètres `access_type=offline`, `prompt=consent`, durée de 7 jours en mode test), `oauth_connexion` (`oco_*` : nom d'usage, flux, portées, mode test, `oco_client` / `oco_jetons` / `oco_compte` chiffrés, `oco_compte_empreinte` HMAC, échéances, état A_CONNECTER / OK / A_RECONNECTER / DESACTIVEE, droits `TEXT[]` : profils ou `service:<code>`, délais de rappel propres), `oauth_parametre` (`rappels_jours` [30, 7, 1]), `oauth_rappel` (rappels émis), `oauth_journal`, `oauth_autorisation` (state à usage unique, vérificateur PKCE chiffré, origine, `oau_autre_compte`, 10 min).
- `LogiBTP.OAuth/ReglesOAuth.cs` : `NouveauPkce` / `Defi` (S256), `NouveauState(societe)` / `SocieteDuState` (« code.aléatoire », « _ » = base principale), `UrlAutorisation`, `LireReponseJeton` (→ `ReponseJeton`, `ErreurOAuth` : `AReconnecter` pour invalid_grant / invalid_client / unauthorized_client), `CompteDeIdToken` (email, preferred_username, upn), `FinRafraichissement` (durée renvoyée, sinon mode test), `Pastille` / `PastilleConnexion` (orange < 30 j, rouge < 7 j ou à reconnecter), `DelaiAtteint` / `RappelsDus` (plus petit délai atteint, 0 si dépassée ; délais antérieurs à la connexion ignorés).
- `LogiBTP.OAuth.Web` : `Donnees.cs` (entités, `OAuthDbContext`), `ClientOAuth.cs` (échange du code, renouvellement, révocation ; méthodes virtuelles pour les tests ; `{locataire}` dans les URL), `SpecialisationOAuth.cs` (`ServicesAsync`, `DestinatairesAsync`, `SignalerAsync` ; `SignalOAuth`), `ServiceOAuth.cs` (paramétrage, client, autorisation, `TerminerAsync`, `JetonAsync` sous verrou par base et connexion, test, révocation, suppression, `PasserAsync`), `RenouvellementOAuth.cs` (`BackgroundService` par base), `Extensions.cs` (DI, routes, `Origine`).

## Routes HTTP (préfixe `/api/oauth`)
- `GET /fournisseurs` ; `GET /connexions` (visibles : administrateur toutes, sinon celles qu'on peut reconnecter) ; `GET /alertes` (pastille orange ou rouge) ; `POST /connexions`, `GET|PUT|DELETE /connexions/{id}` (administrateur ; suppression refusée si utilisée : 409 `CONNEXION_UTILISEE`) ; `POST /connexions/{id}/client` { identifiant_client, secret (vide = inchangé), locataire, secret_expire_le } (jamais relu) ; `POST /connexions/{id}/autoriser` { autre_compte } → { url } ; `POST /connexions/{id}/tester` ; `POST /connexions/{id}/revoquer` ; `GET /connexions/{id}/compte` (administrateur, journalisé) ; `GET /connexions/{id}/journal` ; `GET|PUT /parametres` (rappels globaux, adresse de retour) ; `POST /passer` (administrateur : passage de fond immédiat).
- `GET /retour?state=&code=&error=` : **publique**, adresse commune à l'installation (`OAuth:AdresseRetour`, défaut `http://localhost:5173/api/oauth/retour`) ; société lue dans le state, portée `CreerPorteeSociete`, puis redirection vers `<origine>/parametres/connexions?id=&oauth=ok|erreur&message=`.

## Règles
- Chiffré par `Chiffrement` du socle : client, jetons, compte connecté, vérificateur PKCE ; jamais renvoyés au navigateur ni journalisés. En clair : nom d'usage, fournisseur, flux, portées, état, échéances, droits.
- Origine de l'autorisation (en-tête Origin, sinon hôte) : hôte d'un des `Societes:Domaines` et sous-domaine = société courante, sinon 422 `OAUTH_ORIGINE` (pas de redirection ouverte).
- Retour : state inconnu ou expiré refusé ; compte différent du précédent (empreinte) refusé sans `autre_compte` ; sans jeton de rafraîchissement : refusé.
- Jeton : renouvelé s'il expire dans moins de 5 minutes ; refus définitif du fournisseur → `A_RECONNECTER`, signal URGENT immédiat (une fois, connexion qui était OK), 409 `CONNEXION_A_RECONNECTER` ; fournisseur injoignable → erreur notée, 409 `OAUTH_INDISPONIBLE`, connexion inchangée.
- Passage de fond (60 min, `OAuth:IntervalleMinutes`, `OAuth:Actif`) : autorisations expirées effacées ; connexions OK renouvelées si le jeton expire ou n'a pas été renouvelé depuis un jour ; rappels dus signalés une fois par (connexion, échéance, date, délai) aux administrateurs et titulaires des droits.
- Droit de reconnecter : administrateur, profil ou service de l'utilisateur dans `oco_droits` (à reprendre par le futur module de droits) ; paramétrage, client, révocation, suppression : administrateur.

## Tests
- `dotnet test modules/oauth/dotnet/LogiBTP.OAuth.Tests` : règles ; parcours complet avec un faux fournisseur si `LOGIBTP_TEST_PG` désigne une base où `004` est chargé.
- Essai réel : boîte Gmail de test et application Google (`LOGIBTP_TEST_MAIL_GOOGLE_*` du `.env`), adresse de retour déclarée chez Google.
