# Module Relances – contexte

- Plan par lots : [relances.md](../../plans/relances.md) ; analyse : [ANALYSE-RELANCES.md](../../documentation/conception/ANALYSE-RELANCES.md) ; décisions : [relances-questions.md](../../plans/relances-questions.md).

## Rôle
- Relances des devis envoyés et des factures à reste échu : règle des niveaux, calcul des relances dues (répliqué JS ↔ C#), regroupement ; journal, suspensions, lots préparés puis validés (lot 2) ; à venir : écrans (lot 3).
- Sans métier : ne connaît ni les pièces, ni les échéances, ni les contacts ; le cœur les fournira par `SpecialisationRelanceBtp` (lot 4, méthode patron). Module facultatif `MODULE_FACULTATIF.RELANCE` (lot 4).

## Dépendances
- JS `@logibtp/relance` → `@logibtp/socle` (decimal). .NET : `LogiBTP.Relances` → `LogiBTP.Socle` ; `LogiBTP.Relances.Web` → `LogiBTP.Socle.Web`, EF Core Npgsql. Jamais du cœur ni d'un autre module (ni Document, ni Règlements, ni Mail, Édition, CRM).

## Repères
- `js/src/regles.js` ↔ `dotnet/LogiBTP.Relances/ReglesRelance.cs` : `regleParDefaut` / `RegleParDefaut` (15, 30, 60 jours ; dernier niveau d'une facture en recommandé), `controlerRegle` / `Controler` (1 à `NIVEAUX_MAX` = 5 niveaux, rangs 1..n, délais entiers croissants, mode connu, TACHE pour les devis seulement, intervalle si répéter), `niveauAtteint` / `Niveau`, `relanceDue` / `Due`, `relancesDues` / `Dues`, `regrouper` / `Regrouper` ; jeu `tests/cas/01_niveaux.json`.
- Départ : date d'envoi du devis ; échéance échue (date < date du calcul) la plus ancienne non soldée (reste > seuil) de la facture ; retenue de garantie : l'échéance porte sa date de libération (null : jamais échue).
- Délais comptés depuis le départ ; seul le niveau atteint est proposé, s'il dépasse la dernière relance faite (même rang : seulement pour une répétition du dernier niveau dont le palier suit cette relance).
- Pièce arrêtée ou suspendue jusqu'à la date comprise : rien. Montant : montant du devis, reste échu de la facture ; échéances futures listées.
- Regroupement par tiers, chargé, nature et mode (ordre de première apparition) : modèles du niveau le plus élevé, chaque pièce garde son niveau, jours du groupe = le plus grand.
- Codes `js/src/codes.js` ↔ `Codes.cs` : `NATURE_RELANCE`, `MODE_RELANCE`, `ETAT_RELANCE`, `ETAT_LOT_RELANCE`, `MOTIF_SUSPENSION`, `ERREUR_RELANCE` (parité par `CodesTests`). Montants en décimal, jamais en `Number`.

## Schéma et service (lot 2)
- `db/099t_relance.sql` (rejouable) : `relance_regle` (par nature, niveaux JSONB snake_case, défaut 15/30/60), `relance_lot` (`ETAT_LOT_RELANCE`), `relance` (journal : pièce `rel_ent_id` + groupe d'indices `rel_ent_groupe_id`, groupe d'envoi `rel_groupe`, niveau propre, mode, état, montant, `rel_courriel_id`, `rel_ged_id`, `rel_recommande`), `relance_suspension` (pièce **ou** tiers, `rsu_jusqu_au` compris, `MOTIF_SUSPENSION`). Identifiants de l'application sans clé étrangère.
- `dotnet/LogiBTP.Relances.Web` : `SpecialisationRelance` (`PiecesEnAttenteAsync`, `RegleDuTiersAsync` → `SurchargeTiers` : règle propre, ne pas relancer, mode préféré ; `PorteeAsync` par chargé ; `EnvoyerAsync` par mode, défaut : journal seul, recommandé en ATTENTE_NUMERO ; `ApresEnvoiAsync`), `ServiceRelance`, `Donnees.cs`, `Extensions.cs` (`AddModuleRelance<T>`, `MapModuleRelance`).
- Journal seule source des niveaux faits : ENVOYEE et ATTENTE_NUMERO comptent (dernière par date, pièce ou groupe d'indices) ; pièce déjà PROPOSEE dans un lot exclue du calcul. Validation groupe par groupe : échec d'envoi → groupe proposé, signalé ; non retenues → proposées (lot PARTIEL) ; plus rien de proposé → lot ENVOYE (clos). Numéro de recommandé : toute la lettre (lot + groupe) passe ENVOYEE. Relance notée (Q22 b) au niveau dû.

## Routes HTTP (préfixe `/api/relances`, droits rattachés au lot 4 du cœur)
- `GET ?date=` (dues groupées), `GET /regles`, `PUT /regles/{nature}` (administrateur), `GET /lots?etat=`, `POST /lots` (204 si rien), `GET /lots/{id}`, `POST /lots/{id}/valider`, `POST /lots/{id}/annuler`, `PUT /{id}/recommande`, `POST /notees`, `GET /journal?piece=&groupe=&tiers=`, `GET|POST /suspensions`, `PUT|DELETE /suspensions/{id}`.

## Tests
- `npm test --workspace modules/relance/js` ; `dotnet test modules/relance/dotnet/LogiBTP.Relances.Tests` (même jeu, parité des codes ; `ServiceRelanceTests` seulement si `LOGIBTP_TEST_PG` désigne une base où `099t` est chargé).
