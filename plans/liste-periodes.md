# Module Liste : filtres par périodes glissantes (L1)

> Plan autonome, index : [corrections-novembre.md](corrections-novembre.md). Analyse :
> [ANALYSE-CORRECTIONS-NOVEMBRE.md](../documentation/conception/ANALYSE-CORRECTIONS-NOVEMBRE.md) § 4.
>
> Contexte utile :
> - Deux niveaux de filtre : filtre de colonne côté client (`modules/liste/js/src/filtres.js`) et filtre de vue
>   enregistré, exécuté par la base : `modules/liste/dotnet/LogiBTP.Listes/ConstructeurRequete.cs` (`:30`,
>   `ValeurFiltre :174`, `ConditionFiltre :182`, `Filtre :306`) ↔ `modules/liste/js/src/requete.js` (`:43`,
>   `filtresEffectifs :36`, `filtrer :90`).
> - Jeux du module : `modules/liste/tests/cas/02_requete.json` ; codes `modules/liste/js/src/codes.js` ↔ `Codes.cs`
>   (parité par `CodesTests`).
> - Le module Liste ne dépend ni du module Comptabilité ni du cœur.
>
> Décisions (08/11/2026) :
> - **Q12 (a)** : nouvel opérateur de vue `periode` (valeur = code de période, plus un nombre x pour les périodes
>   paramétrées), calculé à la date d'exécution : une vue enregistrée « mes chantiers du mois » reste juste. Répliqué
>   JS / C# ; proposé aussi dans le filtre de colonne. La définition de vue (JSON) gagne cet opérateur.
> - **Q13 (toutes)** : aujourd'hui, hier, semaine en cours, semaine précédente, mois en cours, mois précédent, trimestre
>   en cours, année en cours, année précédente, exercice en cours ; « x derniers jours », « x derniers mois »,
>   « x prochains jours », x saisi. Semaine du lundi au dimanche. Exercice au sens du module Comptabilité seulement s'il
>   est actif, sinon année civile.
>
> Ordre : module Liste (lots 1 à 3), puis cœur (lot 4).

## Points ouverts

| Point | Recommandation | Statut |
|---|---|---|
| « x derniers jours » : aujourd'hui compris ? | Oui : du jour − (x − 1) à aujourd'hui ; « x derniers mois » : du même jour x mois plus tôt (lendemain) à aujourd'hui ; « x prochains jours » : d'aujourd'hui à jour + (x − 1). | OUVERT |
| Fuseau de la date d'exécution | Date du jour du serveur (fuseau de l'installation), la même en JS (tests à date fixée). | OUVERT |

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Codes et bornes des périodes (JS / C#) | `modules/liste` | — | FAIT |
| 2 | Opérateur de vue `periode` dans la requête (JS / C#) | `modules/liste` | 1 | A FAIRE |
| 3 | Choix de la période dans le filtre de colonne et l'éditeur de vue | `modules/liste` | 2 | A FAIRE |
| 4 | Exercice comptable fourni par le cœur | cœur | 1 | A FAIRE |

---

## Lot 1 : codes et bornes des périodes (FAIT, 08/11/2026)

- **Module** : `modules/liste`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `modules/liste/js/src/codes.js` ↔ `modules/liste/dotnet/LogiBTP.Listes/Codes.cs` (`PERIODE` : un code par
  période de Q13), `modules/liste/js/src/periodes.js` ↔ `LogiBTP.Listes/Periodes.cs` (nouveaux : bornes [début, fin] d'un
  code, d'un nombre x et d'une date de référence ; début d'exercice fourni par un paramètre, année civile par défaut),
  `modules/liste/tests/cas/04_periodes.json` (nouveau), test JS et test C# qui lisent ce jeu, `CodesTests`.
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : bornes de chaque période (semaine lundi–dimanche, trimestre civil, exercice paramétré),
  selon les points ouverts.
- **Jeux de tests** : `04_periodes.json` : chaque code à une date de référence fixe, cas limites (lundi, 31 janvier,
  29 février, 1er janvier, exercice décalé).
- **Réalisé (08/11/2026)** : recommandations des points ouverts retenues (x derniers jours aujourd'hui compris ; date de référence fournie par l'appelant, sans fuseau dans le calcul). Écarts : ajout des codes d'erreur `PERIODE_INCONNUE` et `PERIODE_NOMBRE` (`ERREUR_LISTE`) ; `PERIODE_AVEC_NOMBRE` en JS ; début d'exercice = date dont seuls mois et jour comptent.
- **Critère de fin** : le jeu passe en JS et en C# ; parité des codes verte ; `npm test`, `dotnet test LogiBTP.slnx` verts.

## Lot 2 : opérateur de vue `periode` dans la requête (A FAIRE)

- **Module** : `modules/liste`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `ConstructeurRequete.cs` (`:30`, `ValeurFiltre :174`, `ConditionFiltre :182` : `periode` → condition
  `>= début AND <= fin` paramétrée, calculée à l'exécution), `requete.js` (`:43`, `filtresEffectifs :36`, `filtrer :90`),
  `modules/liste/dotnet/LogiBTP.Listes/Modeles.cs` (définition de vue, `:9`), `02_requete.json`.
- **Dépendances** : lot 1.
- **Règles répliquées JS / C#** : opérateur `periode` sur une colonne date (refus sur une colonne d'un autre type, code
  d'erreur du module).
- **Jeux de tests** : cas de `02_requete.json` : vue « mois en cours » exécutée à deux dates de référence différentes →
  bornes différentes ; « x derniers jours » ; colonne non date refusée.
- **Critère de fin** : les cas passent en JS et en C# ; `npm test`, `npm run exporter-resultats`, `dotnet test
  LogiBTP.slnx` verts.

## Lot 3 : choix de la période dans le filtre de colonne et l'éditeur de vue (A FAIRE)

- **Module** : `modules/liste`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/liste/js/src/filtres.js`, `modules/liste/js/ui/menu-filtre.js`, `modules/liste/js/ui/concepteur.js`
  (choix par `creerCombo`, nombre x saisi pour les périodes paramétrées), textes du module (`texte()`),
  `modules/liste/js/test/liste.test.js`.
- **Dépendances** : lot 2.
- **Règles répliquées JS / C#** : aucune nouvelle (réutilise les lots 1 et 2).
- **Jeux de tests** : test JS : choix « mois en cours » dans le filtre de colonne → filtre `periode` dans la vue
  enregistrée (pas de dates fixes).
- **Critère de fin** : `npm test` vert ; une vue enregistrée avec une période garde le code et non des dates.

## Lot 4 : exercice comptable fourni par le cœur (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : spécialisation du module Liste dans le cœur (`src/LogiBTP.Api/Btp/`, à localiser par graphify
  « spécialisation liste ») : début d'exercice lu dans le module Comptabilité s'il est actif (`MODULE_FACULTATIF`), sinon
  rien (année civile) ; côté client, même fourniture au filtre de colonne ; test C#.
- **Dépendances** : lot 1.
- **Règles répliquées JS / C#** : aucune nouvelle.
- **Jeux de tests** : C# : Comptabilité active avec exercice décalé → « exercice en cours » suit l'exercice ; inactive →
  année civile.
- **Critère de fin** : `dotnet test LogiBTP.slnx` et `npm test` verts.
