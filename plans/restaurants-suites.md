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
| RO3 | Carte des restaurants : où, et avec quel fond ? | Onglet carte de la liste des restaurants, en reprenant le composant de carte de `terrain.js` (même fond, même réglages) ; position par le géocodage de `db/239`. | ✔ Tranché (08/11/2026) : pas de carte ; liste des restaurants avec lien d'itinéraire |

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Repas pour plusieurs salariés à la borne : service | `modules/pointage` | RO1 | FAIT |
| 2 | Repas dans la saisie d'équipe de la borne | cœur | 1 | FAIT |
| 3 | Vue des repas d'une période | cœur | RO2 | FAIT |
| 4 | Liste des repas (écran, droits) | cœur | 3 | FAIT |
| 5 | Liste des restaurants avec itinéraire | cœur | RO3 | FAIT |

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

## Lot 2 : repas dans la saisie d'équipe de la borne (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/pages/borne.js` (saisie d'équipe : choix du restaurant, cases des membres),
  `src/LogiBTP.Api/Btp/Equipes.cs` (`:151`, si la saisie d'équipe passe par le cœur), textes, test client.
- **Dépendances** : lot 1.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : test client : équipe de trois, un décoché → deux repas envoyés.
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts.
- **Réalisé** : bouton Repas aussi en saisie d'équipe ; cases des membres (cochées par défaut), envoi de `membres` (`corpsRepas`, `membresRepas` dans `pointage/repas.js`), refus par salarié affichés. Écarts : `Equipes.cs` inchangé (la borne passe par le module) ; pas de `dotnet test` (aucun C# touché) ; `npm test` : 3 échecs hors lot restants dont `REPAS_DEJA` / `REPAS_HORS_EQUIPE` « plus levé » (lot 1, à régler par `extraire-erreurs`).

## Lot 3 : vue des repas d'une période (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : nouveau script `db/<numéro>_liste_repas.sql` (`v_liste_repas`, rejouable) et `db/installation/scripts.txt`,
  déclaration de la vue de liste dans `client/src/app/vues-liste.js`, test d'alignement des colonnes.
- **Dépendances** : RO2 tranchée.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : script rejoué deux fois ; colonnes de la vue alignées sur la déclaration (tests existants).
- **Critère de fin** : `npm test` vert ; la vue rend les repas de la base de développement.
- **Réalisé** : `db/282_liste_repas.sql` (`v_liste_repas` + source de liste `repas`, rejouable), manifeste, `SOURCES_LISTE.repas`, `121` régénéré (1 ligne). Écarts : pas de colonne montant (le repas n'en porte pas) ; script non appliqué aux bases de développement ; vérifié le 08/11/2026 en transaction annulée sur logibtp_demo et logibtp (création de la vue et de la source sans erreur, 0 repas dans les deux bases, aucune correction nécessaire) ; `npm test` client : seuls les 2 échecs anciens restent.

## Lot 4 : liste des repas, écran et droits (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : entrée de menu et page de liste (`client/src/app/`), nœud de droits dans `SpecialisationDroitsBtp.Routes`,
  textes, test client.
- **Dépendances** : lot 3 ; le filtre par période vient du plan `liste-periodes.md` (souhaitable, non bloquant).
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : utilisateur sans droit RH → 403 ; avec droit → liste filtrable par période et exportable.
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts.
- **Réalisé** : vue par défaut 1013 « Repas du mois » (filtre `periode` `mois_en_cours` sur `date_repas`), thème `repas`, entrée de menu Pointage `/liste/repas?vue=1013`, nœud de droits `pointage/repas` (Consulter ; refusé par défaut aux profils non totaux), `SpecialisationListeBtp.RestrictionAsync` lève 403 sur la source `repas` sans ce droit ; `121` régénéré. Écarts : nœud dédié plutôt qu'un « droit RH » inexistant ; la route reste `/api/listes` (contrôle dans la restriction de la source, pas dans `Routes`) ; test client seul (pas de test C# du 403) ; `npm test` : seuls les 2 échecs anciens, `dotnet test` vert (copie fraîche).

## Lot 5 : liste des restaurants avec lien d'itinéraire (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Contexte** : `terrain.js` n'a pas de carte géographique, la CSP bloque les tuiles externes et aucun écran ne listait les restaurants ; RO3 tranchée sans carte. Coordonnées existantes (`coordonnee.coo_latitude/longitude`, `db/239`, `GeocodageBtp.cs`) non utilisées ici.
- **Fichiers** : page `client/src/app/pages/restaurants.js` (route `/pointage/restaurants`, entrée de menu Pointage, droit `pointage`), `lienItineraire` de `client/src/app/terrain/terrain.js` réutilisée, `api.pointage.restaurants` existante (le DTO `RestaurantPointage` reçoit `Adresse`), textes, test client.
- **Dépendances** : RO3 tranchée.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : adresse connue → lien d'itinéraire du terrain ; sans adresse → pas de lien ; entrée de menu protégée.
- **Critère de fin** : `npm test` vert.
- **Réalisé** : page simple (pas de vue de liste : le module Liste n'a pas de colonne lien) ; recherche par nom ou ville ; préférence de navigation du terrain. Écarts : pas de rattachement chantier ou agence (absent des données) ; `DistanceKm` non utilisée ; `dotnet test` voir compte rendu.
