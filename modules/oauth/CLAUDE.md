# Module OAuth – contexte

## But
Connexions sortantes de l'application à des services externes par OAuth 2.0 : client et jetons chiffrés, autorisation par code + PKCE ou flux sans utilisateur, jeton d'accès valable fourni aux autres modules, renouvellement, rappels avant échéance, révocation, journal. Ne remplace pas la connexion des utilisateurs (module Authentification).

## Contraintes absolues
- Sans métier : ignore à quoi sert une connexion. Exposé uniquement par le contrat du socle `IFournisseurJeton` (`socle/dotnet/LogiBTP.Socle.Web/Connexions.cs`) ; les consommateurs implémentent `IUtilisationsConnexion`. Aucun module ne dépend de celui-ci.
- .NET : `LogiBTP.OAuth` sans dépendance ; `LogiBTP.OAuth.Web` → Socle, Socle.Web, EF Core Npgsql. Aucune bibliothèque OAuth ni JWT : `HttpClient` et `AssertionsOAuth`.
- Client, jetons, compte connecté et vérificateur PKCE chiffrés par `Chiffrement` : jamais renvoyés au navigateur, jamais journalisés. Compte comparé par empreinte HMAC ; seul le nom d'usage s'affiche ; adresse du compte lue par un administrateur seulement, journalisée.
- Route `/retour` publique et commune à l'installation : société lue dans le `state` (usage unique, 10 min) ; origine de la demande contrôlée (422 `OAUTH_ORIGINE`), jamais de redirection ouverte.
- Erreurs : `CONNEXION_A_RECONNECTER` (refus définitif, connexion `A_RECONNECTER`), `OAUTH_INDISPONIBLE` (fournisseur injoignable, connexion inchangée), `CONNEXION_FLUX`, `CONNEXION_UTILISEE`.
- Droits : reconnecter = administrateur, ou profil / `service:<code>` dans `oco_droits` ; paramétrage, client, révocation, suppression = administrateur.
- Script SQL rejouable, pas de migrations EF.

## État actuel
- **Flux** : `CODE_PKCE` (Google, Microsoft délégué), `CLIENT` (application Microsoft : secret ou certificat PKCS#12 avec clé privée, fin de validité = `oco_secret_expire_le`), `COMPTE_SERVICE` (Google, délégation sur le domaine). Fournisseurs GOOGLE, MICROSOFT, GENERIQUE (adresses HTTPS saisies).
- **Base** `db/004_oauth.sql` : `oauth_fournisseur`, `oauth_connexion` (`oco_*`, états A_CONNECTER / OK / A_RECONNECTER / DESACTIVEE), `oauth_parametre` (`rappels_jours` [30, 7, 1]), `oauth_rappel`, `oauth_journal`, `oauth_autorisation`.
- **Règles** (`LogiBTP.OAuth`) : `ReglesOAuth` (PKCE, state, URL d'autorisation, réponse de jeton, compte de l'id_token, fin du rafraîchissement, pastilles, rappels dus) ; `AssertionsOAuth` (assertion client par certificat, assertion du compte de service, vérification).
- **Web** : `ClientOAuth` (échanges avec le fournisseur, méthodes virtuelles pour les tests), `ServiceOAuth` (paramétrage, autorisation, `TerminerAsync`, `ConnecterAsync`, `JetonAsync` sous verrou — renouvelé à moins de 5 min —, test, révocation, suppression, `PasserAsync`), `RenouvellementOAuth` (passage de fond par base, 60 min : `OAuth:IntervalleMinutes`, `OAuth:Actif`), `SpecialisationOAuth` (`ServicesAsync`, `DestinatairesAsync`, `SignalerAsync`), `Extensions` (`AddModuleOAuth<T>`, `MapModuleOAuth`, `RouteRetour`).
- **Cœur** : `Btp/OAuthBtp.cs`, page `/parametres/connexions` (bouton « Se connecter », aide Microsoft), widget `oauth-alertes`.

## Routes (`/api/oauth`)
`GET /fournisseurs`, `GET /connexions`, `GET /alertes`, `POST /connexions`, `GET|PUT|DELETE /connexions/{id}`, `POST /connexions/{id}/client` (champs vides = inchangés, jamais relus), `POST /connexions/{id}/autoriser` { autre_compte }, `POST /connexions/{id}/connecter`, `POST /connexions/{id}/tester`, `POST /connexions/{id}/revoquer`, `GET /connexions/{id}/compte`, `GET /connexions/{id}/journal`, `GET|PUT /parametres`, `POST /passer` ; publique : `GET /retour?state=&code=&error=` (redirige vers `<origine>/parametres/connexions?id=&oauth=ok|erreur`).

## Tests
`dotnet test modules/oauth/dotnet/LogiBTP.OAuth.Tests` (règles, assertions ; parcours complet avec un faux fournisseur si `LOGIBTP_TEST_PG` désigne une base où `004` est chargé). Essai réel : `LOGIBTP_TEST_MAIL_GOOGLE_*` du `.env` ; Microsoft : locataire de test à venir.

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Module OAuth (`modules/oauth/CLAUDE.md`, [analyse](documentation/conception/ANALYSE-MODULE-OAUTH.md)) : connexions sortantes OAuth 2.0 (Google / Gmail grand public par code + PKCE au lot 1), client, jetons et compte chiffrés, nom d'usage seul affiché, adresse de retour publique commune (`/api/oauth/retour`, société dans le state), renouvellement et rappels d'échéance par base aux personnes autorisées (droits : profils ou `service:<code>`), page `/parametres/connexions` ; fourni aux autres modules par le contrat `IFournisseurJeton` du socle.
