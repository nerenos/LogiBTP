# Corrections de novembre : module Bibliothèque (B1, B2, B3)

> Plan autonome, index : [corrections-novembre.md](corrections-novembre.md). Analyse :
> [ANALYSE-CORRECTIONS-NOVEMBRE.md](../documentation/conception/ANALYSE-CORRECTIONS-NOVEMBRE.md) § 2.
>
> Contexte utile :
> - Calcul des prix d'un élément : `modules/bibliotheque/dotnet/LogiBTP.Bibliotheque/CalculElement.cs:80-101` ↔
>   `modules/bibliotheque/js/src/calcul.js:52-69`. Un tarif n'est pris qu'avec les scénarios FOURNISSEUR_PRINCIPAL (tarif
>   marqué principal **et** en vigueur à la date) ou MEILLEUR_MIN / MEILLEUR_MAX. Le scénario par défaut est `FIXE`
>   (db/131). PA = dernier PA ou PMP, puis PR = PA × FG (`CalculElement.cs:92-93`, `:109`).
> - Le PMP et le dernier PA viennent du Stock (cœur) : `src/LogiBTP.Api/Btp/StockBtp.cs:199-200`, recopiés par
>   `ApresValorisationAsync` (`:99-102`).
> - Onglet Prix de la fiche élément : lit les tarifs une seule fois à l'ouverture (`modules/bibliotheque/js/ui/onglets.js:29`).
> - Boutons d'enregistrement par ligne : onglet Tarifs de la fiche élément (`onglets.js:238`) et onglet Tarifs de la fiche
>   fournisseur (`client/src/app/annuaire/tarifs-fournisseur.js:41`).
> - Service : `ServiceBibliotheque.EnregistrerTarif` (`modules/bibliotheque/dotnet/LogiBTP.Bibliotheque.Web/ServiceBibliotheque.cs:400`),
>   `ImporterTarifs` (`:433`), `RecalculerElements` (`:268`) ; fournisseur mémoire JS
>   (`modules/bibliotheque/js/src/fournisseurs.js:109`).
>
> Décisions (08/11/2026) :
> - **B1 (Q8 : a + c)** : le premier tarif saisi d'un élément devient principal, et l'élément sans PA passe au scénario
>   FOURNISSEUR_PRINCIPAL ; l'onglet Prix recharge les tarifs (un tarif ajouté depuis l'onglet Tarifs est vu).
> - **B2 (Q9 : a)** : bug d'affichage à reproduire (dernier PA / PMP montrés dans la colonne PR, ou sans FG) ; le lot
>   commence par reproduire. La règle de calcul ne change pas tant que la reproduction ne montre pas une erreur du calcul.
> - **B3 (Q10 : a)** : sur les deux onglets Tarifs, le bouton d'enregistrement de ligne disparaît ; une ligne modifiée
>   s'enregistre quand on la quitte (changement de valeur). Le bouton d'ajout de la ligne vide reste.
>
> Ordre : module Bibliothèque, puis cœur. Après tout lot touchant le calcul : `npm test`, `npm run exporter-resultats`,
> `dotnet test LogiBTP.slnx`.

## Points ouverts

| Point | Recommandation | Statut |
|---|---|---|
| Import de tarifs (`ImporterTarifs`, `:433`) : la règle « premier tarif = principal » s'applique-t-elle aussi aux tarifs importés ? | Oui, même règle pour tout premier tarif d'un élément, quelle que soit sa source. | TRANCHÉ (oui, appliqué à l'import, lot 2) |

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Onglet Prix : rechargement des tarifs | `modules/bibliotheque` | — | FAIT (08/11/2026) |
| 2 | Premier tarif principal, scénario FOURNISSEUR_PRINCIPAL | `modules/bibliotheque` | — | FAIT (08/11/2026) |
| 3 | Résultat : dernier PA et PMP affichés comme des PR (reproduction puis correction) | `modules/bibliotheque` | 1 | A FAIRE |
| 4 | Recopie du PMP et du dernier PA par le Stock (seulement si le lot 3 met la cause dans le cœur) | cœur | 3 | FAIT (08/11/2026) |
| 5 | Onglet Tarifs de la fiche élément : enregistrement à la sortie de ligne | `modules/bibliotheque` | — | FAIT (08/11/2026) |
| 6 | Onglet Tarifs de la fiche fournisseur : enregistrement à la sortie de ligne | cœur | 5 | FAIT (08/11/2026) |

---

## Lot 1 : onglet Prix, rechargement des tarifs (FAIT 08/11/2026 ; écart : rechargement par abonnement `suivreTarifs`/`signalerTarifs`, test sans DOM)

- **Module** : `modules/bibliotheque`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/bibliotheque/js/ui/onglets.js` (`:29`, lecture des tarifs à l'ouverture : relire à chaque
  affichage de l'onglet Prix ou après tout enregistrement de tarif), `modules/bibliotheque/js/test/bibliotheque.test.js`.
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : aucune (interface seule).
- **Jeux de tests** : cas JS « tarif ajouté depuis l'onglet Tarifs, puis onglet Prix : le tarif est proposé et le prix
  recalculé » (fournisseur mémoire).
- **Critère de fin** : `npm test` du module vert ; le cas ci-dessus passe.

## Lot 2 : premier tarif principal, scénario FOURNISSEUR_PRINCIPAL (FAIT 08/11/2026 ; écart : règle isolée dans `PremierTarif.Appliquer` (C#) ↔ `reglePremierTarif` (calcul.js), import aussi couvert, cas 01_calcul.json déjà présents ; parité corrigée : import JS aligné, règle limitée à un élément sans tarif avant l’opération, scénario null = FIXE, codes SCENARIO_PA ↔ ScenarioPa, cas partagés 03_premier_tarif.json ; 2 échecs préexistants de personnalisation.test.js du client, hors lot)

- **Module** : `modules/bibliotheque`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `ServiceBibliotheque.cs` (`EnregistrerTarif :400` ; `ImporterTarifs :433` selon le point ouvert ;
  `RecalculerElements :268` pour le prix recalculé), `modules/bibliotheque/js/src/fournisseurs.js` (`:109`, même règle
  dans le fournisseur mémoire), `modules/bibliotheque/js/test/bibliotheque.test.js`, tests C# du service
  (`modules/bibliotheque/dotnet/LogiBTP.Bibliotheque.Tests/`), `modules/bibliotheque/tests/cas/01_calcul.json` (cas de
  contrôle seulement, le calcul ne change pas).
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : « premier tarif d'un élément = principal ; élément sans PA saisi en scénario FIXE →
  FOURNISSEUR_PRINCIPAL » dans le service C# et le fournisseur mémoire JS. `CalculElement.cs:80-101` ↔ `calcul.js:52-69`
  inchangés.
- **Jeux de tests** : C# et JS : premier tarif → marqué principal, scénario changé ; second tarif → rien ne change ;
  élément avec PA saisi → scénario conservé. `01_calcul.json` : un cas FOURNISSEUR_PRINCIPAL avec tarif principal en
  vigueur (s'il manque), passant en JS et en C#.
- **Critère de fin** : `npm test`, `npm run exporter-resultats`, `dotnet test LogiBTP.slnx` verts.

## Lot 3 : résultat, dernier PA et PMP affichés comme des PR (FAIT le 08/11/2026, issue 3 : cause dans le cœur, voir lot 4)

- **Module** : `modules/bibliotheque`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Démarche** : **reproduire d'abord** (élément avec dernier PA ou PMP, FG non nuls) ; noter dans le lot la cause
  trouvée. Trois issues :
  1. affichage (valeur posée dans la colonne PR, ou PR affiché sans FG) : corriger l'onglet ;
  2. calcul (FG non appliqués à ces PA) : corriger les deux moteurs, avec un cas dans `01_calcul.json` ;
  3. recopie par le Stock (cœur) : s'arrêter et passer au lot 4.
- **Fichiers** : `modules/bibliotheque/js/ui/onglets.js` (bloc résultat de l'onglet Prix), si issue 2 :
  `CalculElement.cs:92-93`, `:109` ↔ `calcul.js:52-69`, `01_calcul.json` ; `bibliotheque.test.js`.
- **Dépendances** : lot 1 (même onglet).
- **Règles répliquées JS / C#** : seulement si issue 2 (PR = PA × FG pour le dernier PA et le PMP), dans le même lot que
  son cas.
- **Jeux de tests** : cas JS d'affichage (PA dans la colonne PA, PR = PA × FG) ; si issue 2, cas `01_calcul.json`
  « dernier PA » et « PMP » avec FG.
- **Critère de fin** : la reproduction et sa cause sont notées dans le lot ; le cas passe ; `npm test` (et, si issue 2,
  `npm run exporter-resultats`, `dotnet test LogiBTP.slnx`) verts.

- **Résultat (08/11/2026)** : diagnostic par lecture, aucun code modifié. Onglet Prix (`majResultat`) : PA dans la colonne PA, PR = `calculerElement` ; `calcul.js` et `CalculElement.cs` appliquent déjà FG au dernier PA et au PMP (cas « dernier PA et PMP » de `01_calcul.json`, PMP 12,345678 × 1,1 = 13,580246). Cause : `StockBtp.ApresValorisationAsync` met à jour `ele_pmp` / `ele_dernier_pa` par SQL direct, sans recalculer `ele_pa` / `ele_pr` / `ele_pv` (jamais passés par `CalculElement`), et le prix unitaire des pièces d'achat vient de `MontantHt` (`StockBtp.cs:199`). Issue 3 : traitée au lot 4.

## Lot 4 : recopie du PMP et du dernier PA par le Stock (FAIT 08/11/2026 ; écart : `ApresValorisationAsync` recalcule PA, PR, PV, PV net par `CalculElement` en une seule écriture (articles seulement), test `ValorisationStockTests` dans `tests/LogiBTP.Calcul.Tests` qui référence désormais `LogiBTP.Api`)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Condition** : à faire seulement si le lot 3 conclut que la cause est dans le cœur ; sinon passer le lot à
  « SANS OBJET » avec la raison.
- **Fichiers** : `src/LogiBTP.Api/Btp/StockBtp.cs` (`:199-200` montant HT net des pièces d'achat ; `ApresValorisationAsync
  :99-102`, colonne de destination de la recopie), tests C# du cœur (`tests/LogiBTP.Calcul.Tests/`).
- **Dépendances** : lot 3.
- **Règles répliquées JS / C#** : aucune (recopie serveur).
- **Jeux de tests** : test C# : après valorisation, PMP et dernier PA posés dans les colonnes PA de l'élément.
- **Critère de fin** : `dotnet test LogiBTP.slnx` vert ; le cas de reproduction du lot 3 donne PR = PA × FG.

## Lot 5 : onglet Tarifs de la fiche élément, enregistrement à la sortie de ligne (FAIT 08/11/2026 ; écart : enregistrement au focusout de la ligne modifiée (change puis sortie), helpers purs actionsLigneTarif / tarifDepuisSaisie exportés pour le test sans DOM)

- **Module** : `modules/bibliotheque`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/bibliotheque/js/ui/onglets.js` (`:238`, bouton d'enregistrement de ligne retiré ; enregistrement
  sur changement de valeur de la ligne, erreurs affichées sur la ligne), `bibliotheque.test.js`, textes du module si un
  libellé du bouton disparaît.
- **Dépendances** : aucune (même fichier que les lots 1 et 3 : ne pas les mener en parallèle).
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : cas JS : modification d'une ligne puis sortie → `EnregistrerTarif` appelé une fois ; aucun bouton
  d'enregistrement de ligne ; le bouton d'ajout de la ligne vide reste.
- **Critère de fin** : `npm test` vert ; aucun bouton d'enregistrement par ligne dans l'onglet.

## Lot 6 : onglet Tarifs de la fiche fournisseur, enregistrement à la sortie de ligne (FAIT 08/11/2026 ; écart : aides actionsLigneTarif / tarifDepuisSaisie réexportées par @logibtp/bibliotheque/ui, enregistrement au focusout après change, texte et icône «enregistrer» devenus inutilisés laissés en place)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/annuaire/tarifs-fournisseur.js` (`:41`), test client correspondant (`client/test/`).
- **Dépendances** : lot 5 (même comportement ; reprendre l'aide du module si le lot 5 en a exposé une).
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : cas client identique au lot 5.
- **Critère de fin** : `npm test` vert ; aucun bouton d'enregistrement par ligne dans l'onglet Tarifs du fournisseur.
