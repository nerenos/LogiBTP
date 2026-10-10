# LogiBTP

- Répondre et documenter en français ; code, commentaires et noms en français (sauf API techniques).
- Deux moteurs de calcul miroirs : `client/src/calcul/moteur.js` et `src/LogiBTP.Calcul/MoteurCalcul.cs`. Toute règle modifiée l'est dans les deux, avec un cas dans `tests/cas/`, puis `npm --prefix client test`, `npm --prefix client run exporter-resultats` et `dotnet test LogiBTP.slnx`.
- Jamais de `Number` pour un montant côté JS (decimal.js) ; une seule fonction d'arrondi par moteur (demi vers l'infini).
- Noms de colonnes du DDL partout (snake_case préfixé) ; les propriétés C# en PascalCase s'y mappent automatiquement. `COLONNES_LIGNE` / `COLONNES_DOCUMENT` (types.js) doivent suivre les entités du domaine (un test le vérifie).
- Le schéma est géré par `db/*.sql` (pas de migrations EF).
