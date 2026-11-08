# Restes du TODO : « Ne plus utiliser », TVA autoliquidée, zone de déplacement du projet

> Plan autonome, index : [corrections-novembre.md](corrections-novembre.md). Analyse :
> [ANALYSE-CORRECTIONS-NOVEMBRE.md](../documentation/conception/ANALYSE-CORRECTIONS-NOVEMBRE.md) § 1.
>
> Contexte utile :
> - « Ne plus utiliser » : colonne `<préfixe>_usage` CHAR(1) A / N / S ajoutée par le cœur (`db/228_usage_fiches.sql:18-19`)
>   sur les fiches (tiers, individus, salariés, matériels, éléments…), vues `v_liste_*` (`:50-88`). Les modules Annuaire et
>   Bibliothèque ne lisent pas cette colonne (elle appartient au cœur). Choix concernés : recherche des tiers et individus
>   de l'annuaire (`modules/annuaire/dotnet/LogiBTP.Annuaire.Web/ServiceAnnuaire.cs`, `RechercherIndividus :193` ; JS
>   `modules/annuaire/js/src/fournisseurs.js`), appel de la bibliothèque (`ServiceBibliotheque.Rechercher`,
>   `modules/bibliotheque/dotnet/LogiBTP.Bibliotheque.Web/ServiceBibliotheque.cs:573` ; appel F3 du cœur
>   `client/src/app/bibliotheque/appel.js:233`), ressources du planning (`src/LogiBTP.Api/Btp/Ressources.cs`), salariés du
>   magasin (`src/LogiBTP.Api/Btp/MagasinBtp.cs:48`), salariés du pointage.
> - Fournisseur « TVA intracommunautaire » : `personne.per_fou_tva_intracom` (`db/229_annuaire_complements.sql:23`).
>   Autoliquidation déjà calculée par le module Document (jeu `modules/document/tests/cas/04_tva_autoliquidation_intracom.json`) ;
>   catégories de TVA du module Comptabilité (paramétrage `client/src/app/pages/comptabilite.js`, `#rendreCategories :457`).
> - Zone de déplacement du projet : `projet.prj_zone` (`db/236_structure_complements.sql:23`) ; zones du Pointage par agence.
>
> Décisions (08/11/2026) :
> - **Q2 (a)** : point d'accroche virtuel dans chaque module (`FiltreChoix` dans `ServiceAnnuaire` et
>   `ServiceBibliotheque`, côté JS dans le fournisseur de recherche) que le cœur spécialise. Fiches « en sommeil » (S)
>   toujours proposées ; seules les N sont écartées des choix de **nouvelle** saisie (une valeur déjà posée reste lisible).
>   Modules d'abord, puis le cœur.
> - **Q3 (c)** : sur les pièces d'achat d'un fournisseur TVA intracommunautaire, catégorie de TVA autoliquidée posée par
>   défaut sur les nouvelles lignes (modifiable) **et** avertissement à la validation si une ligne ne l'est pas ;
>   seulement quand le module Comptabilité est actif. Type de tiers FE laissé au futur module Facturation électronique.
> - **Q5 (a)** : zone recopiée à la création du chantier depuis le projet, modifiable ensuite.
>
> Ordre : modules Annuaire et Bibliothèque (lots 1, 2), puis cœur (lots 3 à 7).

## Points ouverts

| Point | Recommandation | Statut |
|---|---|---|
| Salariés du pointage : la liste vient-elle du module Pointage sans point d'accroche ? | À vérifier au lot 4 (graphify « salariés pointage choix ») ; si la liste est construite dans le module, un lot `modules/pointage` (point d'accroche du même modèle que le lot 1) passe avant le lot 4. | OUVERT |
| Avertissement TVA (lot 6) : bloquant ou simple avertissement confirmé ? | Avertissement non bloquant (niveau `NIVEAU_NOTIFICATION` du socle), avec le numéro des lignes en cause. | OUVERT |

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Point d'accroche `FiltreChoix` de l'annuaire | `modules/annuaire` | — | FAIT |
| 2 | Point d'accroche `FiltreChoix` de la bibliothèque | `modules/bibliotheque` | — | FAIT |
| 3 | Spécialisation des deux filtres par le cœur (usage N écarté) | cœur | 1, 2 | A FAIRE |
| 4 | « Ne plus utiliser » dans le planning, le pointage et le magasin | cœur | 3 | A FAIRE |
| 5 | TVA autoliquidée par défaut sur les lignes d'achat | cœur | — | A FAIRE |
| 6 | Avertissement de TVA à la validation d'une pièce d'achat | cœur | 5 | A FAIRE |
| 7 | Zone de déplacement du projet recopiée dans le chantier | cœur | — | A FAIRE |

---

## Lot 1 : point d'accroche `FiltreChoix` de l'annuaire (FAIT 08/11/2026)

- **Module** : `modules/annuaire`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `ServiceAnnuaire.cs` (recherche des tiers et `RechercherIndividus :193` : méthode virtuelle
  `FiltreChoix` appliquée aux seules recherches de choix, sans effet par défaut), `modules/annuaire/js/src/fournisseurs.js`
  (même accroche dans le fournisseur de recherche), tests `modules/annuaire/dotnet/LogiBTP.Annuaire.Tests/` et
  `modules/annuaire/js/test/annuaire.test.js`.
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : accroche « filtre des choix » (par défaut : aucun filtre) dans le service C# et le
  fournisseur JS.
- **Jeux de tests** : C# et JS : service spécialisé dans le test qui écarte un tiers → absent des choix, présent dans la
  fiche et la liste.
- **Critère de fin** : `npm test`, `dotnet test LogiBTP.slnx` verts ; aucun changement de comportement sans
  spécialisation.

## Lot 2 : point d'accroche `FiltreChoix` de la bibliothèque (FAIT 08/11/2026)

- **Module** : `modules/bibliotheque`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `ServiceBibliotheque.cs` (`Rechercher :573` : méthode virtuelle `FiltreChoix`),
  `modules/bibliotheque/js/src/fournisseurs.js` (`:109`, fournisseur mémoire), tests du module (C# et
  `bibliotheque.test.js`).
- **Dépendances** : aucune ; après le lot 2 du plan `corrections-bibliotheque.md` s'il est en cours (mêmes fichiers).
- **Règles répliquées JS / C#** : même accroche que le lot 1.
- **Jeux de tests** : même modèle que le lot 1, sur un élément.
- **Critère de fin** : `npm test`, `dotnet test LogiBTP.slnx` verts.

## Lot 3 : spécialisation des deux filtres par le cœur (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : spécialisations du cœur de l'annuaire et de la bibliothèque (`src/LogiBTP.Api/Btp/`, graphify
  « spécialisation annuaire » / « ElementsBibliotheque », `ElementsBibliotheque.cs:128`) : `<préfixe>_usage <> 'N'` ;
  côté client, fournisseurs de recherche du cœur et appel F3 (`client/src/app/bibliotheque/appel.js:233`) ; tests C# et
  client.
- **Dépendances** : lots 1 et 2.
- **Règles répliquées JS / C#** : aucune nouvelle (spécialisation).
- **Jeux de tests** : tiers, individu et élément à N absents des choix ; à S présents ; valeur déjà posée sur une pièce
  toujours affichée.
- **Critère de fin** : `npm test`, `dotnet test LogiBTP.slnx` verts.

## Lot 4 : « Ne plus utiliser » dans le planning, le pointage et le magasin (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `src/LogiBTP.Api/Btp/Ressources.cs` (ressources proposées au planning), `src/LogiBTP.Api/Btp/MagasinBtp.cs`
  (`SalariesAsync :48`, `SalarieSql :22`), choix des salariés du pointage (selon le point ouvert), tests C#.
- **Dépendances** : lot 3 ; point ouvert « salariés du pointage ».
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : salarié et matériel à N absents des choix de nouvelle affectation, de pointage et de sortie de
  magasin ; historique conservé.
- **Critère de fin** : `dotnet test LogiBTP.slnx` et `npm test` verts.

## Lot 5 : TVA autoliquidée par défaut sur les lignes d'achat (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : création de ligne des pièces d'achat dans le cœur (page document, graphify « catégorie TVA ligne
  achat ») : si le module Comptabilité est actif (`MODULE_FACULTATIF`) et `per_fou_tva_intracom`, catégorie autoliquidée
  par défaut sur les nouvelles lignes ; tests client.
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : aucune nouvelle (le calcul d'autoliquidation du module Document est inchangé).
- **Jeux de tests** : fournisseur intracommunautaire, Comptabilité active → nouvelle ligne autoliquidée, modifiable ;
  Comptabilité inactive → rien ; fournisseur ordinaire → rien.
- **Critère de fin** : `npm test` vert.

## Lot 6 : avertissement de TVA à la validation d'une pièce d'achat (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : contrôle à la validation des pièces d'achat (spécialisation du module Document dans le cœur, graphify
  « validation pièce achat spécialisation »), code d'avertissement dans `client/src/app/codes.js` ↔
  `src/LogiBTP.Domaine/Codes.cs`, texte au dictionnaire, tests C#.
- **Dépendances** : lot 5 ; point ouvert « avertissement ».
- **Règles répliquées JS / C#** : parité du nouveau code (tests de codes du cœur).
- **Jeux de tests** : C# : une ligne non autoliquidée → avertissement avec la ligne ; toutes autoliquidées → rien ;
  Comptabilité inactive → rien.
- **Critère de fin** : `dotnet test LogiBTP.slnx` et `npm test` verts.

## Lot 7 : zone de déplacement du projet recopiée dans le chantier (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : création du chantier depuis le projet (graphify « ouvrir chantier depuis projet » ; valeurs déjà
  pré-remplies depuis le projet), recopie de `prj_zone` (`db/236:23`) dans la zone du chantier, test client ou C#.
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : projet à zone 3 → chantier créé en zone 3, modifiable ; projet sans zone → chantier sans zone.
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts.

> Lot 1 FAIT le 08/11/2026 : accroches `FiltreChoixPersonnes()` / `FiltreChoixIndividus()` (condition SQL, protégées virtuelles) dans `ServiceAnnuaire`, option `filtreChoix: { personne, individu }` du `FournisseurAnnuaireMemoire`. Écart : `Lire` rendue `protected virtual` et le projet de tests référence `LogiBTP.Annuaire.Web` (test C# par capture du SQL, sans base).
> Lot 2 FAIT le 08/11/2026 : accroche `FiltreChoix(IQueryable<Element>)` (protégée virtuelle, appliquée à la seule requête de `Rechercher`) dans `ServiceBibliotheque`, option `filtreChoix(element)` du `FournisseurBibliothequeMemoire`. Écart : le cœur spécialise une requête LINQ (pas une condition SQL) ; le projet de tests référence `LogiBTP.Bibliotheque.Web`.
