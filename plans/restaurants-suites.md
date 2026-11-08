# Restes du TODO : suites des restaurants (équipe à la borne, liste des repas, carte)

> Plan autonome, index : [corrections-novembre.md](corrections-novembre.md). Analyse :
> [ANALYSE-CORRECTIONS-NOVEMBRE.md](../documentation/conception/ANALYSE-CORRECTIONS-NOVEMBRE.md) § 1 (Restaurants, lot 10
> réalisé). Sujet sans analyse détaillée : questions ouvertes à trancher **au démarrage du plan** ; les lots suivent la
> recommandation.
>
> Contexte utile :
> - Module Pointage : `modules/pointage/dotnet/LogiBTP.Pointage.Web/ServiceRepas.cs` (`RestaurantPointage :21`),
>   `ServiceBorne.cs` (`RepasBorne :49`, `RestaurantsAsync :444`, `RepasAsync :452` : aujourd'hui chacun déclare son repas),
>   `ServicePaie.cs` (`Repas :167`, repas repris en paie).
> - Cœur : saisie d'équipe `src/LogiBTP.Api/Btp/Equipes.cs` (`EnregistrerAsync :151`), borne `client/src/app/pages/borne.js`,
>   géocodage des restaurants `db/239_restaurants_geocodage.sql`, carte déjà présente dans `client/src/app/pages/terrain.js`
>   (`#carte :240`).
> - Listes : vues `v_liste_*` du cœur (`db/`), vues de liste du cœur `client/src/app/vues-liste.js`. Filtre par période :
>   plan [liste-periodes.md](liste-periodes.md) (utile, non bloquant).
>
> Décisions (08/11/2026) : périmètre retenu (Q1 : tout) ; aucun choix de détail pris, voir ci-dessous.

## Questions ouvertes (à trancher au démarrage)

| N° | Question | Recommandation | Statut |
|---|---|---|---|
| RO1 | Repas en saisie d'équipe : qui déclare, et pour qui ? | Le chef d'équipe déclare un restaurant pour l'équipe, une case par membre (cochée par défaut) ; un membre peut encore corriger le sien seul. Mêmes contrôles que le repas individuel. | ✔ Tranché (08/11/2026) : recommandation retenue |
| RO2 | Liste des repas d'une période : vue de liste ou page dédiée ? | Vue de liste du module Liste sur une vue `v_liste_repas` (salarié, date, restaurant, chantier, montant), filtre par période, export par la liste ; droits RH. | ✔ Tranché (08/11/2026) : recommandation retenue |
| RO3 | Carte des restaurants : où, et avec quel fond ? | Onglet carte de la liste des restaurants, en reprenant le composant de carte de `terrain.js` (même fond, même réglages) ; position par le géocodage de `db/239`. | ✔ Tranché (08/11/2026) : recommandation retenue |

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Repas pour plusieurs salariés à la borne : service | `modules/pointage` | RO1 | FAIT |
| 2 | Repas dans la saisie d'équipe de la borne | cœur | 1 | A FAIRE |
| 3 | Vue des repas d'une période | cœur | RO2 | A FAIRE |
| 4 | Liste des repas (écran, droits) | cœur | 3 | A FAIRE |
| 5 | Carte des restaurants | cœur | RO3 | A FAIRE |

---

## Lot 1 : repas pour plusieurs salariés à la borne, service (FAIT 08/11/2026)

- **Module** : `modules/pointage`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `ServiceBorne.cs` (`RepasBorne :49` : liste de salariés ; `RepasAsync :452`), `ServiceRepas.cs`
  (contrôles par salarié), codes d'erreur dans `modules/pointage/js/src/codes.js` ↔ `Codes.cs` si un code est ajouté,
  tests `modules/pointage/dotnet/LogiBTP.Pointage.Tests/`.
- **Dépendances** : RO1 tranchée.
- **Règles répliquées JS / C#** : parité des codes si un code est ajouté.
- **Jeux de tests** : repas déclaré pour trois membres → trois repas ; un membre déjà déclaré ce jour → refus pour lui
  seul, les autres enregistrés ; salarié hors équipe refusé.
- **Critère de fin** : `dotnet test LogiBTP.slnx` vert.
- **Réalisé** : `RepasBorne` reçoit `Membres` ; règle pure `ReglesRepas.Repartir` (hors équipe `REPAS_HORS_EQUIPE`, déjà déclaré `REPAS_DEJA`), refus par salarié, jour validé aussi refusé seul ; réponse `RepasEquipeResultat`. Écart : tests sur la règle pure (pas de test de service avec base).

## Lot 2 : repas dans la saisie d'équipe de la borne (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/pages/borne.js` (saisie d'équipe : choix du restaurant, cases des membres),
  `src/LogiBTP.Api/Btp/Equipes.cs` (`:151`, si la saisie d'équipe passe par le cœur), textes, test client.
- **Dépendances** : lot 1.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : test client : équipe de trois, un décoché → deux repas envoyés.
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts.

## Lot 3 : vue des repas d'une période (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : nouveau script `db/<numéro>_liste_repas.sql` (`v_liste_repas`, rejouable) et `db/installation/scripts.txt`,
  déclaration de la vue de liste dans `client/src/app/vues-liste.js`, test d'alignement des colonnes.
- **Dépendances** : RO2 tranchée.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : script rejoué deux fois ; colonnes de la vue alignées sur la déclaration (tests existants).
- **Critère de fin** : `npm test` vert ; la vue rend les repas de la base de développement.

## Lot 4 : liste des repas, écran et droits (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : entrée de menu et page de liste (`client/src/app/`), nœud de droits dans `SpecialisationDroitsBtp.Routes`,
  textes, test client.
- **Dépendances** : lot 3 ; le filtre par période vient du plan `liste-periodes.md` (souhaitable, non bloquant).
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : utilisateur sans droit RH → 403 ; avec droit → liste filtrable par période et exportable.
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts.

## Lot 5 : carte des restaurants (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : composant de carte de `client/src/app/pages/terrain.js` (`#carte :240`, à rendre réutilisable sans
  changer son comportement), écran des restaurants (graphify « restaurants écran liste »), test client.
- **Dépendances** : RO3 tranchée.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : restaurants géocodés affichés ; non géocodés listés à part ; carte du terrain inchangée.
- **Critère de fin** : `npm test` vert.
