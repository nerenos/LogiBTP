# Module Stock – contexte

## Rôle
- Stock des articles ([analyse](../../documentation/conception/ANALYSE-MODULE-STOCK.md)) : journal des mouvements, comptages (inventaires), stock calculé à une date-heure (jamais saisi), valorisation (PMP ou dernier prix d'achat, méthode globale de la société), réévaluations du PMP, emplacements des lieux de stock.
- Les lieux (chantiers pour le cœur), les articles (éléments de la bibliothèque) et les pièces (documents) sont fournis par la spécialisation ; les mouvements sont écrits par l'application à la validation de ses pièces, dans leur transaction (`MouvementsStockBtp` du cœur), jamais par le module.

## Dépendances
- JS `@logibtp/stock` : `@logibtp/socle` (décimaux). .NET : `LogiBTP.Stock` (règles), `LogiBTP.Stock.Web` → `LogiBTP.Socle.Web`, EF Core Npgsql. Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`Btp/StockBtp.cs` : `SpecialisationStockBtp`, `MouvementsStockBtp` appelé par `SpecialisationBtp`), client (`client/src/app/stock/`, bloc Stock de `panneaux-btp.js`).

## Structure
- `js/src/stock.js` ↔ `dotnet/LogiBTP.Stock/ReglesStock.cs` (jeu `tests/cas/01_stock.json`) : `minute` (date-heure à la minute, date seule = minuit), `stockA` (dernier comptage de date-heure ≤ T, plus les mouvements après lui jusqu'à T ; mouvement de la même minute qu'un comptage = déjà compté), `ecartComptage` (compté − stock juste avant).
- `js/src/valorisation.js` ↔ `dotnet/LogiBTP.Stock/ReglesValorisation.cs` (jeu `tests/cas/02_prix.json`) : `valoriser` (événements de tous les lieux rejoués par minute — mouvements, comptages, réévaluations — : entrée valorisée = PMP pondéré par le stock total, le prix si ce stock était nul ou négatif, 6 décimales, et dernier prix d'achat ; comptage = quantité du lieu remplacée ; réévaluation = PMP saisi ; historique du PMP par mouvement), `valeurUnitaire` (méthode PMP / DERNIER_PA, repli = PA de la bibliothèque signalé `REPLI`), `METHODES_VALORISATION`.
- `db/093_stock.sql` (rejouable) : `stk_parametre` (méthode), `stk_emplacement` (arbre par lieu, code complet unique), `stk_article_emplacement` (emplacements habituels), `stk_mouvement` (date à la minute, quantité signée en unité de stock, prix d'une entrée valorisée, `mvt_provisoire` et `mvt_prix_initial` d'une réception non facturée, `mvt_prix_ent_id` = facture qui a fixé le prix, `mvt_pmp` calculé, origine, pièce et ligne, tiers, salarié, `mvt_tracabilite` réservé aux lots et numéros de série), `stk_comptage`, `stk_reevaluation`, `stk_valeur` (valorisation courante), `stk_a_valoriser` (articles marqués par les triggers `f_stk_marquer`), `f_stk_quantite(article, lieu, t)`, `v_stk_stock` (ensembliste).
- `dotnet/LogiBTP.Stock.Web/ServiceStock.cs` : entités, `StockDbContext`, `SpecialisationStock` (`LieuxAsync`, `ArticlesAsync`, `PiecesAsync`, `ApresValorisationAsync`, `PeutGererAsync`), `ServiceStock` (paramètres, emplacements, `ValoriserAsync` / `ValoriserEnAttenteAsync` — avant toute lecture des valeurs —, `RevaloriserToutAsync`, `ReevaluerAsync`, `FicheArticleAsync`, `EtatAsync` — quantités par `ReglesStock`, valeur à la date par rejeu —, `MouvementAsync`), `Extensions` (`AddModuleStock<T>`, `MapModuleStock`).

## Routes HTTP (préfixe `/api/stock`, module activé par société)
- `GET|PUT /parametres` { methode } ; `GET /lieux` ; `GET|PUT /lieux/{id}/emplacements` ; `GET /lieux/{id}/etat?date=&zeros=`.
- `GET /mouvements/{id}` ; `GET /articles/{id}` ; `POST /articles/{id}/pmp` { pmp, commentaire, date } ; `PUT /articles/{id}/emplacements` [ids] ; `POST /revaloriser`.
- Gestion (paramètres, emplacements, réévaluation) : `PeutGererAsync` (cœur : administrateur ou membre d'un service LOGISTIQUE).

## Tests
- `npm test --workspace modules/stock/js` ; `dotnet test modules/stock/dotnet/LogiBTP.Stock.Tests` (mêmes jeux).
