# LogiBTP – analyse du module Pointage MO

> Analyse préalable (20/10/2026) à partir de la note « LogiBTP - Module Pointage MO ». Socle commun aux quatre nouveaux
> modules : [ANALYSE-MODULES-TRANSVERSE.md](ANALYSE-MODULES-TRANSVERSE.md). Modules liés : [CRM](ANALYSE-MODULE-CRM.md) ·
> [Exécution](ANALYSE-MODULE-EXECUTION.md) · [Planning](ANALYSE-MODULE-PLANNING.md).

## 1. Objet

Saisir les **heures de main-d'œuvre** des salariés et intérimaires, toujours rattachées à un **chantier** (et
éventuellement à un ordre d'exécution), avec les éléments variables de paie (paniers, déplacements, heures
supplémentaires), puis les **valider** en une synthèse qui alimente la paie et le coût réel des chantiers.

Trois écrans :

| Écran | Pour qui | Où |
|---|---|---|
| Borne | Salariés d'atelier | Tablette tactile partagée, fixée à l'atelier |
| Personnel | Salarié, intérimaire, chef d'équipe, conducteur, chargé d'affaires | Téléphone ou tablette, **hors ligne possible** |
| Synthèse | Chef de service, RH | Poste de bureau |

## 2. Synthèse fonctionnelle

### 2.1 Paramètres de la société

- Ordre des libellés : « Nom Prénom » ou « Prénom Nom ».
- Pas de saisie en minutes (15 par défaut).
- **Profils de paie** : rubriques (heures normales, heures supplémentaires par tranche, panier, zone de déplacement,
  trajet, grand déplacement, intempéries, absences…), règles de calcul et limites (plafonds, seuils).

### 2.2 Borne

- Liste des salariés (nom, photo), filtre de l'interface par salarié, verrouillage facultatif par **code PIN** (au
  global ou par salarié).
- Plusieurs écrans : saisie libre ou **préparation depuis le planning** (tâches du jour proposées).
- Choix du jour, du chantier, de l'ordre, du type de MO.
- Écran de saisie : toucher pour changer une valeur, heures au pas défini, panier, commentaire ; affichage de tous les
  pointages de la journée du salarié.
- **Dupliquer une ligne pour signaler une non-conformité** (problème de commande, de matériaux, de plan…) ou en
  ajouter une nouvelle.

### 2.3 Personnel (mobile)

- Connexion personnelle du salarié ou de l'intérimaire ; **mode hors ligne** (consultation et saisie sans réseau).
- Groupes de droits : chargé d'affaires / conducteur de travaux, chef d'équipe, salarié, consultation.
- Saisie comme sur la borne, filtrée par service ; **saisie par équipe** (création et modification tant que les
  pointages des membres sont identiques).
- Données issues du planning (vides ou pré-remplies), vue jour ou semaine, pointages libres, compositions d'équipe.
- Rubriques sur une seule page : certaines saisies, d'autres pré-calculées dans la synthèse.
- Informations de la tâche (adresse, contact, commentaires) et **raccourci de navigation GPS**.
- Passerelles : documents (commandes et réceptions fournisseurs), Exécution (ordres d'achat, d'intervention, de
  sous-traitance, stock, livraison, pose, demande d'approvisionnement), CRM (messages, alertes, tâches, fil du
  chantier), bibliothèque simplifiée (liste courte, informations réduites, sans nature).

### 2.4 Synthèse MO

- Les pointages **saisis** sont conservés tels quels ; la synthèse travaille sur une **copie** modifiée / validée par
  le RH.
- **Double validation** possible : chef de service puis RH.
- **Pré-calculs** : panier au-delà de 6 h de travail dans la journée, ventilation des heures supplémentaires, zone de
  déplacement (la plus éloignée des chantiers de la journée)…
- La validation **bloque** les pointages à la journée ou à la semaine ; dévalidation selon le niveau (chef, RH).

## 3. Liens avec les autres modules

```mermaid
graph LR
  Pointage -->|chantier obligatoire, adresse| Structure[Structure des affaires]
  Pointage -->|salariés, intérimaires, équipes| Ressources[Référentiel ressources]
  Planning -->|tâches du jour pré-remplies| Pointage
  Pointage -->|heures réelles| Planning
  Pointage -->|temps par ordre et ligne| Exe[Exécution]
  Pointage -->|non-conformités, fil du chantier| CRM
  Pointage -->|commandes, réceptions| Document
  Pointage -->|liste simplifiée| Bibliotheque[Bibliothèque]
  Pointage -->|variables de paie| Paie[Logiciel de paie - export]
  Pointage -->|feuilles signées| GED
```

| Module | Avec lui | Sans lui |
|---|---|---|
| Structure, Annuaire, référentiel ressources | Prérequis (chantier obligatoire, salariés liés aux individus) | — |
| Planning | Écrans pré-remplis par les tâches du jour ; heures réelles dans le rapport du planning | Saisie libre (chantiers récents du salarié proposés) |
| Exécution | Pointage sur un ordre (et une ligne / opération), temps réel vs budget de l'ordre ; création d'ordres depuis le mobile | Pointage au chantier seulement |
| CRM | Non-conformité → note au service concerné ; fil d'actualité et alertes sur le mobile | Non-conformité conservée comme type de MO, sans notification |
| Document, Bibliothèque | Commande et réception fournisseur depuis le mobile | Passerelle masquée |
| Congés (à créer) | Absences pré-remplies, contrôle de cohérence | Absences saisies en rubriques |

## 4. Points en suspens (questions et propositions)

| N° | Question | Proposition |
|---|---|---|
| M1 | « Profils de paie avec rubriques et règles de calcul » : LogiBTP calcule-t-il la paie ? | **Non** : il calcule les **variables de paie** (quantités par rubrique et par salarié pour la période) et les **exporte** vers le logiciel de paie (formats Silae, Sage, Cegid, ADP… par modèle d'export paramétrable, CSV au départ). Le calcul des salaires, cotisations et bulletins reste hors périmètre (réglementation trop mouvante). |
| M2 | Règles de calcul : langage ou liste fermée ? | Liste de **règles typées paramétrables** (seuil journalier → rubrique ; ventilation hebdomadaire par tranches ; zone selon distance ; plafond ; arrondi au pas), évaluées par un moteur unique répliqué JS ↔ C# (jeu `modules/pointage/tests/cas`). Pour les cas particuliers, une formule dans le langage d'expressions du socle (`Expression`, déjà répliqué). |
| M3 | Heures supplémentaires : semaine civile, modulation, annualisation ? | Semaine civile par défaut (au-delà de 35 h : tranches paramétrables, ex. 8 premières heures, puis au-delà) ; la ventilation n'est calculée qu'une fois la semaine complète. Modulation / annualisation : compteur reporté, en lot ultérieur. |
| M4 | Zone de déplacement : distance depuis où, calculée comment ? | Depuis le point de rattachement du salarié (siège ou agence, `sal_ind_id` → rattachement à l'agence de notre société) jusqu'au chantier, à vol d'oiseau (pratique usuelle des barèmes BTP en zones concentriques) ; coordonnées du chantier géocodées depuis son adresse (API adresse nationale, relayée par le serveur comme le module Entreprises françaises). Zone de la journée = la plus élevée des chantiers pointés. Barème par profil de paie. |
| M5 | Panier « plus de 6 h » : heures de travail seules ou trajet compris ? | Heures de travail effectif seules par défaut, paramétrable ; panier non dû si le salarié est en grand déplacement (rubrique exclusive). |
| M6 | Saisie par équipe « tant que les pointages sont identiques » : comment le savoir ? | La saisie d'équipe crée un pointage par membre avec un identifiant de groupe ; tant que tous les pointages du groupe ont les mêmes valeurs, ils s'éditent ensemble ; dès qu'un membre diverge, il sort du groupe (affiché à part) et l'équipe reste éditable pour les autres. |
| M7 | Hors ligne : quelles données sur l'appareil, quels conflits ? | Application installable (PWA), données de l'utilisateur seulement (ses pointages des N dernières semaines, chantiers et tâches de la période, rubriques de son profil) dans IndexedDB ; file d'envoi rejouée au retour du réseau. Conflit : un pointage validé côté serveur ne peut plus être modifié (refus, la saisie locale est conservée en brouillon avec un message) ; sinon la dernière modification l'emporte, chaque version étant journalisée. |
| M8 | PIN de la borne : sécurité ? | PIN haché (jamais en clair), tentatives limitées ; la borne est un **appareil enregistré** (jeton d'appareil délivré par un administrateur), pas une session utilisateur ; déconnexion automatique après chaque saisie. |
| M9 | Photos des salariés (RGPD) ? | Facultatives, avec consentement ; stockées dans la GED (catégorie confidentielle `photo_salarie`), servies en miniature à la borne seulement. |
| M10 | Intérimaires : compte et données ? | L'intérimaire est un individu rattaché à l'agence d'intérim (tiers fournisseur) ; ses heures servent au **contrôle des factures de l'agence** et au coût du chantier, pas à la paie. Profil de paie « intérim » sans export. |
| M11 | Copie RH : copie entière ou écarts seulement ? | Deux couches dans la même table (`poi_couche` : SAISIE / VALIDE) ; la couche VALIDE est créée à la première modification ou validation ; les écarts sont affichés ligne à ligne. La saisie reste figée dès la validation. |
| M12 | Double validation : obligatoire ? | Paramètre par service : validation simple (RH) ou double (chef puis RH). Dévalidation : le chef dévalide tant que le RH n'a pas validé ; le RH dévalide tout ; la dévalidation après export de paie est signalée (export correctif). |
| M13 | Pointage sur une tâche administrative (formation, réunion) sans chantier ? | La règle « toujours un chantier » impose des **chantiers internes** (frais généraux, atelier, formation, dépôt) créés par société ; à valider. |
| M14 | Type de MO : liste ? | Paramétrable : production, préparation, trajet, non-conformité (avec motif), attente, nettoyage… ; chaque type a une rubrique de paie et un sens analytique (productif / improductif). |
| M15 | Géolocalisation du pointage ? | Pas par défaut (la CNIL encadre strictement la géolocalisation des salariés) ; éventuellement une position **au moment de la saisie** seulement, facultative et déclarée. Le raccourci GPS (ouvrir la navigation vers le chantier) ne pose pas ce problème. |

## 5. Faisabilité

**Faisable**, avec deux sujets nouveaux pour le projet : l'**authentification réelle** et l'**application mobile hors
ligne**.

| Besoin | Existant | À faire |
|---|---|---|
| Salariés liés aux individus | `demo_salarie.sal_ind_id`, `SalariesAnnuaire` | Référentiel réel des salariés (transverse § 4) : service, profil de paie, calendrier, taux horaire |
| Chantiers, adresses | Structure des affaires, `ent_adresse_livraison`, contact sur place | Géocodage des chantiers (coordonnées) |
| Connexion personnelle, groupes de droits | **Aucune** : utilisateur lu dans les en-têtes `X-Utilisateur` / `X-Profil` | Module d'authentification (transverse § 2) : prérequis bloquant |
| Hors ligne | IndexedDB déjà utilisé (`depot-import.js`) | Service worker, file d'envoi, synchronisation, version de données |
| Règles de pré-calcul | Langage d'expressions du socle répliqué | Moteur de règles de paie répliqué JS ↔ C# + jeu de cas |
| Listes de synthèse | Module Liste (saisie en ligne, segments) | Grille hebdomadaire salarié × jour × rubrique (composant à faire sur `GrilleArbre` ou dédié) |
| Feuille d'heures signée | Module Édition, GED, coffre-fort | Modèle d'édition, capture de signature (commune avec le SAV de l'Exécution) |
| Export paie | — | Modèles d'export par logiciel (CSV paramétrable d'abord) |

**Risques** : fiabilité du hors-ligne (tests sur appareils réels, réseau intermittent), justesse des règles de paie
(responsabilité : bien cadrer « variables de paie » et laisser le dernier mot au RH), ergonomie de la borne (gros
boutons, peu de texte, aucune saisie clavier si possible), volume (5 000 salariés × 5 lignes × 220 jours ≈ 5,5 M de
lignes par an : index par salarié et date, partitionnement annuel à prévoir).

## 6. Simplification d'utilisation

- **Journée pré-remplie** : depuis le planning (tâches du jour) ou, sans planning, en reprenant la journée précédente ;
  le salarié n'a qu'à confirmer (« Comme prévu ») ou corriger.
- **Borne en trois touches** : photo du salarié → chantier / ordre du jour (proposés) → heures (boutons ± au pas,
  valeurs fréquentes 4 h / 7 h / 8 h) ; panier coché d'office si la règle le prévoit.
- **Saisie d'équipe par le chef** : une ligne pour toute l'équipe, exceptions à la main (absent, parti plus tôt).
- **Contrôles visibles avant l'envoi** : total de la journée, journée incomplète, chevauchement, dépassement de
  l'amplitude légale (10 h / jour, 48 h / semaine), chantier clos ; aucun blocage sauf incohérence franche.
- **Synthèse par exceptions** : le RH ne voit d'abord que les salariés avec écarts (heures ≠ planning, pas de pointage,
  non-conformité, heures supplémentaires) ; « Tout valider » pour le reste de la semaine.
- **Non-conformité en un geste** : « Signaler un problème » sur la ligne → motif → photo facultative ; la note CRM part
  au bon service.
- **Libellés et pas** paramétrés une fois pour la société (ordre nom / prénom, 15 minutes).

## 7. Possibilités non encore explorées

1. **Pointage des matériels** : heures d'engin, kilomètres des véhicules, consommation de carburant, sur la même saisie
   que le conducteur d'engin → coût matériel du chantier et maintenance (heures avant révision, `mat_heures_revision`
   existe déjà en démonstration).
2. **Coût réel du chantier** : heures valorisées au coût horaire chargé (par salarié ou par qualification) comparées au
   déboursé MO du budget, par nature, tranche ou ordre ; alimente la rentabilité continue de l'Exécution.
3. **Contrôle des factures d'intérim** : relevé d'heures par agence et par semaine rapproché de la facture d'achat.
4. **Intempéries** : heures d'arrêt pour intempérie (déclaration à la caisse des congés intempéries du BTP), liées à
   une journée marquée dans le planning.
5. **Carte BTP et badge** : identification à la borne par QR code ou badge NFC plutôt que par photo + PIN.
6. **Compteurs** : heures supplémentaires cumulées, contingent annuel, repos compensateur, récupération ; consultables
   par le salarié.
7. **Relevé hebdomadaire signé** par le salarié (signature sur l'écran), conservé au coffre-fort : preuve en cas de
   litige sur les heures.
8. **Avancement sur mobile** : le chef d'équipe saisit le pourcentage réalisé de la tâche en même temps que les heures
   (planning, situations).
9. **Rapport journalier de chantier** (météo, effectif, livraisons, incidents, photos) produit à partir des pointages
   et du fil d'actualité, imprimable.
10. **Tableau de bord productivité** : heures productives / improductives par type de MO, coût de la non-qualité par
    motif.

## 8. Esquisse du modèle de données (`modules/pointage/db`)

| Table | Colonnes principales |
|---|---|
| `poi_parametre` | `ppa_ordre_nom` (NP / PN), `ppa_pas_minutes`, `ppa_validation` (SIMPLE / DOUBLE), `ppa_blocage` (JOUR / SEMAINE) |
| `poi_profil_paie` | `ppf_id`, `ppf_code`, `ppf_libelle`, `ppf_export_modele` |
| `poi_rubrique` | `rub_id`, `rub_ppf_id`, `rub_code`, `rub_libelle`, `rub_unite` (H, NB, ZONE), `rub_saisie` (S / C / SC), `rub_code_paie`, `rub_ordre` |
| `poi_regle` | `prg_id`, `prg_ppf_id`, `prg_type` (SEUIL_JOUR, TRANCHES_SEMAINE, ZONE, PLAFOND, FORMULE), `prg_parametres` (JSONB), `prg_rub_id`, `prg_ordre` |
| `poi_type_mo` | `tmo_code`, `tmo_libelle`, `tmo_productif`, `tmo_rub_id`, `tmo_non_conformite` |
| `poi_pointage` | `poi_id`, `poi_couche` (SAISIE / VALIDE), `poi_origine_id` (ligne saisie d'origine), `poi_sal_id`, `poi_date`, `poi_cha_id`, `poi_ent_id` (ordre), `poi_lig_id` / `poi_opr_id`, `poi_tmo_code`, `poi_debut`, `poi_fin`, `poi_heures`, `poi_motif`, `poi_commentaire`, `poi_groupe` (saisie d'équipe), `poi_tac_id` (planning), `poi_saisi_par`, `poi_saisi_le`, `poi_appareil`, `poi_version` |
| `poi_valeur` | `pva_poi_id` ou (`pva_sal_id`, `pva_date`), `pva_rub_id`, `pva_valeur`, `pva_calculee` (rubriques du jour : panier, zone…) |
| `poi_validation` | `pvl_sal_id`, `pvl_du`, `pvl_au`, `pvl_niveau` (CHEF / RH), `pvl_par`, `pvl_le`, `pvl_annule_par`, `pvl_annule_le` |
| `poi_export` | `pex_id`, `pex_periode`, `pex_modele`, `pex_dge_id` (fichier en GED), `pex_par`, `pex_le` |
| `poi_appareil` | `pap_id`, `pap_libelle`, `pap_jeton_hache`, `pap_service`, `pap_actif` (bornes enregistrées) |

## 9. Découpage en lots

| Lot | Contenu | Prérequis |
|---|---|---|
| 0 | Activation ; authentification et droits ; référentiel salariés réel (service, profil, rattachement) | Transverse lots 0–2 |
| 1 | Paramètres, types de MO, saisie bureau (grille hebdomadaire) au chantier, contrôles | Lot 0 |
| 2 | Synthèse : couche validée, simple / double validation, blocage, dévalidation | Lot 1 |
| 3 | Profils de paie, rubriques, règles (jeu de cas), géocodage et zones, export CSV | Lot 2 |
| 4 | Borne (appareil enregistré, PIN, photos), saisie par équipe | Lot 1 |
| 5 | Application personnelle hors ligne (PWA), navigation GPS, pré-remplissage depuis le planning | Lot 1 ; transverse § 6 ; Planning lot 2 pour le pré-remplissage |
| 6 | Passerelles : ordres (Exécution), non-conformités (CRM), commandes / réceptions simplifiées ; pointage des matériels | Modules concernés |
