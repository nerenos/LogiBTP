# Module SAV – contexte

## Rôle
- Équipements installés chez les clients ([analyse du Stock](../../documentation/conception/ANALYSE-MODULE-STOCK.md) § 11, S24.8 ; [plan](../../plans/stock.md), lots 2 à 6) : un numéro de série posé (article, lot du stock, lieu, client, date de pose), sa garantie (durée en mois ou fin saisie), son retrait (retour, dépose) ou son remplacement par un autre équipement. Premier lot du futur module SAV (interventions, contrats d'entretien plus tard).
- Articles, lots, lieux (chantiers pour le cœur), tiers et pièces sont des identifiants fournis par l'application ; les équipements nés d'un mouvement de stock sont créés par le cœur (`CreerAsync` avec une `OrigineMouvement`), jamais par le module seul.

## Dépendances
- JS `@logibtp/sav` : `@logibtp/socle` (dates, dictionnaire). .NET : `LogiBTP.Sav` (règles), `LogiBTP.Sav.Web` → `LogiBTP.Socle.Web`, EF Core Npgsql. Jamais du cœur ni d'un autre module (le Stock ne connaît pas le SAV, le cœur fait le lien).

## Repères
- Parité (jeu `tests/cas/01_garantie.json`) : `garantie.js` ↔ `ReglesGarantie.cs` — `numeroSerie` / `Numero` (espaces réduits), `finGarantie` / `Fin` (fin saisie, sinon veille de l'anniversaire pose + N mois, fin de mois ramenée ; durée 0 ou absente : sans garantie), `etatGarantie` / `Etat` (SANS, EN_COURS jusqu'à la fin comprise avec les jours restants, ECHUE), `controlerEquipement` / `Controler` (SAV_NUMERO, SAV_ARTICLE, SAV_POSE_FUTURE, SAV_DUREE 0 à 600 mois entiers, SAV_FIN_AVANT_POSE) ; codes `codes.js` ↔ `Codes.cs` (`ETAT_EQUIPEMENT`, `ORIGINE_EQUIPEMENT`, `ETAT_GARANTIE`).
- Un numéro de série n'est installé qu'une fois par article (index partiel `ux_eqi_numero_installe`, 409 `SAV_NUMERO_PRIS`) ; seul un équipement INSTALLE se retire ou se remplace (409 `SAV_ETAT`) ; un équipement né d'un mouvement garde son numéro et son article.
- Créés par le cœur (lot 4 du plan Stock, `Btp/EquipementsSavBtp.cs`, `db/273`) à la validation d'une pièce de stock : numéro de série (article suivi `SERIE`, lots facultatifs) livré sur un chantier client (ni dépôt, ni interne, ni dotation) = équipement `MOUVEMENT` (pose = date du mouvement, garantie de l'article) ; numéro qui en part (retour, sortie, transfert) = équipement `RETIRE` (`eqi_retire_ent_id`) ; pièce dévalidée, annulée ou remplacée : équipements nés d'elle supprimés, retraits annulés (trigger `f_sav_piece_retiree`) ; module `sav` de `module_societe`, nœud de droits `sav`.
- Spécialisation (`SpecialisationSav`) : `ControlerAsync` (contrôles de l'application après ceux du module), `DecrireAsync` (libellés d'article, de lieu, de tiers, de pièce), `Messages`.

## Structure
- `js/src/codes.js`, `js/src/garantie.js`, `js/src/index.js` ; textes `sav.equipement.erreurs.*` (messages du contrôle) et `erreurs.SAV_ETAT` (message littéral, `npm run extraire-erreurs --workspace client`) de `js/personnalisation/fr.json`, couche déclarée dans `client/personnalisation/couches.js`.
- `dotnet/LogiBTP.Sav/` (`Codes.cs`, `ReglesGarantie.cs`), `dotnet/LogiBTP.Sav.Web/` (`ServiceEquipements.cs` : entité, `SavDbContext`, DTO, service ; `Extensions.cs` : `AddModuleSav<T>`, `MapModuleSav`).
- `db/093s_sav.sql` (rejouable) : table `equipement_installe` (`eqi_*`), sans clé étrangère vers l'application (posées par le cœur).

## Routes HTTP (préfixe `/api/sav`, nœuds de droits déclarés par le cœur)
- `GET /equipements?numero=&article=&lieu=&tiers=&etat=&limite=`, `GET /equipements/{id}`, `POST /equipements` (création manuelle), `PUT /equipements/{id}`, `POST /equipements/{id}/retrait` { le, commentaire }, `POST /equipements/{id}/remplacement` (saisie du remplaçant).

## Tests
- `npm test --workspace modules/sav/js` ; `dotnet test modules/sav/dotnet/LogiBTP.Sav.Tests` (même jeu, parité des codes).
