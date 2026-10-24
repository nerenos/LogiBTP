# Module Sous-traitance – contexte

## Rôle
- Pièces exigées des sous-traitants et des marchés de sous-traitance ([analyse](../../documentation/conception/ANALYSE-MODULE-SOUS-TRAITANCE.md) § 5.3, ST12, ST13, ST18) : liste paramétrable, ajustements par élément (pièce ajoutée ou dispensée, motif), conformité d'un marché ou d'un sous-traitant, pièces bloquantes par action (commande, facture, paiement).
- Les documents (appels d'offres, commandes, factures : famille T du module Document) et les marchés (table `marche` de sens ST) sont tenus par le cœur ; ce module ne les connaît que par sa spécialisation. Les pièces fournies sont des documents de la GED lus par le cœur.

## Dépendances
- JS `@logibtp/sous-traitance` : `@logibtp/socle` (décimaux). .NET : `LogiBTP.SousTraitance` (règles), `LogiBTP.SousTraitance.Web` → `LogiBTP.Socle.Web`, EF Core Npgsql. Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`Btp/SousTraitanceBtp.cs` : `SpecialisationSousTraitanceBtp` ; contrôles de validation des documents T par `ControlerPiecesAsync` ; courriel « st_pieces » du module Mail ; source de notifications `SourcePiecesSousTraitance`), client (`client/src/app/sous-traitance/pieces.js`, `pages/parametres-sous-traitance.js`).

## Structure
- `js/src/conformite.js` ↔ `dotnet/LogiBTP.SousTraitance/ReglesConformite.cs` (jeu `tests/cas/01_conformite.json`) : `applicable` (conditions : marché public, garantie, montant minimal), `finValidite` (saisie, sinon dépôt + durée), `etatPiece` (FOURNIE, A_ECHEANCE dans le délai de rappel, EXPIREE, MANQUANTE, ABSENTE si facultative, DISPENSEE), `conformite` (pièces applicables ou ajustées, la plus récente de sa catégorie, conforme = aucune obligatoire manquante ou expirée, `a_echeance`, `bloquants` par action), `ajouterMois`, `ETATS_PIECE`, `ACTIONS_BLOQUEES`, `PORTEES_PIECE`.
- `js/src/ventilation.js` ↔ `dotnet/LogiBTP.SousTraitance/ReglesVentilation.cs` (jeu `tests/cas/02_ventilation.json`) : `ventilerFactureRecue` (facture reçue répartie au prorata du reste de chaque ligne, cumul saisi → période, période négative au prorata du précédent, arrondi demi vers l'infini absorbé par la ligne de plus forte base ; `VENT_DEPASSEMENT`, `VENT_SANS_RESTE`, `VENT_SANS_LIGNE`), `MESSAGES_VENTILATION` ; dépend de `@logibtp/socle` (décimaux).
- `db/092_sous_traitance.sql` (rejouable) : `stt_piece_type` (code, libellé, portée TIERS / MARCHE, catégorie GED, obligatoire, durée en mois, rappel en jours, `spt_bloquant` TEXT[], conditions, modèle d'édition, ordre, actif ; pièces fournies par défaut une fois), `stt_piece_element` (ajustements : élément `marche` ou `personne`, mode AJOUTEE / DISPENSEE, motif).
- `dotnet/LogiBTP.SousTraitance.Web/ServiceSousTraitance.cs` : entités, `SousTraitanceDbContext`, `SpecialisationSousTraitance` (`MarcheAsync`, `PiecesAsync(tiers, marche)`, `DefinirValiditeAsync`), `ServiceSousTraitance` (`TypesAsync`, `EnregistrerTypesAsync` — administrateur —, `ConformiteMarcheAsync`, `ConformiteTiersAsync`, `BloquantsAsync(marche, action)`, `AjusterAsync` — motif obligatoire pour dispenser —), `Extensions` (`AddModuleSousTraitance<T>`, `MapModuleSousTraitance`).

## Routes HTTP (préfixe `/api/sous-traitance`, module activé par société)
- `GET|PUT /pieces-types` ; `GET /marches/{id}/conformite` ; `GET /tiers/{id}/conformite` ; `PUT /elements/{marche|personne}/{id}/pieces/{code}` { mode, motif } ; `PUT /pieces/{dge}/validite` { valide_au }.

## Tests
- `npm test --workspace modules/sous-traitance/js` ; `dotnet test modules/sous-traitance/dotnet/LogiBTP.SousTraitance.Tests` (même jeu).
