# Module Rentabilité – contexte

## Rôle
- Suivi économique des chantiers ([analyse](../../documentation/conception/ANALYSE-MODULE-ANALYSE.md)) : indicateurs budget, budget d'exécution, engagé, déboursé, facturé, par chantier, ordre d'exécution et nature, calculés en **faits** (une donnée élémentaire datée par ligne de pièce, pointage, tâche ou mouvement de stock) que la page des faits et le rapprochement montrent tels quels.
- Sans métier : ne connaît ni les chantiers, ni les pièces, ni les natures ; le cœur fournit les faits et les axes par `SpecialisationRentabilite` (cœur : `src/LogiBTP.Api/Btp/RentabiliteBtp.cs`). Module facultatif `rentabilite` de `module_societe` (`db/258`).

## Dépendances
- JS `@logibtp/rentabilite` → `@logibtp/socle`. .NET : `LogiBTP.Rentabilite` (codes, faits, comparaison), `LogiBTP.Rentabilite.Web` → `LogiBTP.Socle.Web`, EF Core Npgsql. Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`SpecialisationRentabiliteBtp`, `ParametresRentabiliteBtp`, `db/258` : clés étrangères, rôles des types, taux, coefficients, triggers de signalement ; pages `client/src/app/pages/rentabilite.js`).

## Structure
- `db/099r_rentabilite.sql` (rejouable) : `rentabilite_calcul` (un calcul par chantier : déclencheur FILE / NUIT / MANUEL, version des règles, état, ajouts, retraits, écarts de la nuit), `rentabilite_fait` (faits **versionnés** : `afa_calcul_debut` / `afa_calcul_fin` ; jamais effacés, un fait disparu est clos), `rentabilite_a_recalculer` (file : un chantier par ligne, prioritaire, reprise différée après une erreur), `rentabilite_execution` (dernier recalcul de nuit par base), `f_rentabilite_signaler(INT[], raison)` (appelée par les triggers du cœur).
- `dotnet/LogiBTP.Rentabilite` : `Codes.cs` ↔ `js/src/codes.js` (`INDICATEUR`, `COMPOSANTE`, `SOURCE_FAIT`, `ETAT_CALCUL`, `DECLENCHEUR` ; parité par `CodesTests`), `Fait.cs` (normalisation à 6 décimales, clé de comparaison), `ComparaisonFaits.cs` (différence en multiensemble : retraits, ajouts, modifiés, inchangés).
- `dotnet/LogiBTP.Rentabilite.Web` : `SpecialisationRentabilite` (méthode patron : `CalculerAsync`, `ChantiersOuvertsAsync`, `ChantierAsync`, `OrdresAsync`, `NaturesAsync`, `PiecesAsync`, `PorteeAsync` — chantiers visibles, coûts PA / PR, types masqués —, `RapprochementAsync`, `ReglesControle`, `DependDuJour`), `ServiceRentabilite` (`RecalculerAsync` : un chantier entier dans une transaction sous verrou consultatif, diff puis clôture et COPY binaire ; erreur → calcul ERREUR et reprise différée ; `TraiterFileAsync`, `NuitAsync` : recalcul de tous les chantiers ouverts, écarts comptés hors faits dépendant du jour ; `DetailAsync` : agrégats par ordre, nature, indicateur, composante jusqu'à une date, contrôles, fraîcheur ; `FaitsAsync` : filtre `FiltreFaits.Lire` — indicateurs et natures en listes, nature 0 = non ventilé, ordre 0 = sans ordre, composante `!X` = sauf X —, PA / PR masqués sans le droit, pièces d'un type non consultable résumées ; `RapprochementAsync`), `PlanificateurRentabilite` (par base : file toutes les `IntervalleSecondes`, nuit à `HeureNuit` ; section `Rentabilite` : Actif, IntervalleSecondes, ChantiersParPassage, HeureNuit), `Extensions.cs` (`AddModuleRentabilite<T>`, `MapModuleRentabilite`).
- `js/src/indicateurs.js` : colonnes du Détail (`COLONNES_DETAIL` : budget, budget d'exécution, engagé, déboursé, dépensé, reste à dépenser, budget PV, facturé, reste à facturer ; teinte, sens normal, indicateurs des faits), `anomalie` (montant anormal en rouge selon le sens), `lignesDetail` (total en haut, regroupements › natures, non ventilé, postes de pied), `regrouperFaits` (sous-totaux par pièce, annulées masquées mais comptées, un total par indicateur quand le chiffre en mêle plusieurs). Calculs en décimal, jamais en `Number`.
- `js/ui/index.js` (+ `rentabilite.css`, export `@logibtp/rentabilite/ui`) : `TableauDetail` (bandes de couleur par indicateur, double-clic = faits du chiffre, Ctrl : nouvelle fenêtre ; postes de pied jamais en rouge), `TableauFaits`.

## Routes HTTP (préfixe `/api/rentabilite`, module activé par société, nœud de droits `rentabilite`, coûts : `rentabilite/couts`)
- `GET /file`, `POST /recalculer-tout` (administrateur) ; `GET /chantiers/{id}?au=` (Détail), `POST /chantiers/{id}/recalculer`, `GET /chantiers/{id}/faits?indicateur=&nature=&ordre=&composante=&piece=&du=&au=`, `GET /chantiers/{id}/rapprochement`.
- Paramètres (cœur) : `GET /rentabilite/parametres`, `PUT /rentabilite/parametres/roles|taux|coefs` (administrateur ; chantiers ouverts remis en file).

## Textes et icônes
- Textes `rentabilite.*` du `fr.json` du module (indicateurs, composantes, sources, colonnes, anomalies, détail, faits), icônes `rentabilite_*`, couleurs `--rentabilite-*` (`js/personnalisation/theme.css`). Écrans du cœur : `rentabilite_btp.*` (règles des faits `rentabilite_btp.regles.<CODE>`, rôles `rentabilite_btp.roles.<ROLE>`), icônes `rentabilite_btp_*`.

## Tests
- `npm test --workspace modules/rentabilite/js` ; `dotnet test modules/rentabilite/dotnet/LogiBTP.Rentabilite.Tests` (parité des codes, comparaison des faits).
