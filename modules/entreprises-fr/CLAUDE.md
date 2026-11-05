# Module Entreprises françaises – contexte

## Rôle
- Recherche dans l'annuaire des entreprises de l'État (API publique Recherche d'entreprises, `https://recherche-entreprises.api.gouv.fr/search`, sans clé, 7 requêtes/s au plus) par nom, SIREN ou SIRET ; correspondance d'un résultat vers une entreprise prête à remplir une fiche (identité, établissement, adresse, dirigeants personnes physiques).
- Pas de base de données : le module ne stocke rien.

## Dépendances
- Dépend de : `@logibtp/socle` (JS, `echapper` ; dictionnaire : textes `entreprises_fr.recherche.*` et icône `entreprises_fr_annuaire` de `js/personnalisation/`), `LogiBTP.Socle` / `LogiBTP.Socle.Web` (C#, `ExceptionMetier`, `JsonCalcul`, `CasPartages`).
- Utilisé par : cœur seulement — `client/src/app/annuaire/annuaire.js` (`creerFournisseurEntreprises()` → service `entreprises` de `application.js`), fiche personne (`client/src/app/fiches/fiche-annuaire.js`, `importerEntreprise()` via `rechercherEntreprise`), `src/LogiBTP.Api/Program.cs` (`AddModuleEntreprisesFr`, `MapModuleEntreprisesFr`). Ne dépend pas du module Annuaire.

## Structure
- `js/src/correspondance.js` : `versEntreprise(r, siret)`, `adresseEtablissement`, `casseNom`, `TRANCHES_EFFECTIF`, `FORMES_JURIDIQUES`.
- `js/src/fournisseurs.js` : `FournisseurEntreprisesApi` (serveur, base `/api/entreprises-fr`), `FournisseurEntreprisesDirect` (navigateur, tests, `per_page` 10), `ErreurEntreprises(statut, code, message)`, `reponse`, `siretCherche`, `URL_API`.
- `js/ui/recherche.js` : `rechercherEntreprise({ fournisseur, recherche, dirigeants })` → dialogue, résout `{ entreprise, dirigeants }` ou `null` ; `js/ui/entreprises.css`.
- `dotnet/LogiBTP.EntreprisesFr.Web/Correspondance.cs` : réplique C# (`VersEntreprise`, `Adresse`, `CasseNom`, `SiretCherche`, `Reponse`, records `Entreprise`, `AdresseEntreprise`, `DirigeantEntreprise`, `ReponseRecherche`).
- `dotnet/LogiBTP.EntreprisesFr.Web/ServiceEntreprisesFr.cs` : `ServiceEntreprisesFr(HttpClient).Rechercher` + `Extensions` (client HTTP 10 s, User-Agent `LogiBTP/0.1`).

## Points de spécialisation
- Fournisseurs interchangeables, même interface : `rechercher(recherche, { page })` → `{ resultats: [entreprise], total, page, pages }`.
- `ServiceEntreprisesFr.Rechercher` est `virtual` (substituable en test).

## Routes HTTP
- `GET /api/entreprises-fr/recherche?q=&page=` → `ReponseRecherche` (JSON snake_case).
- Erreurs (`ExceptionMetier`) : 422 `RECHERCHE` (< 3 caractères), 503 `INDISPONIBLE`, 429 `LIMITE`, 502 `HTTP` (JS direct : statut de l'API).

## Règles répliquées JS / C# et jeux de cas
- Correspondance `correspondance.js` ↔ `Correspondance.cs`, jeu `tests/cas/01_correspondance.json` (entreprise fictive BATI CONFLUENCE, `resultat` + `cas[{ nom, siret, attendu }]`) :
  - établissement = celui du SIRET cherché (siège ou `matching_etablissements`), sinon le siège ;
  - adresse détaillée (numéro, indice, type et libellé de voie, complément ; cedex prioritaire) ou adresse sur une ligne découpée avant le code postal ;
  - état `A` sinon `F` ; effectif et forme juridique par les tables INSEE (code inconnu → libellé null) ; `service_public` = `est_service_public` ou `est_administration` ;
  - dirigeants : personnes physiques seulement, nom et premier prénom en casse de nom propre (`casseNom`).

## Conventions et pièges
- Le serveur relaie l'API (pas d'appel direct depuis le navigateur dans l'application ; `FournisseurEntreprisesDirect` sert aux tests).
- Côté fiche (cœur) : doublon détecté par `annuaire.parSiret`, adresse ajoutée en coordonnée `ADRESSE` (usage `SIEGE` ou `PRINCIPALE`), service public → `fe_plateforme` Chorus Pro, dirigeants cochés créés comme contacts.
- Toute évolution de la correspondance : modifier les deux, mettre à jour le jeu de cas.

## Tests
- `npm test --workspace modules/entreprises-fr/js` (vitest : jeu partagé, `casseNom`, fournisseur direct avec `fetch` simulé).
- `dotnet test modules/entreprises-fr/dotnet/LogiBTP.EntreprisesFr.Tests` (ou `dotnet test LogiBTP.slnx`).
