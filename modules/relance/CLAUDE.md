# Module Relances – contexte

- Plan par lots : [relances.md](../../plans/relances.md) ; analyse : [ANALYSE-RELANCES.md](../../documentation/conception/ANALYSE-RELANCES.md) ; décisions : [relances-questions.md](../../plans/relances-questions.md).

## Rôle
- Relances des devis envoyés et des factures à reste échu : règle des niveaux, calcul des relances dues (répliqué JS ↔ C#), regroupement ; à venir : journal, suspensions, préparation validée, écrans (lots 2 et 3).
- Sans métier : ne connaît ni les pièces, ni les échéances, ni les contacts ; le cœur les fournira par `SpecialisationRelanceBtp` (lot 4, méthode patron). Module facultatif `MODULE_FACULTATIF.RELANCE` (lot 4).

## Dépendances
- JS `@logibtp/relance` → `@logibtp/socle` (decimal). .NET : `LogiBTP.Relances` → `LogiBTP.Socle`. Jamais du cœur ni d'un autre module (ni Document, ni Règlements, ni Mail, Édition, CRM).

## Repères
- `js/src/regles.js` ↔ `dotnet/LogiBTP.Relances/ReglesRelance.cs` : `regleParDefaut` / `RegleParDefaut` (15, 30, 60 jours ; dernier niveau d'une facture en recommandé), `controlerRegle` / `Controler` (1 à `NIVEAUX_MAX` = 5 niveaux, rangs 1..n, délais entiers croissants, mode connu, TACHE pour les devis seulement, intervalle si répéter), `niveauAtteint` / `Niveau`, `relanceDue` / `Due`, `relancesDues` / `Dues`, `regrouper` / `Regrouper` ; jeu `tests/cas/01_niveaux.json`.
- Départ : date d'envoi du devis ; échéance échue (date < date du calcul) la plus ancienne non soldée (reste > seuil) de la facture ; retenue de garantie : l'échéance porte sa date de libération (null : jamais échue).
- Délais comptés depuis le départ ; seul le niveau atteint est proposé, s'il dépasse la dernière relance faite (même rang : seulement pour une répétition du dernier niveau dont le palier suit cette relance).
- Pièce arrêtée ou suspendue jusqu'à la date comprise : rien. Montant : montant du devis, reste échu de la facture ; échéances futures listées.
- Regroupement par tiers, chargé, nature et mode (ordre de première apparition) : modèles du niveau le plus élevé, chaque pièce garde son niveau, jours du groupe = le plus grand.
- Codes `js/src/codes.js` ↔ `Codes.cs` : `NATURE_RELANCE`, `MODE_RELANCE`, `ETAT_RELANCE`, `ERREUR_RELANCE` (parité par `CodesTests`). Montants en décimal, jamais en `Number`.

## Tests
- `npm test --workspace modules/relance/js` ; `dotnet test modules/relance/dotnet/LogiBTP.Relances.Tests` (même jeu, parité des codes).
