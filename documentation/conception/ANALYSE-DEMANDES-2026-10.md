# Analyse des demandes d'évolution et des anomalies (25/10/2026)

Liste reçue le 25/10/2026 : bugs et améliorations à analyser et découper avant développement. Pour chaque point :
ce qui existe dans le code, ce qui manque, les dépendances et une taille indicative. Les points sont ensuite
regroupés en lots ordonnés (§ 3). Aucun code n'a été modifié.

Tailles : **S** moins d'une demi-journée, **M** une à deux journées, **L** trois à cinq journées, **XL** plus d'une
semaine (à redécouper). Repères : `B` anomalie, `A` amélioration, `E` à étudier.

## 1. Anomalies

| Réf. | Anomalie | Constat dans le code | Correction proposée | Taille |
|---|---|---|---|---|
| B1 | Exécution : « écran pas encore disponible » à l'ouverture d'un ordre depuis une liste | `estTypeDocument` (`client/src/app/listes.js:47`) ne reconnaît que `^[VAS]_` : les types E_ (ordres) et T_ (sous-traitance) passent à `ficheDeLigne`, qui ne trouve rien, d'où le message de `Application.ouvrirElement` (`application.js:334`). Les listes de la sous-traitance (`st_ao`, `st_commandes`, `st_factures`) ont le même défaut. | Reconnaître toutes les familles de documents (liste des familles du module Document plutôt qu'une expression en dur), test Vitest sur `urlElement`. | S |
| B2 | Fiche chantier : l'onglet Fil rétrécit la vue et l'impose aux autres onglets | `FilCrm` ajoute la classe `crm-fil-hote` (largeur max. 52rem, centrée : `styles.css:390`) au conteneur reçu, qui est le `.fiche-corps` commun à tous les onglets (`crm/fil.js:34`), sans jamais la retirer. | Créer un sous-conteneur `crm-fil-hote` dans le corps de l'onglet (solution propre ; retirer la classe au changement d'onglet n'est qu'un palliatif). | S |
| B3 (non reproduite) | Planning : la tâche n° 50 n'apparaît pas sur la ligne de S04967 (vue Atelier par jour, filtre Atelier) mais apparaît avec le filtre Fabrication bois | Le serveur développe bien les sous-services (`ServicesDeAsync`) ; en regroupement RESSOURCE, une ressource n'est rangée que sous son service **principal** (`service_membre.sme_principal`, `SpecialisationPlanningBtp.RessourcesAsync`) et les barres d'une ressource sans ligne ne s'affichent pas. Pistes : service principal de S04967 absent ou différent de son service d'affectation, ligne de service filtrée côté client, service de la tâche. Lot 0 : non reproduite sur `logibtp_demo` (S04967, intérimaire, service principal Fabrication bois ; tâche 50 du service Atelier) : le serveur renvoie la barre avec les deux filtres et elle s'affiche sous le groupe Fabrication bois, en fin de liste (≈ 1 140 lignes avec le filtre Atelier). À revoir avec la base et la période en cause. | M |
| B4 | Planning, équipes : sur E001, 3 ressources de la vue des ressources sont masquées par les filtres alors qu'aucun filtre n'est posé | `choisirRessources` garde les « sélections masquées » et des filtres d'affichage mémorisés ; probable filtre resté dans les préférences ou ressources hors du service de l'équipe. Lot 0 : cause trouvée. `GET /planning/disponibilites` rendait les 1 000 premières ressources par ordre alphabétique ; les membres de E001 au-delà étaient comptés « masqués par les filtres ». Corrigé : les ressources déjà choisies sont toujours rendues (paramètre `inclure`), la fenêtre signale une liste limitée. | S-M |
| B5 | Fiche salarié : le service n'est pas celui des modules Exécution et Planning | Le référentiel `service` / `service_membre` est déjà dans le cœur (`db/193`, page `/parametres/services`) ; mais la fiche salarié saisit `sal_service`, texte libre à 4 valeurs en dur (`fiches/definitions.js:54`), lu encore par `ExecutionBtp.cs:244`, `MagasinBtp.cs:50` et `db/130` (type de MO). Le planning lit le service principal de `service_membre`. Deux vérités. | Champ géré « Service principal » dans la fiche (lecture et écriture de `service_membre` par `SpecialisationFicheBtp`, comme les champs gérés), `sal_service` déduit ou supprimé, lecteurs repris, vues de liste. | M |
| B6 | Bibliothèque, composition des ouvrages : pas de pied, la liste des natures ne marche pas, colonnes non choisissables, pas de panneau de détail | `FicheElement.#composition` (`fiche-element.js:203`) crée un `EditeurDevisBtp` nu : sans les référentiels que la page document lui fournit (natures), sans `GestionVuesDocument`, sans `PanneauxBtp` ni `Disposition` ; le mode de calcul est un `<select>` simple (contraire à la règle des combos). | Factoriser avec la page document : référentiels, vues de colonnes (vue par défaut « composition »), panneau de détail des lignes en dock ; pied de la composition à afficher ou à exclure clairement (un ouvrage n'a pas de postes de pied). | M-L |
| B7 | Paramètres : largeur limitée | `.page-parametres { max-width: 64rem }` (`client/src/styles.css:63`). | Supprimer la limite (les tableaux restent à la largeur de leur contenu). | S |

## 2. Améliorations, par module

### 2.1 Ressources

| Réf. | Demande | Existant | Manque | Dépendances | Taille |
|---|---|---|---|---|---|
| A1 | Onglet Habilitations du salarié en tableau | Déjà un `<table>` simple (`ressources-ui.js:42`). | Présentation `.tableau-compact` (en-têtes figés, champs pleine cellule, boutons dans `.cellule-boutons`) comme le Pointage. | — | S |
| A2 | Onglet Dotations : totaux et filtre de période (1 mois, 6 mois, 1 an) | `rendreDotationsSalarie` (`stock/magasin.js:275`) lit tout depuis 2000 ; l'API `dotations` accepte `du` / `au`. | Ligne de totaux (sorti, rendu, rebut, doté), boutons de période filtrant les mouvements (le doté reste au jour), préférence de période. | — | S |
| A3 | Affectations du matériel au salarié (direct ou par un autre matériel) et EPI immatriculés comme du matériel | Aucune affectation de matériel (`mat_chantier` texte libre) ; EPI = articles de stock dotés. | Onglet « Matériel affecté » du salarié, alimenté par A7 ; EPI immatriculé = matériel de type EPI (A5). | A5, A7 | M |
| A4 | « Habilitations à surveiller » → entretiens et visites | Menu, page et service (`menus.js:21`, `pages/habilitations.js`, `Ressources.cs:125`). | Libellé « Habilitations, entretiens et visites à surveiller » ; contenu complété par les échéances d'entretien de A9. | A9 pour le contenu | S |
| A5 | Matériel : type, marque, modèle, n° de série, immatriculation, dates d'entrée, de sortie, de mise en service, fin de garantie, énergie, poids et dimensions | Marque et n° de série déjà déclarés dans la fiche (`mat_marque`, `mat_numero_serie`) ; famille en liste en dur (`mat_famille`) ; date d'achat. | Colonnes `mat_*` (`ALTER TABLE` du cœur), type de matériel relié à la liste paramétrable A23 (remplace `mat_famille`), groupes de la fiche, vues de liste. | A23 | M |
| A6 | Matériel en location : tiers, commande, fin de location | Rien. | Groupe Location : loueur (personne de l'annuaire), commande fournisseur liée (document A_COMMANDE), fin de location ; alerte de fin de location (notification). | Notifications | S-M |
| A7 | Gestion des affectations (salarié, intérimaire, sous-traitant, autre matériel) avec historique | Le planning affecte des ressources à des tâches (`pla_affectation`), sans affectation durable. | Table `materiel_affectation` datée (début, fin, cible typée, matériel porteur), règle de non-chevauchement répliquée JS ↔ C# avec jeu, onglet Affectations du matériel et du salarié, petit outillage dans un camion (matériel porteur : le contenu suit le porteur). | A5 | L |
| A8 | Chantier de suivi des coûts du matériel et ordre d'entretien (opérations, pièces du stock) | Modèle déjà en place pour les salariés : chantier de dotation `sal_cha_dotation_id` (`db/219`) ; ordres = famille E du module Document (`019h`, types E_OE, E_PO, E_DAP) ; sorties de stock vers un chantier (magasin). | Chantier de matériel (`mat_cha_id`, créé à la première imputation, type MATERIEL de A20), nouveau type d'ordre E_ENTRETIEN (lignes = opérations et pièces, sortie du stock à la validation par `MouvementsStockBtp`), coûts (entretien, réparation, pièces, consommables, carburant) par natures sur ce chantier. | A20, modules Exécution et Stock | L-XL |
| A9 | Historique des compteurs avec événements et entretiens | `mat_heures`, `mat_heures_revision` (valeurs uniques). | Table `materiel_compteur` (date, valeur, unité h / km, source), événements (panne, sinistre, contrôle VGP) et entretiens liés à A8, échéances d'entretien par compteur ou par date (règle répliquée avec jeu), alimente A4. | A8 | L |

### 2.2 Tarifs fournisseurs

| Réf. | Demande | Existant | Manque | Dépendances | Taille |
|---|---|---|---|---|---|
| A10 | Ajout manuel de tarifs depuis la fiche fournisseur | Onglet Tarifs de la fiche personne en lecture seule (`fiche-annuaire.js:323`) ; tarifs saisis dans la fiche élément (`tarif_fournisseur`, module Bibliothèque). | Saisie dans l'onglet du fournisseur (élément par combo, ajout, modification, retrait). | A11 | M |
| A11 | Prix public, unité d'achat, remises 1 et 2, PA, réf. et libellé fournisseur, délai, code-barres | `tarif_fournisseur` : réf., libellé, unité, prix, période, principal, lien. | Colonnes `tfo_prix_public`, `tfo_remise1`, `tfo_remise2`, `tfo_delai`, `tfo_code_barre` ; PA = prix public × (1 − r1) × (1 − r2) (ou saisi) dans `calcul.js` ↔ `CalculElement.cs` avec un cas dans `01_calcul.json` ; scénarios de PA à revoir. | Module Bibliothèque (règles répliquées) | M |
| A12 | Import CSV à format fixe | Module Import : devis OptimBTP seulement. | Format fixe documenté, aperçu, contrôle (élément par code, réf. fournisseur ou code-barres), création ou mise à jour, rapport ; formats personnalisés plus tard par le module Import. Question : module « Tarifs fournisseurs » à part (souhaitable, il grossira : catalogues, remises par famille) ou extension de la Bibliothèque. | A11 | M-L |

### 2.3 Annuaire

| Réf. | Demande | Existant | Manque | Dépendances | Taille |
|---|---|---|---|---|---|
| A13 | Photo ou logo des personnes et individus, repris par le salarié et le compte | Modèle : image d'élément `ele_image_ged` (GED) ; rien sur `personne` ni `individu`. | `per_image_ged`, `ind_image_ged` (document GED), vignette dans l'entête des fiches, la fiche salarié (par `sal_ind_id`) et Mon compte. | GED | M |
| A14 | Assujetti à la TVA, type de tiers pour la facture électronique, chargé d'affaires | Facturation électronique : format, plateforme, adresse, routage, Chorus Pro (`070`). | `per_assujetti_tva`, type de tiers FE (B2B, B2C, B2G, international : à préciser avec le futur module Facturation électronique), `per_cli_charge_ind_id` (individu de notre société). | Module Facturation électronique (TODO) | S-M |
| A15 | Mode de règlement et délai de paiement distincts client et fournisseur | Un seul couple `per_mode_reglement`, `per_delai_paiement`, options en dur. | `per_cli_*` et `per_fou_*` (reprise de l'existant dans les deux), lus par le choix de la condition du document (`SpecialisationReglementBtp` / échéancier) selon la famille, listes reliées à A22. | A22 | M |
| A16 | Fournisseur : TVA intracommunautaire | Catégories de TVA du module Comptabilité (INTRACOM, comportement I). | Case ou catégorie de TVA par défaut du fournisseur, proposée sur ses pièces d'achat. | Module Comptabilité | S |
| A17 | Activités multiples avec liste hiérarchique paramétrable (TP › démolition, terrassement, VRD ; gros œuvre › génie civil, maçonnerie…) | Corps d'état du sous-traitant en texte libre (`per_st_corps_etat`). | Table `activite` à deux niveaux (comme `service`), colonne `per_activites` (tableau, colonne multivaluée `ARRAY` du module Liste pour filtrer), saisie par `choixMultiple`, page de paramétrage. | Module Liste (colonnes ARRAY : existant) | M |

### 2.4 Bibliothèque

| Réf. | Demande | Existant | Manque | Dépendances | Taille |
|---|---|---|---|---|---|
| A18a | Mots-clés de recherche (domino = sucre, connecteur rapide…) | Recherche sur code et libellé. | `ele_mots_cles` (tableau), pris par la recherche de la liste et par l'appel F3. | Module Liste (recherche répliquée JS ↔ C#) | S-M |
| A18b | Unités globales : décimales par défaut et synonymes (M² = M2, m2, m²) | Table `unite` avec `unt_precision_qte` (module Document) ; pas d'écran dédié repéré. | `unt_synonymes`, normalisation à la saisie et à l'import (OptimBTP, CSV de A12), page de paramétrage. | Module Import | M |
| A18c | Code-barres global | Rien. | `ele_code_barre` (unique par bibliothèque), recherche ; codes-barres fournisseur en A11. | — | S |
| A18d | Type Texte pour les textes des lignes et les textes d'édition | Types ARTICLE, OUVRAGE, ENSEMBLE, POSTE_PIED ; textes d'édition par type de document (`/parametres/documents`). | Type TEXTE (libellé HTML seul), inséré comme ligne de texte (F3, glisser) et proposé dans l'introduction et la conclusion de l'entête. | Module Document (types de lignes) | M |
| A18e | Délai de livraison global | Délai par fournisseur (`per_fou_delai_livraison`) et par article et dépôt (Stock, lot 3). | `ele_delai_livraison`, ordre de priorité à fixer avec le délai du tarif (A11) et du stock. | A11, Stock | S |
| A18f | Description technique en HTML | Notices techniques en GED. | `ele_description_html` (champ `html` nettoyé par `NettoyerHtml`), variable d'édition. | — | S |
| A18g | Lien vers les ouvrages qui utilisent l'élément | Composition en JSONB (`ele_composition`). | Vue ou index des composantes (élément → ouvrages), lien qui ouvre la liste filtrée. | — | M |
| A18h | Lien vers les lignes de documents d'achat de l'article (état en cours, période) | Lien des lignes `lig_art_id`. | Vue de liste « Achats de l'article » (lignes, document, état, date), lien depuis la fiche avec filtres. | Module Liste | M |

### 2.5 Fiches et listes

| Réf. | Demande | Existant | Manque | Dépendances | Taille |
|---|---|---|---|---|---|
| A19a | Précédent / suivant dans les fiches ouvertes depuis une liste | Retour à la liste (`LISTE_PAR_TYPE`, `routeur.retour`) ; aucune mémoire de l'ordre des lignes. | La liste confie la suite ordonnée des identifiants (page courante ou curseur) à la fiche (`sessionStorage` par fenêtre), boutons ◀ ▶ et raccourcis déclarés ; contrôle des modifications non enregistrées avant de changer. | Modules Liste et Fiche, raccourcis | M |
| A19b | Mise en sommeil (avant archivage), masquée par défaut dans les listes | Chaque table a son propre « actif » (`sal_actif`, `per_actif`, `ele_actif`…) ; services et équipes « en sommeil » = inactifs. | Notion commune du module Fiche : état d'usage ACTIF / NE_PLUS_UTILISER / SOMMEIL (colonne propre à chaque type, déclarée dans la définition), filtre de la définition des vues (sommeil exclu par défaut), contrôles des combos (une valeur « ne plus utiliser » n'est plus proposée en nouvelle saisie). Reprise des colonnes « actif » existantes. | Modules Fiche et Liste, toutes les fiches du cœur | L |
| A19c | « Ne plus utiliser » pour terminer les documents en cours avant la mise en sommeil | — | Inclus dans A19b (état intermédiaire). | A19b | — |

### 2.6 Documents

| Réf. | Demande | Existant | Manque | Dépendances | Taille |
|---|---|---|---|---|---|
| A24a | Date de livraison par ligne, reprise de l'entête par défaut | `ent_date_livraison` et `ent_date_besoin` (Stock, lot 3). | `lig_date_livraison` (module Document), défaut de l'entête et suivi d'un changement de l'entête, colonne, prise en compte par la projection du stock (`projection.js` ↔ `ReglesProjection.cs`, jeu `04`). | Module Stock (règles répliquées) | M |
| A24b | Boutons Aperçu, Envoyer, Fermer en icônes seules, tout à droite | Barre de `PageDocument` (`pages/document.js:48`). | Icônes avec libellé en bulle, groupe calé à droite. | — | S |
| A24c | Enregistrer, Valider, Transformer réunis en un bouton à flèche (clic = enregistrer), placé avant Fermer | Boutons séparés, plus Approuver, Envoyer, Validé par le tiers, Rejeté, N°, Dévalider, Annuler par avoir. | Bouton partagé avec menu (composant du socle réutilisable), états actifs repris de la mise à jour actuelle, raccourcis inchangés. | Socle (nouveau composant) | M |
| A24d | Demandes de prix regroupées en lot pour l'envoi et le choix du fournisseur | Lot de consultation (`ent_consultation`, bouton 📨 sur A_DEVIS) et comparatif des offres (`/consultation/comparatif`, fait pour la sous-traitance) ; envoi par courriel document par document. | Envoi groupé du lot (un courriel par fournisseur, module Mail), comparatif ouvert aux demandes de prix, choix du fournisseur retenu → transformation en commande et autres offres closes (statut). | Modules Mail et Sous-traitance (comparatif) | M-L |
| A24e | Commande fournisseur : n° et date de l'accusé de réception (ARC), pièce jointe en GED | Rien. | `ent_arc_numero`, `ent_arc_date`, catégorie GED `arc`, bloc de l'entête ; la date d'ARC peut remplacer la livraison prévue. Reconnaissance des ARC reçus par courriel (module Mail, lot 4) en option. | GED, Mail | S-M |
| E1 | Poste de travaux | Cité dans les champs OptimBTP non repris (TODO Import). | À étudier : mis dans TODO. | — | — |

### 2.7 Cœur (structure)

| Réf. | Demande | Existant | Manque | Dépendances | Taille |
|---|---|---|---|---|---|
| A20 | Type de chantier pour les listes (chantier, dépôt, matériel, salarié…) | Drapeaux `cha_depot`, `cha_stock_tenu`, `cha_interne`, chantiers de dotation (`sal_cha_dotation_id`). | `cha_type` (CHANTIER, DEPOT, INTERNE, DOTATION, MATERIEL) cohérent avec les drapeaux (contrainte ou dérivation), colonne et segments des listes. | Stock, Pointage | M |
| A21 | Chantier de dotation clos seulement à la mise en sommeil du salarié | Chantier créé à la première sortie (`db/219`). | Règle de statut : jamais clos tant que le salarié n'est pas en sommeil, clos à la mise en sommeil (si plus rien n'est doté, sinon alerte). | A19b, A20 | S |
| A25 | Projet : priorité et évaluation paramétrables, estimation (dates, montant, heures ou jours, adresse et zone de déplacement), informations client (saisie libre, personne, prospect), métreur, responsable = individu | `prj_responsable` texte, `prj_montant_estime`, dates de remise et de décision, tiers. | Colonnes `prj_*`, listes paramétrables (A22), responsable et métreur en individus (combo `individusStructure`), prospect = tiers provisoire de l'annuaire (`creerTiersProvisoire`), zone de déplacement (table du Pointage). | A22, Pointage (zones) | M-L |
| A26 | Chantier : zone de déplacement, code analytique, dates prévues et réelles de travaux, chargé d'affaires, conducteur, chef d'équipe | `cha_date_ouverture`, `cha_date_fin_prevue`, `cha_conducteur_ind_id`, `cha_contact_ind_id` ; zones par chantier et agence dans le Pointage (`poi_zone_chantier`). | Colonnes `cha_*`, individus de notre société, affichage de la zone du Pointage dans la fiche, code analytique repris par l'export comptable (module Comptabilité, lot 3 : à ajouter aux écritures si Sage l'attend). | Comptabilité, Pointage | M |
| A27 | Chantier et marché : lien vers les échéances et règlements ; marché : lien vers les prestations de sous-traitance | Page `/reglements?sens=&tiers=` (filtre par tiers) ; onglet Gestion du marché (réglé / reste) ; marchés de sous-traitance liés par `mar_marche_vente_id`. | Filtre par chantier et par marché de la page des règlements, liens de la fiche ; liste des marchés et commandes de sous-traitance du marché de vente. | Module Règlements | S-M |
| A28 | Bouton retour dans l'interface | `routeur.retour`, bouton ✕ Fermer des fiches et documents. | Bouton ◀ du bandeau (historique de la fenêtre), raccourci déclaré. | Module Navigation | S |

### 2.8 Pointage

| Réf. | Demande | Existant | Manque | Dépendances | Taille |
|---|---|---|---|---|---|
| A29 | Restaurants liés aux personnes (« non trouvé » si absent), proposés d'abord près du chantier, avantage en nature selon l'agence (modifiable par le RH dans les rubriques) | Rien sur les restaurants ; rubriques de paie par profil (`paie.js` ↔ `ReglesPaie.cs`), agences des salariés, zones des chantiers. | Restaurants = tiers de l'annuaire (relation RESTAURANT, adresse géolocalisée), saisie du repas par pointage (bureau et borne), tri par distance au chantier (coordonnées : à prévoir, géocodage ou zone), restaurant « non trouvé » créé en tiers provisoire, règle d'avantage en nature par agence dans les rubriques (jeu `03_paie.json`). | Annuaire, géolocalisation à décider | L |
| A30 | Choix du chantier ou de l'ordre : liste de tous les chantiers et ordres, champ de code servant aussi de filtre (code, libellé, ville, client…) | Borne : tuiles des chantiers proposés (planning du jour, récents) ; le champ ne lit qu'un numéro d'ordre (`borne.js:286`). | Bouton « Tous », filtre en direct des tuiles sur plusieurs champs, numéro d'ordre toujours reconnu à l'Entrée ; route publique de la borne à étendre (chantiers ouverts et ordres en cours). | — | M |

### 2.9 Paramètres

| Réf. | Demande | Existant | Manque | Dépendances | Taille |
|---|---|---|---|---|---|
| A31 | Toutes les listes de paramétrage en tableaux | `.tableau-compact` absent de `parametres-annuaire`, `-bibliotheque`, `-calendriers`, `-crm`, `-editions`, `-ged`, `-modules`, `-raccourcis`, `-ressources`, `-services`, `parametres.js`. | Reprise page par page sur la présentation du Pointage. | — | M |
| A32 | Propositions de non-conformité, avec saisie d'une raison non prévue | Motifs typés NON_CONFORMITE (`motif`, `db/195`, `/parametres/ressources`), choix obligatoire dans la liste à la borne (`borne.js:493`). | Choix « Autre… » avec saisie libre (bureau et borne), motif conservé en texte. | — | S |
| A22 | Listes paramétrables des modes de paiement et des conditions de règlement | `condition_paiement` (module Document, `019b`), modes en dur dans la fiche personne et `ent_mode_reglement` texte. | Table `mode_reglement`, écran commun des deux listes, combos de la fiche personne et de l'entête reliés aux tables (TODO « délai de paiement relié à `condition_paiement` » soldé). | A15 | M |
| A23 | Types de matériel avec regroupement (EPI › chaussures, gants ; VL › fourgon, voiture…) | `mat_famille` en dur. | Table à deux niveaux, paramétrage, reprise des familles existantes. | — | S-M |
| A33 | Chronos : format et reprise | Documents : compteur par type et exercice (`compteur_numero`), préfixe du type ; fiches de la structure : code calculé dans le navigateur (`prochainCode`) ; tiers T000123. | Paramétrage commun du format (préfixe, année, longueur, remise à zéro) et du dernier numéro (reprise d'un ancien logiciel), calcul côté serveur pour tous. | Module Document (numérotation) | M-L |

### 2.10 Comptabilité, Droits

| Réf. | Demande | Existant | Manque | Dépendances | Taille |
|---|---|---|---|---|---|
| A34 | Listes de la comptabilité en tableaux avec saisie | `pages/comptabilite.js` utilise déjà `.tableau-compact` ; saisie dans le plan et les tiers. | À préciser : écrans encore hors présentation commune. | — | S |
| E2 | Tiers par compte dans le module Liste, avec modification | Page propre `/comptabilite/tiers`. Le module Liste sait déjà saisir dans une liste (sources `modifiable`, colonnes `modifiable` : salariés, matériels), sur une vue SQL modifiable d'une seule table. | Source « tiers par compte » (une ligne par tiers et type de compte : vue non modifiable telle quelle, à écrire par une vue à trigger ou par la fiche personne). Plus simple que prévu. | Module Liste | M |
| A35 | SSL activé sur la base | TLS seulement pour une base sur une autre machine (`hostssl`, `compose.distant.yml`, `installation certificat base`) ; réseau Docker local et base de développement sans TLS. | TLS toujours actif (certificat de l'autorité LogiBTP pour le conteneur local aussi), `SSL Mode=Require` ou `VerifyFull` par défaut, `hostssl` seulement. | Module Installation | M |
| A36 | « Aucun chiffrement GSS (Kerberos) : mot de passe transmis sur le réseau » | Connexion : `GSS Encryption Mode=Disable` ; authentification `scram-sha-256` (`ConfigurationPostgres.cs`). | Avec SCRAM, le mot de passe ne circule jamais en clair (défi et réponse) ; le message vient de l'absence de chiffrement de la connexion. GSS est l'alternative Kerberos au TLS (domaine Active Directory requis) : inutile ici. A35 fait disparaître le risque (données en clair) ; vérifier qu'aucune règle `md5` ou `password` ne subsiste. | A35 | S |

### 2.11 Ouvrages fabriqués (à étudier)

E3 : stocker les ouvrages fabriqués par l'atelier et les gérer en stock, ou les acheter déjà fabriqués (lien avec les
tarifs fournisseurs). Aujourd'hui `ele_gestion = 'STOCK'` vise les articles ; un ouvrage stocké suppose une entrée
de fabrication (consommation des composantes, valorisation au coût de revient), ce que le module Stock ne fait pas.
Analyse à faire après les lots Tarifs (A11) et Matériel (A8, qui crée les ordres d'atelier avec pièces du stock).

## 3. Lots de développement proposés

Ordre : anomalies d'abord, puis le transverse dont dépendent les autres lots, puis les modules métier.

| Lot | Contenu | Pourquoi à ce rang | Taille |
|---|---|---|---|
| 0 – Anomalies | B1, B2, B7 ; B3 et B4 (reproduction sur la base puis correction) ; B5 (service du salarié relié à `service_membre`) ; B6 (composition des ouvrages) | Bloquants ou gênants au quotidien, sans dépendance. B5 et B6 peuvent faire un lot 0b. | L |
| 1 – Présentation | A1, A2, A4 (libellé), A31, A34, A24b, A24c, A28, A32 | Petits points d'interface, un seul passage sur les styles et les barres. | L |
| 2 – Référentiels paramétrables | A22 (modes et conditions), A23 (types de matériel), A17 (activités), listes Priorité et Évaluation des projets, A18b (unités et synonymes), A33 (chronos) | Prérequis des lots Annuaire, Matériel et Structure. | L-XL |
| 3 – Fiches : sommeil et navigation | A19a, A19b/c, A21 | Transverse, touche toutes les fiches et vues ; à faire avant d'ajouter de nouveaux types de fiches. | L |
| 4 – Annuaire | A13, A14, A15, A16, A17 (saisie) | Dépend du lot 2. | L |
| 5a – Matériel : fiche | A5, A6, A20 (type de chantier) | Dépend du lot 2. | M-L |
| 5b – Matériel : affectations | A7, A3 | Dépend de 5a. | L |
| 5c – Matériel : coûts et entretiens | A8, A9, A4 (contenu) | Dépend de 5a, des modules Exécution et Stock ; à analyser en détail avant (nouveau type d'ordre). | XL |
| 6 – Structure | A25, A26, A27 | Dépend du lot 2 (listes) et de 5a (type de chantier). | L |
| 7 – Bibliothèque | A18a, c, d, e, f, g, h | Indépendant ; A18e après le lot 8 si le délai du tarif prime. | L |
| 8 – Tarifs fournisseurs | A11, A10, A12 | Règles de prix répliquées ; décider d'abord module à part ou Bibliothèque. | L |
| 9 – Documents | A24a, A24d, A24e | A24d dépend du Mail ; A24a du Stock. | L |
| 10 – Pointage | A30, puis A29 | A29 demande une décision sur la géolocalisation. | L-XL |
| 11 – Sécurité de la base | A35, A36 | Indépendant ; à faire avant toute installation chez un client. Peut passer plus tôt. | M |

## 4. À étudier (sans développement pour l'instant)

- E1 Poste de travaux (documents) : dans TODO.
- E2 Tiers par compte dans le module Liste en saisie : capacité d'édition des listes à concevoir.
- E3 Ouvrages fabriqués en stock ou achetés tout faits.
- Lot 5c (entretiens du matériel) : nouveau type d'ordre et imputation des coûts, à analyser avant développement.
- A29 Restaurants : géolocalisation (géocodage des adresses ou zones) et règle d'avantage en nature à faire valider
  par le RH.
- A12 : module Tarifs fournisseurs séparé ou partie de la Bibliothèque.
- B3, B4 : à reproduire sur la base avant de chiffrer.

## 5. Points ajoutés à TODO.md

EcoTaxe ; secteur du chantier et des documents de vente ; demande de prix « sur ordre » (commandes successives au
prix de la demande pendant le chantier) ; modules à définir : Analyse, Comptabilité avancée, gestion des risques,
circuit de validation, édition automatique ; module de sauvegarde (en grande partie couvert par le module
Installation, lots 3 et 4 : reste la sauvegarde lancée depuis l'application et le changement de la clé de
construction qui chiffre le `.env`).

## 6. Lot 5c : coûts et entretiens du matériel (analyse, 26/10/2026)

Demandes : A8 (chantier de suivi des coûts du matériel, ordre d'entretien avec le détail des opérations et des pièces
du stock), A9 (historique des compteurs avec les événements et les entretiens), contenu de A4 (entretiens et visites à
surveiller). Lots 5a et 5b réalisés : `materiel.mat_cha_id` existe déjà (db/230), le type de chantier MATERIEL est
déduit, un chantier de matériel est écarté des chantiers proposés au planning et au pointage.

### 6.1 Existant réutilisé

| Besoin | Existant | Remarque |
|---|---|---|
| Porter les coûts sur un objet | Chantier : documents rattachés (`ent_chantier_id`), pointages (`poi_cha_id`, `v_cout_mo_chantier`), mouvements de stock vers un lieu (`stk_mouvement.mvt_lieu_id`) | Le modèle « chantier de dotation » du salarié (db/219) a fait ses preuves : un chantier par matériel, créé à la première imputation. |
| Ordres | Famille E du module Document (E_OE, E_PO, E_SAV…), un chantier par ordre (`EXE_CHANTIER`), états, étapes, service, responsable, budget | Un nouveau type d'ordre hérite de tout : liste, exécution, planning, pointage par ordre. |
| Pièces du stock | Ordre → E_DAP → S_DEMANDE / S_RESERVATION ; magasin : sorties vers un chantier ; borne : sorties pour un chantier du jour | La sortie d'une pièce vers le chantier du matériel la consomme (le chantier ne tient pas de stock) et la valorise au PMP. |
| Achats et sous-traitance | Commandes et factures fournisseur rattachées à un chantier | Une réparation chez un garagiste, une facture de carburant : rattachées au chantier du matériel. |
| Échéances | Habilitations du matériel (VGP, contrôle technique : `habilitation`, type « matériel »), page « à surveiller », notifications `SourceHabilitations` | Les entretiens périodiques s'y ajoutent. |
| Compteur | `mat_heures`, `mat_heures_revision` (une valeur, une périodicité) | Remplacés par un historique de relevés. |

### 6.2 Proposition

1. **Chantier de suivi du matériel** : créé à la demande (bouton de la fiche ou première imputation) : code `MAT-<code>`,
   affaire de gestion MATERIEL (comme DOTATIONS), ouvert tant que le matériel n'est pas en sommeil ; `mat_cha_id`.
   Onglet **Coûts** de la fiche matériel : par nature et par mois (main-d'œuvre pointée, pièces et consommables sortis
   du stock, achats et factures fournisseur, sous-traitance, carburant), cumul de l'année et depuis l'entrée, coût par
   heure ou par kilomètre d'après les compteurs.
2. **Ordre d'entretien** `E_ENT` (famille E) : sur le chantier du matériel ; lignes = opérations (main-d'œuvre, en
   heures, nature MO_ATELIER) et pièces (articles de la bibliothèque, quantités) ; nature de l'entretien (préventif,
   curatif, réglementaire) ; relevé du compteur à l'intervention. Transformations : E_ENT → E_DAP (pièces à sortir ou à
   commander), E_ENT → A_COMMANDE (réparation extérieure). Pointage des mécaniciens sur l'ordre (déjà possible pour un
   ordre E). Clôture de l'ordre = entretien réalisé : inscrit dans l'historique du matériel et recalcule la prochaine
   échéance.
3. **Historique des compteurs** (`materiel_releve` : date, valeur, unité h / km, source : saisie, ordre, borne) et
   **événements** (`materiel_evenement` : panne, sinistre, accident, immobilisation, contrôle, entretien ; date,
   description, ordre lié, coût éventuel). Frise de la fiche matériel : relevés, événements, entretiens.
4. **Plans d'entretien** (`materiel_plan` : par type de matériel ou par matériel ; opération, périodicité en heures,
   kilomètres ou mois, la première atteinte déclenche) : échéance calculée par une règle répliquée JS / C# avec un jeu
   (`05_entretiens.json` : dernier entretien, compteur courant, moyenne d'usage) ; échéances dans « Habilitations,
   entretiens et visites à surveiller » et dans la notification quotidienne ; bouton « Créer l'ordre d'entretien ».
5. **Carburant** : saisie rapide d'un plein (date, compteur, litres, montant) qui crée un relevé et une ligne de coût ;
   import des cartes carburant plus tard (module Import).

### 6.3 Questions à trancher

| Réf. | Question | Proposition | Décision (26/10/2026) |
|---|---|---|---|
| M1 | Un chantier par matériel, ou un chantier pour les matériels d'une même famille (petit outillage par nombre) ? | Un par matériel identifié ; un chantier par type de matériel pour les matériels gérés par nombre. | Ok |
| M2 | Création du chantier de suivi : automatique pour tout matériel, ou à la demande ? | À la demande (bouton) et à la première imputation : pas de chantiers vides. | Ok |
| M3 | Coût horaire de la main-d'œuvre d'atelier : celui des pointages (salarié), ou un taux d'atelier ? | Celui des pointages (`v_cout_mo_chantier`), comme pour les chantiers. | Ok |
| M4 | Refacturer le coût du matériel aux chantiers où il travaille (coût horaire d'usage) ? | Pas dans ce lot : le coût par heure est affiché ; la refacturation interne sera une décision de la future analyse de rentabilité. | Ok, ajouté à TODO |
| M5 | Ordre d'entretien : nouveau type E_ENT, ou E_SAV existant ? | Nouveau type E_ENT (E_SAV est tourné vers le client et sa facturation). | Ok |
| M6 | Plans d'entretien par type de matériel (hérités) et surchargés par matériel ? | Oui. | Ok |
| M7 | Compteurs : heures et kilomètres pour le même matériel (camion-grue) ? | Oui, deux unités par matériel au plus. | Ok |
| M8 | Carburant dans ce lot ou plus tard ? | Saisie manuelle dans ce lot, import des cartes carburant plus tard. | Ok |

### 6.4 Découpage proposé

| Sous-lot | Contenu | Taille |
|---|---|---|
| 5c-1 | Chantier de suivi (création, affaire MATERIEL, statut lié au sommeil), onglet Coûts (vue des coûts par chantier et nature : MO, stock, achats) | M |
| 5c-2 | Relevés de compteurs et événements (tables, saisie, frise), carburant manuel | M |
| 5c-3 | Ordre d'entretien E_ENT (type, transformations, clôture → historique et relevé) | M-L |
| 5c-4 | Plans d'entretien, échéances (règle répliquée et jeu), page « à surveiller », notifications, création de l'ordre depuis l'échéance | L |

### 6.5 Réalisé

- **5c-1** (26/10/2026) : affaire de gestion MATERIEL ; chantier de suivi créé à la demande (onglet Coûts de la fiche
  matériel, `POST /api/ressources/materiels/{id}/chantier`) par `CoutsMateriel.ChantierMaterielAsync`, point d'entrée
  de la « première imputation » des sous-lots suivants (carburant, ordre d'entretien) : MAT-code pour un matériel
  identifié, MAT-T-type partagé par les matériels gérés par nombre du même type (M1) ; statut ouvert tant qu'un de ses
  matériels n'est pas en sommeil (trigger de db/232). Vue `v_cout_chantier` (par chantier, mois et nature : MO
  pointée, pièces du stock, achats, sous-traitance) ; onglet Coûts : mois de l'année choisie, totaux de l'année et
  depuis l'entrée, heures MO, coût par heure d'utilisation (compteur `mat_heures` en attendant les relevés de 5c-2 ;
  sans objet pour un chantier partagé), liens vers les documents et les pointages du chantier.
- **5c-2** (26/10/2026) : compteurs suivis par matériel (`mat_compteurs` : heures, kilomètres, les deux, aucun ; M7) ;
  relevés datés `materiel_releve` (remise à zéro, source saisie / plein / ordre / borne / reprise des heures de la
  fiche), jamais sous le précédent sauf remise à zéro, compteur à une date et série cumulée : règles répliquées
  `compteurs.js` ↔ `ReglesCompteurs.cs` (jeu `tests/ressources/05_compteurs.json` ; le jeu des échéances
  d'entretien de 5c-4 prend le numéro 06) ; heures et kilométrage de la fiche = derniers relevés (lecture seule) ;
  événements `materiel_evenement` (panne, sinistre, accident, immobilisation, contrôle, entretien, plein, autre ;
  durée, coût informatif, ordre lié, relevé lié) ; plein de carburant (M8, saisie manuelle) : première imputation
  (chantier de suivi créé), coût en nature CARBURANT de `v_cout_chantier` ; onglet Compteurs de la fiche matériel :
  frise SVG (courbe cumulée par unité, événements), journal, saisies en fenêtre.
- **5c-3** (26/10/2026) : type E_ENT (module Exécution ; statuts, droits, états intervention et contrôle, service par
  défaut Atelier) créé depuis l'onglet Compteurs de la fiche matériel (nature, objet, opérations en lignes de texte) sur
  le chantier de suivi (première imputation), avec affaire et adresse du chantier ; colonnes du cœur `ent_mat_id`,
  `ent_ent_nature`, `ent_mpl_id` (plan, 5c-4) ; bloc « Matériel entretenu » de l'entête (nature, relevé du compteur à
  l'intervention : relevé de source ORDRE contrôlé par les règles des compteurs) ; transformations vers E_DAP (pièces du
  stock), A_DEVIS et A_COMMANDE (réparation extérieure) ; clôture (état Terminé) → événement Entretien de l'historique
  (trigger, retiré si l'ordre est rouvert) ; chantier de suivi proposé au pointage tant qu'un ordre d'entretien y est en
  cours (M3) ; liste « Ordres d'entretien du matériel » (vue 1108, menu Exécution).
- **5c-4** (26/10/2026) : plans d'entretien `materiel_plan` par type de matériel (un type enfant hérite de son parent)
  et par matériel (même code = remplace, inactif = retire ; M6), périodicités heures / kilomètres / mois, nature,
  opérations ; échéance de chaque plan effectif depuis son dernier entretien (événement Entretien ou Contrôle au code du
  plan, posé à la clôture d'un ordre issu du plan ou choisi à la saisie), sinon la mise en service ou l'entrée, avec
  les compteurs cumulés et l'usage moyen des 90 derniers jours : règles répliquées `entretiens.js` ↔
  `ReglesEntretiens.cs` (jeu `tests/ressources/06_entretiens.json` ; numéro 06, le 05 étant pris par les compteurs) ;
  plans et échéances dans l'onglet Compteurs (🔧 crée l'ordre du plan avec ses opérations, ✎ plans propres au
  matériel), plans par type dans `/parametres/ressources`, entretiens en retard ou à prévoir dans « Habilitations,
  entretiens et visites à surveiller », notification quotidienne (`SourceEntretiens`) ; plans de démonstration des
  types Engins, Levage, Véhicules. Sans entretien saisi, la démonstration montre beaucoup d'entretiens en retard
  (critère des mois compté depuis l'entrée des matériels).

## 7. Lot 6 : structure (réalisé, 26/10/2026)

- **A25 Projet** (db/236) : priorité et évaluation (listes paramétrables PRIORITE_PROJET, EVALUATION_PROJET des
  référentiels communs), estimation (montant, début et fin des travaux, durée en heures ou en jours, adresse, zone de
  déplacement 0 à 9), client en saisie libre avant sa création dans l'annuaire, prospect = tiers provisoire créé par le
  bouton ＋ du champ Client (doublons proposés), responsable et métreur = individus de notre structure (contrôlés par le
  serveur). L'ancien texte du responsable est rapproché d'un individu quand un seul correspond ; sinon il reste en lecture
  seule (« ancienne saisie ») et en repli dans la liste. Liste des projets : priorité, évaluation, métreur, dates, durée,
  zone, prospect.
- **A26 Chantier** : code analytique (section analytique de l'export comptable, sinon le code du chantier), début prévu,
  début et fin réels des travaux, chargé d'affaires et chef d'équipe (individus de notre structure, avec le conducteur
  existant) ; zones de déplacement du Pointage (par agence) affichées dans l'en-tête de la fiche. Liste des chantiers
  complétée.
- **A27 Liens** : « Échéances et règlements » d'un chantier ou d'un marché (module Règlements actif ;
  `/reglements?chantier=` ou `?marche=` : échéances des pièces validées, tous tiers, clients puis fournisseurs, pointé
  et reste, le tiers ouvre sa page de pointage) ; chantier : listes des marchés, commandes et factures de
  sous-traitance (module Sous-traitance actif) ; marché de vente : commandes et factures de chaque marché de
  sous-traitance lié (bloc « Sous-traitance : engagé et réalisé »).

## 8. Lot 7 : bibliothèque (réalisé, 26/10/2026)

- **A18a Mots-clés** (module `064`) : `ele_mots_cles` (mots séparés par des virgules), cherchés par l'appel F3 et par la
  recherche des listes de la bibliothèque (colonne masquée des vues, ajoutée aux vues déjà modifiées par db/237).
- **A18c Code-barres** : `ele_code_barre`, unique par bibliothèque, cherché comme les mots-clés ; un code saisi dans la
  colonne Code d'un document qui ne désigne aucun élément désigne celui de ce code-barres (lecteur).
- **A18d Type Texte** : élément `TEXTE` (libellé seul, sans prix ni unités) inséré comme ligne de texte (code, F3,
  glisser) ou ajouté aux textes de l'édition (bouton « 📚 Texte » de l'introduction et de la conclusion, point
  d'accroche `peutChoisirTexte` / `choisirTexte` du module Document) ; vue « Textes » (1400) et menu Bibliothèque.
- **A18e Délai de livraison global** : `ele_delai_livraison` saisi dans la fiche et affiché dans la liste. Décision
  reportée au lot 8 : priorité entre le délai du tarif fournisseur (A11), celui de l'article dans le dépôt (Stock) et ce
  délai global ; l'approvisionnement du Stock ne le lit pas encore.
- **A18f Description technique** : `ele_description_html` (HTML nettoyé par la fiche), variable des éditions
  `lignes[].description_html` (élément appelé par la ligne).
- **A18g / A18h** : onglet Utilisations de la fiche élément : ouvrages et ensembles qui le composent
  (`v_element_utilisations`, colonne « Utilisé dans » de la liste), lignes des pièces d'achat de l'article (période 1
  mois, 6 mois, 1 an ou tout, en cours seulement) avec lien vers chaque pièce.
