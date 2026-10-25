# Module Comptabilité (base) – contexte

## Rôle
- Base comptable (lots 1 et 2) réutilisée par le futur module complet ([ANALYSE-MODULE-COMPTABILITE.md](../../documentation/conception/ANALYSE-MODULE-COMPTABILITE.md)) : plan comptable, paramètres (longueur des comptes, complétion par des zéros, préfixes des comptes de tiers, TVA sur les débits), collectifs par type de tiers, catégories de TVA (comportement du calcul, mention réglementaire, exigibilité), comptes des taux de TVA et comptes auxiliaires des tiers (par la spécialisation).
- Toujours présent (C1) ; sans métier BTP : types de tiers, taux de TVA et tiers fournis par l'application (`SpecialisationComptabilite`).

## Dépendances
- Dépend de : `LogiBTP.Socle` / `LogiBTP.Socle.Web`, EF Core Npgsql ; JS sans dépendance. Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`Btp/ComptabiliteBtp.cs` : `SpecialisationComptabiliteBtp` ; `db/223` ; pages `client/src/app/pages/comptabilite.js` ; champs de la fiche personne).

## Structure
- `js/src/comptes.js` : `normaliserCompte`, `normaliserCompteTiers`, `proposerCompteTiers`, `classeCompte`, `MESSAGES_COMPTES` ↔ `dotnet/LogiBTP.Comptabilite/ReglesComptes.cs` (`Normaliser`, `NormaliserTiers`, `Proposer`, `Classe`, `Messages`) ; jeu `tests/cas/01_comptes.json`.
- `dotnet/LogiBTP.Comptabilite.Web` : `Donnees.cs` (entités `compte_comptable`, `parametre_comptabilite`, `collectif_tiers`, `categorie_tva`, DTO), `SpecialisationComptabilite.cs` (`TauxAsync`, `EnregistrerTauxAsync`, `TiersAsync`, `EnregistrerComptesTiersAsync`, `UtilisationsCompteAsync`, `TauxDeCategorieAsync`, `TypeHerite`, `NaturesAsync`, `TypesDocumentsAsync`, `EnregistrerTypesDocumentsAsync`), `ServiceComptabilite.cs` (service, `AddModuleComptabilite<T>`, `MapModuleComptabilite`).
- `js/src/ventilation.js` : `compteVentilation`, `chaineTypes`, `ORIGINES_VENTILATION`, `MESSAGES_VENTILATION` ↔ `ReglesVentilation.cs` (`Compte`, `ChaineTypes`) ; jeu `tests/cas/02_ventilation.json`.
- `db/094b_comptabilite_ventilation.sql` (rejouable) : `type_comptable` (parent, sens, journal, compte par défaut, comptes des postes : remise, retenue — ou compte du tiers —, acompte, paiement direct, prorata, écarts d'arrondi), `ventilation_compte` (type × nature et / ou taux, codes → compte).
- `db/094_comptabilite.sql` (rejouable) : `compte_comptable` complétée (type GENERAL / COLLECTIF / TVA / TRESORERIE, sens VENTE / ACHAT / LES_DEUX / AUCUN, libellé court, lettrable), `parametre_comptabilite`, `collectif_tiers`, `categorie_tva`.

## Règles
- Compte général : chiffres, classe 1 à 9, longueur maximale ; avec la complétion, complété par des zéros à droite (704 → 704000). Compte de tiers : lettres et chiffres en majuscules, 17 au plus sans paramètre. Compte proposé : préfixe du type de compte + code du tiers sans ses lettres de tête (T000123 → C000123), zéros de tête retirés s'il est trop long.
- Un compte existant ne change pas de code ; suppression refusée s'il est utilisé (lignes, natures, tiers, taux, collectifs : `CPT_UTILISE`), le désactiver.
- Un compte auxiliaire = un seul tiers (`CPT_TIERS_DOUBLON`, contrôle des comptes saisis seulement) ; collectifs et comptes des taux pris dans le plan (`CPT_INCONNU`).
- Catégorie de TVA retirée : supprimée si aucun taux ne s'y rattache (`TVA_CATEGORIE_UTILISEE`) ; le comportement d'un taux suit sa catégorie.
- Ventilation (compte d'une ligne) : compte saisi, clé nature + taux, clé nature, clé taux, compte par défaut du type ; aux étapes 2 à 5 le type de la pièce avant son parent (boucle refusée : `TCO_BOUCLE`) ; sinon `COMPTE_INTROUVABLE`. Une clé porte une nature ou un taux (`VCO_CLE`), connus de l'application (`VCO_NATURE`, `VCO_TAUX`), une seule fois (`VCO_DOUBLON`).
- Génération des comptes de tiers : tiers actifs sans compte ; un type qui hérite d'un autre type du même tiers (sous-traitant → fournisseur) n'en reçoit pas ; compte déjà pris ou impossible : refusé et signalé.

## Routes HTTP (préfixe `/api/comptabilite`, nœud de droits `comptabilite`)
- `GET|PUT /parametres` ; `GET|POST /plan`, `PUT|DELETE /plan/{code}` ; `GET|PUT /collectifs` ; `GET|PUT /categories-tva` ; `GET|PUT /taux-tva` ; `GET|PUT /tiers`, `POST /tiers/generer` { type_compte } ; `GET|PUT /types-comptables` ; `GET /ventilation`, `PUT /ventilation/{type}` (liste complète du type), `GET /ventilation/regle` (types, clés, type comptable de chaque type de document) ; `GET /natures` ; `GET|PUT /types-documents`.

## Tests
- `npm test --workspace modules/comptabilite/js` ; `dotnet test modules/comptabilite/dotnet/LogiBTP.Comptabilite.Tests` (même jeu).
