# Module Bibliothèque – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes) : [BIBLIOTHEQUE.md](../../documentation/modules/BIBLIOTHEQUE.md).

## Rôle
- Éléments `ARTICLE`, `OUVRAGE`, `ENSEMBLE`, `POSTE_PIED` (poste de pied réutilisable, sans prix : `ele_pied_niveau` HT/TTC, `ele_pied_mode` P/M/C, `ele_pied_base`, `ele_pied_sens` DEDUCTION/AJOUT, `ele_pied_valeur`, `ele_pied_retenue`, `ele_cpt_code`, `ele_tva_code` ; `063`, rejouable ; genre `ele_pied_genre` REMISE / PRORATA / ACOMPTE / PAIEMENT_DIRECT / RETENUE / AUTRE (`GENRE_POSTE` ↔ `GenrePoste`, `066`), recopié sur la ligne en `lig_proprietes.genre_poste` ; détail : `poste` de `ElementDetailDto`) : plusieurs bibliothèques (code d'appel `CODE` dans la sienne, `BIB:CODE` ailleurs), familles hiérarchiques, natures (axe analytique, regroupement, types ; comptes : ventilation de l'application), gestion (STOCK, ACHAT, SOUS_TRAITANCE, NON_GERE).
- Prix par unité de stock (6 décimales) : scénario de PA → PR = PA × coef FG → PV = PR × coef bénéfice (ou PV fixe, coefficient déduit) → PV net = PV × coef remise. Multi-unité par formules sur les données techniques, tarifs fournisseurs, historique des prix, coefficients par période.

## Dépendances
- Dépend de : socle (`D`, `S`, `arr6`, `evaluerExpression`, `ErreurCalcul`, `texteBrut` ; `LogiBTP.Socle.Web`). Aucune dépendance au module Document ni au Métré : la composition est un JSON opaque pour le module.
- Utilisations par le cœur : voir le détail.

## Repères
- La fiche d'un élément passe par le module Fiche (type `element`, verrou, empreinte), pas par `ServiceBibliotheque`.
- Composition (`ele_composition`) : JSON opaque pour le module ; prix des composés calculés par le cœur.
- `FournisseurBibliothequeMemoire.apresEcriture` rejoue le recalcul du serveur et le trigger d'historique.
- Appel par code : code dans la bibliothèque du document, sinon `BIB:CODE`, sinon code-barres.

## Règles répliquées JS / C# et jeux de cas
- Prix et unités : `calcul.js` ↔ `CalculElement.cs`, jeu `tests/cas/01_calcul.json` (date fixe 2026-10-11) ; prix net d'un tarif = prix public × (1 − r1) × (1 − r2) arrondi, sinon le prix saisi (`prixNetTarif` ↔ `PrixNetTarif`, contrôles `controlerTarif` ↔ `ControlerTarif`).
- Coefficients effectifs (imposé > période de la nature > période globale > défaut) : `coefficientsEffectifs` ↔ `CoefficientsElement.cs`, jeu `tests/cas/02_coefficients.json`.
- Prix des composés (cœur) : `calculerOuvrage` / `calculerEnsemble` (`client/src/app/bibliotheque/bibliotheque.js`) ↔ `ElementsBibliotheque.CalculerOuvrage` (ensemble = totaux de la tranche titre racine ; ouvrage à PV fixe : PV imposé à la racine de la composition, ventilé par le moteur selon le mode, coefficient de bénéfice déduit PV / PR, repris en PV fixe à l'insertion dans un document et envoyé depuis une ligne à PV fixe ; pas de PV fixe pour un ensemble) ; jeu cœur `tests/cas/15_ensemble_tranche_parametree.json`.

## Conventions et pièges
- Historique des prix : uniquement par les triggers ; renseigner `ele_maj_par` et `ele_commentaire_prix` dans la même écriture, ne jamais insérer dans `historique_prix_element` à la main.
- Période de coefficients commencée : ni modifiable ni supprimable (`PERIODE_COMMENCEE`) ; en créer une nouvelle. Enregistrer / supprimer une période recalcule les éléments.
- Élément vendu (ARTICLE, OUVRAGE) : nature obligatoire (`elementVendu` ↔ `TypeElement.EstVendu`, `TYPE_ELEMENT` ↔ `TypeElement` ; contrôle `METIER` du champ `nat_id` dans `FicheElement.validerMetier` ↔ `ValiderMetier` du cœur).
- Code de bibliothèque `^[A-Z0-9_]{1,10}$` (jamais « : ») ; bibliothèque avec éléments : désactiver, pas supprimer.
- Prix copiés dans le document à l'appel (ne suivent plus la bibliothèque) ; envoi document → bibliothèque : coefficients de la ligne imposés à l'élément.
- Démo : modifier `client/src/app/bibliotheque/donnees.js` puis `npm run generer-vues-liste --workspace client` (régénère `db/116` et `scripts/demo/bibliotheque-demo-complements.sql` : compléments rejouables, par code, pour une base de démonstration déjà créée, hors manifeste) ; toute composante d'ouvrage de démonstration porte sa nature.

## Textes et icônes (module Personnalisation, lot P3h)
- Textes, icônes et couleurs par `js/personnalisation/` (règles et exceptions gardées en littéraux : voir le détail).

## Tests
- `npm test --workspace modules/bibliotheque/js` ; `dotnet test modules/bibliotheque/dotnet/LogiBTP.Bibliotheque.Tests` (ou `dotnet test LogiBTP.slnx`).
- Composés : jeux du cœur (`npm test`, `npm run exporter-resultats`, `dotnet test LogiBTP.slnx`).

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Module Bibliothèque : calcul des prix et des unités répliqué entre `modules/bibliotheque/js/src/calcul.js` et `CalculElement.cs` (jeu `01_calcul.json`) ; prix d'ouvrage par le moteur de devis (`calculerOuvrage` / `ElementsBibliotheque.CalculerOuvrage`) ; historique des prix par trigger (`ele_maj_par`, `ele_commentaire_prix`) ; coefficients par période répliqués entre `coefficientsEffectifs` (calcul.js) et `CoefficientsElement.cs` (jeu `02_coefficients.json`). Données de démonstration dans `client/src/app/bibliotheque/donnees.js` (puis `npm run generer-vues-liste --workspace client` pour `db/116`).
- Tarifs fournisseurs, lot 8 des demandes du 25/10/2026 (module Bibliothèque `065`) : prix public, remises 1 et 2, délai, code-barres ; prix net répliqué entre `prixNetTarif` (calcul.js) et `CalculElement.PrixNetTarif` (jeu `01_calcul.json`) ; saisie depuis l'onglet Tarifs de la fiche fournisseur ; import CSV à format fixe (`client/src/app/annuaire/import-tarifs.js`, `POST /api/bibliotheque/tarifs/import` : simulation puis import, journal `tarif_import`) ; délai d'un article pour l'approvisionnement du Stock : dépôt > tarif principal > élément > délai du dépôt.
- Bibliothèque, lot 7 des demandes du 25/10/2026 (module `064`, `db/237`) : mots-clés et code-barres cherchés par F3 et les listes (code-barres lu dans la colonne Code), type TEXTE (ligne de texte, textes de l'édition), description technique (`lignes[].description_html` des éditions), délai de livraison global, onglet Utilisations de la fiche élément (ouvrages et ensembles qui l'utilisent, achats de l'article).
