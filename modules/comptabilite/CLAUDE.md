# Module Comptabilité (base) – contexte

## Rôle
- Base comptable réutilisée par le futur module complet ([ANALYSE-MODULE-COMPTABILITE.md](../../documentation/conception/ANALYSE-MODULE-COMPTABILITE.md)) : plan comptable, paramètres (longueur des comptes, complétion par des zéros, préfixes des comptes de tiers, TVA sur les débits), collectifs par type de tiers, catégories de TVA (comportement du calcul, mention réglementaire, exigibilité), comptes des taux de TVA et comptes auxiliaires des tiers (par la spécialisation).
- Toujours présent (C1) ; sans métier BTP : types de tiers, taux de TVA et tiers fournis par l'application (`SpecialisationComptabilite`).

## Dépendances
- Dépend de : `LogiBTP.Socle` / `LogiBTP.Socle.Web`, EF Core Npgsql ; JS sans dépendance. Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`Btp/ComptabiliteBtp.cs` : `SpecialisationComptabiliteBtp` ; `db/223` ; pages `client/src/app/pages/comptabilite.js` ; champs de la fiche personne).

## Structure
- `js/src/comptes.js` : `normaliserCompte`, `normaliserCompteTiers`, `proposerCompteTiers`, `classeCompte`, `MESSAGES_COMPTES` ↔ `dotnet/LogiBTP.Comptabilite/ReglesComptes.cs` (`Normaliser`, `NormaliserTiers`, `Proposer`, `Classe`, `Messages`) ; jeu `tests/cas/01_comptes.json`.
- `dotnet/LogiBTP.Comptabilite.Web` : `Donnees.cs` (entités `compte_comptable`, `parametre_comptabilite`, `collectif_tiers`, `categorie_tva`, DTO), `SpecialisationComptabilite.cs` (`TauxAsync`, `EnregistrerTauxAsync`, `TiersAsync`, `EnregistrerComptesTiersAsync`, `UtilisationsCompteAsync`, `TauxDeCategorieAsync`, `TypeHerite`), `ServiceComptabilite.cs` (service, `AddModuleComptabilite<T>`, `MapModuleComptabilite`).
- `db/094_comptabilite.sql` (rejouable) : `compte_comptable` complétée (type GENERAL / COLLECTIF / TVA / TRESORERIE, sens VENTE / ACHAT / LES_DEUX / AUCUN, libellé court, lettrable), `parametre_comptabilite`, `collectif_tiers`, `categorie_tva`.

## Règles
- Compte général : chiffres, classe 1 à 9, longueur maximale ; avec la complétion, complété par des zéros à droite (704 → 704000). Compte de tiers : lettres et chiffres en majuscules, 17 au plus sans paramètre. Compte proposé : préfixe du type de compte + code du tiers sans ses lettres de tête (T000123 → C000123), zéros de tête retirés s'il est trop long.
- Un compte existant ne change pas de code ; suppression refusée s'il est utilisé (lignes, natures, tiers, taux, collectifs : `CPT_UTILISE`), le désactiver.
- Un compte auxiliaire = un seul tiers (`CPT_TIERS_DOUBLON`, contrôle des comptes saisis seulement) ; collectifs et comptes des taux pris dans le plan (`CPT_INCONNU`).
- Catégorie de TVA retirée : supprimée si aucun taux ne s'y rattache (`TVA_CATEGORIE_UTILISEE`) ; le comportement d'un taux suit sa catégorie.
- Génération des comptes de tiers : tiers actifs sans compte ; un type qui hérite d'un autre type du même tiers (sous-traitant → fournisseur) n'en reçoit pas ; compte déjà pris ou impossible : refusé et signalé.

## Routes HTTP (préfixe `/api/comptabilite`, nœud de droits `comptabilite`)
- `GET|PUT /parametres` ; `GET|POST /plan`, `PUT|DELETE /plan/{code}` ; `GET|PUT /collectifs` ; `GET|PUT /categories-tva` ; `GET|PUT /taux-tva` ; `GET|PUT /tiers`, `POST /tiers/generer` { type_compte }.

## Tests
- `npm test --workspace modules/comptabilite/js` ; `dotnet test modules/comptabilite/dotnet/LogiBTP.Comptabilite.Tests` (même jeu).
