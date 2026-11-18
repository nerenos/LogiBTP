# Analyse : reprise des données d'une base MDE ou OptimBTP dans une nouvelle base LogiBTP

Rédigée le 16/11/2026 à partir de deux sources : l'analyse `ANALYSE-MDE_DOS_DEV.md` (SQL Server 2022, base MDE_DOS_DEV) et l'analyse `ANALYSE-OPTIMBTP-MARIADB.md` (MariaDB 11.2, base optimbtp). Elle est comparée au schéma LogiBTP du manifeste `db/installation/scripts.txt` (316 tables).

Statut : **réponses de l'utilisateur intégrées le 16/11/2026** (§ 10, qui prime sur le reste du texte en cas d'écart) ; plan en lots au § 11. Aucune ligne de code d'import n'est écrite, et aucun SQL n'a été appliqué sur une base.

---

## 1. Objectif et périmètre

Il s'agit de créer une **nouvelle base société** LogiBTP (installeur : `installation base creer` puis `societe ajouter`), puis de la remplir avec les données d'une base externe :

- **MDE**, base SQL Server de type « Batigest-like » ;
- **OptimBTP**, base MariaDB, dont le module Import sait déjà lire le fichier devis `.optim`.

Ce que la reprise couvre, par ordre de dépendance :

1. Société et paramètres : identité, numérotation, décimales.
2. Référentiels : unités, TVA, modes et conditions de règlement, pays, civilités, plan comptable, natures et familles.
3. Annuaire : clients, prospects, fournisseurs, sous-traitants, architectes, intérimaires, contacts et adresses.
4. Ressources : salariés, équipes, matériels, habilitations.
5. Bibliothèque : articles, ouvrages et compositions, tarifs fournisseurs.
6. Structure : projets, affaires, chantiers, marchés.
7. Documents de vente : devis, commandes, BL, situations, factures et avoirs, avec leurs lignes, leurs pieds et leurs métrés.
8. Documents d'achat et de sous-traitance.
9. Règlements, échéances et retenues de garantie.
10. Exploitation : pointage, planning, stock, coûts réels.
11. GED et notes (CRM).

Ce que la reprise ne couvre pas :

- les vues de l'interface et les binaires d'écran (`SYS_MDE*`) ;
- les cubes, les tables `s_*`, `z_dictionnaire*`, `z_commune` et `z_cube*` d'OPTIM ;
- les journaux techniques ;
- la paie elle-même (seules les variables de pointage sont reprises).

## 2. Les deux sources en bref

| | MDE | OptimBTP |
|---|---|---|
| Moteur | SQL Server 2022 | MariaDB 11.2 |
| Volume analysé | 192 tables, 74 k lignes | 195 tables, 374 k lignes |
| Clés | Codes texte (`CODE varchar(8)`), parfois `CLE numeric(38,0)` | Entiers `XXX_ID` |
| Clés étrangères | 429 déclarées | **Aucune** : 633 relations déduites par convention de nommage |
| Société | 1 dossier par base (`SYS_DEFSTE`, 1 ligne) | **Multi-société** (`ref_societe` : 12 lignes, `SCT_ID` sur la plupart des tables) |
| Documents | Une table par type (`PMEDOCDEVCLI`, `PMEDOCFACCLI`…) et leurs `…LIG` | Une table d'en-têtes typée (`vte_doc_entete.VDE_Type_ID` → `z_parametre`) et une table de lignes |
| Types et états | Tables d'états par type (`PMEETATDOCUMENT.TYPEDOC`) | Identifiants de `z_parametre` (1 534 lignes, tous types confondus) |
| Montants | `numeric(38,6)`, coefficients en `float` | `double` partout |
| Libellés riches | RTF ou texte (`LIBELLECOM`, `LIBELLETEC`) | RTF **et** HTML (`ART_LibelleHTML`, `…CompHTML`) |
| Liens polymorphes | Peu (`TRACABILITE`) | Nombreux (ID + type d'entité, voir § 4.3) |

**LogiBTP** fonctionne avec une base par société et des identifiants `bigint`. Les codes y sont en clair (`per_code`, `aff_code`…). Les documents vivent dans une table unique, `document` (`ent_tyd_id` → `TYPE_DOCUMENT`), avec des lignes en arbre (`lig_parent_id`, `lig_chemin ltree`). Les montants sont en `NUMERIC(18,6)` et l'arrondi est unique (demi vers l'infini).

## 3. Architecture proposée pour l'import

### 3.1 Emplacement

Le module **Import** (`modules/import/`) gagne une sous-partie « reprise de base ». C'est déjà lui qui convertit `.optim`, et ses règles de lignes (`convertirOptim`, `associerUnite`, `associerNature`, `associerTaux`, `associerOption`) servent telles quelles. La reprise se lance de deux façons :

- en ligne de commande, depuis l'installeur : `installation societe importer --source mde|optim --connexion … [--societe SCT_ID] [--simulation]`. C'est l'usage nominal, puisqu'on crée une base neuve ;
- éventuellement depuis l'écran d'administration, sur une base vide (à confirmer, voir la question Q3).

Le cœur spécialise ensuite le module, comme pour le reste : les correspondances BTP (natures, regroupements, colonnes BTP) vivent dans `src/`, et le module reste sans métier BTP.

### 3.2 Chaîne de traitement

```
Lecteur source ─► Modèle pivot ─► Correspondances ─► Écriture LogiBTP ─► Contrôles
 (SqlClient /       (objets         (tables de         (unité d'écriture    (recalcul
  MySqlConnector,    neutres,        correspondance,    db.Unite(), par      MoteurDevisBtp,
  lecture seule)     decimal)        règles)            domaine)             écarts)
```

1. **Lecteurs** : un pour MDE (`Microsoft.Data.SqlClient`) et un pour OPTIM (`MySqlConnector`). Ils se connectent en **lecture seule**, ce qui suppose un compte en lecture seule, ou à défaut une sauvegarde restaurée sur un serveur de transit. Aucune écriture n'a lieu côté source. Chacun produit un modèle pivot commun, ce qui évite deux chaînes complètes.
2. **Modèle pivot** : tiers, adresse, contact, élément, document, ligne… Les montants y sont en `decimal`, jamais en `double`. La conversion depuis le `float` / `double` source se fait une seule fois, avec la fonction d'arrondi unique.
3. **Correspondances** : une table `import_correspondance (imc_source, imc_table_source, imc_cle_source, imc_table_cible, imc_id_cible)` garde, pour chaque ligne reprise, sa clé d'origine. Elle sert aux jointures pendant la reprise, à la reprise incrémentale et à la traçabilité. Les correspondances paramétrables (unités, TVA, natures, états, types de documents) sont proposées automatiquement, puis **ajustables** par un fichier JSON relu entre la simulation et la reprise réelle.
4. **Écriture** : un domaine par transaction, dans l'ordre de dépendance du § 1, par l'unité d'écriture du socle. Les identifiants LogiBTP sont attribués par les séquences, et les clés sources ne sont jamais réutilisées. Les codes (`per_code`, `aff_code`, `ele_code`, `ent_numero`) gardent la valeur source.
5. **Contrôles** : chaque document repris est recalculé par `MoteurDevisBtp`, et ses totaux sont comparés aux totaux source (`MTHT`, `MTTTC` / `VDE_Mt…`). Les écarts au-delà de 0,01 € sont listés dans le rapport, et le document garde ses totaux d'origine s'il est verrouillé (voir Q8).
6. **Rapport** : un fichier Markdown ou HTML par reprise. Il donne les volumes lus, repris et écartés par table, les correspondances appliquées, les champs perdus, les anomalies et les écarts de totaux. Il est déposé dans la GED (catégorie `import`) de la nouvelle base.

### 3.3 Mode simulation

`--simulation` fait toute la chaîne dans une transaction annulée à la fin, puis produit le rapport. Le mode simulation est le livrable principal pour la validation avec le client.

---

## 4. Correspondances par domaine

Notation : `MDE.TABLE.CHAMP` et `OPT.table.Champ` → `table.colonne` LogiBTP. « ≈ » signale une correspondance avec une transformation, « ∅ » une donnée sans équivalent.

### 4.1 Société et paramètres

| LogiBTP | MDE | OPTIM | Transformation |
|---|---|---|---|
| Société (paramétrage, identité) | `SYS_DEFSTE` : NOM, ADRESSE, CODEPOSTAL, VILLE, SIRET, APE, NINTRACOMMUNAUTAIRE, FORMEJURIDIQUE, CAPITALSOCIAL, TELEPHONE, EMAIL, SITEINTERNET | `ref_societe` : SCT_RaisonSociale, SCT_LibelleCourt, SCT_TRS_ID (fiche tiers de la société, avec adresse dans `z_adresse`), logos `SCT_GDC_ID_Img*` | OPTIM : une société source = une base LogiBTP (Q1) |
| `compteur_numero` | `SYS_DEFSTE.NUM*` (NUMDEVCLI, NUMFACCLI, NUMCDEFOU, NUMSITTX…) et `SYS_NUMEROTATION` | `ref_societe.SCT_CodeChrono` et les compteurs de `z_parametre` | Le compteur repart **après** le plus grand numéro repris, par type de document |
| Décimales (paramètres) | `DECIMALEQTE`, `DECIMALEPU`, `DECIMALETOT`, `DECIMALETPS` | `z_parametre` (précisions) | Vérifier la compatibilité avec les précisions d'unité (`unt_precision`) |
| Journaux comptables | `SYS_DEFSTE.JOURNALVENTE`, `JOURNALACHAT`, `CMP_PARAMGEN` | `svcz_profil_import_compta` | Vers le paramétrage d'export comptable (Sage 100) |
| Logo d'en-tête | `SYS_MDE*` (binaire) | `ged_document.GDC_Base64` via `SCT_GDC_ID_Img*` | Vers le module Personnalisation (image de la société) |

### 4.2 Référentiels

| LogiBTP | MDE | OPTIM | Transformation |
|---|---|---|---|
| `unite` (unt_code, unt_precision, synonymes) | `PMEUNITEMESURE` (56) | `z_unite` (47) | `associerUnite` du module Import : rapprochement par code puis par synonyme ; l'unité inconnue est créée |
| `taux_tva` (ttv_code, taux, catégorie N/A/I/E, comptes) / `categorie_tva` | `PMETVA` / `TVA` : CODE vc(1) + CODECATEGORIE ; `CATEGORIEACHATVENTE` | `z_parametre` (type TVA : `PRM_Param_Num1` = taux) | `associerTaux` : rapprochement par taux et par catégorie ; le code d'une lettre est gardé en synonyme pour lire les lignes |
| `mode_reglement` | `APIMODEREGLEMENT` (code, libellé) | `z_parametre` (`TRS_ModeReglement`) | Rapprochement par libellé (chèque, virement, LCR, prélèvement, espèces) |
| `condition_paiement` (cpa_lignes jsonb) | `APIMODEREGLEMENTL` : POUR, JOUR, NJ, MOISENTIER | `z_parametre` (conditions) et `vac_doc_echeance_reglement` | Chaque ligne source devient une ligne `{pourcentage, jours, fin_de_mois}` |
| Pays | `APIPAYS` | `z_parametre` / adresse | Code ISO 2 |
| Civilités | `APICIVILITE` | `z_parametre` | `ind_civilite` |
| Devise | `APIDEVISEE`, `SYS_DEFSTE.DEVISEPIVOT` | — | LogiBTP travaille en euros ; une autre devise est signalée comme anomalie (Q10) |
| `compte_comptable` / `type_comptable` / `ventilation_compte` | `CMP_PLANCP`, comptes collectifs de `CMP_PARAMGEN` | `svcz_compte` (1 076), `svcz_profil_import_compta_tva` / `_lien` | Le plan est repris tel quel ; les collectifs vont sur `per_cli/fou/st_collectif` |
| Axes analytiques | `CMP_AXEANALYTIQUE`, `CMP_POSTEANA`, `CMP_GRILLEANA` | `afc_chantier.CHT_CodeAna`, `ref_societe.SCT_CodeAna` | Seul le code analytique du chantier a un équivalent (`cha_code_analytique`) ; les grilles sont ∅ (Q11) |
| Motifs, natures d'absence (`poi_nature_absence`) | `PMERUBRSALARIE`, `PMEHEURESALARIE` (TYPE, TAUX, PLAFONDHS) | `svhz_absence`, `svhz_profil_horaire` | Rapprochement par libellé ; les rubriques de paie sans équivalent sont ∅ |

### 4.3 Annuaire (personnes, individus, coordonnées)

C'est le domaine le plus délicat, parce que les deux sources n'ont pas la même idée du « tiers ».

**Cible LogiBTP.** Une `personne` (morale ou physique) porte des **casquettes** cumulables (`per_casquettes` : CLIENT, PROSPECT, FOURNISSEUR, LOUEUR, SOUS_TRAITANT, COTRAITANT, INTERIM, ARCHITECTE, MOE, BE, BC, MOA, BANQUE, ASSURANCE…). Les contacts sont des `individu`, reliés aux personnes par `rattachement` (avec leur fonction). Les adresses, téléphones et courriels sont dans `coordonnee` (avec `usage_coordonnee`). Les liens entre personnes passent par `lien_personne` (FACTURER_A…).

#### MDE

| LogiBTP | MDE | Transformation |
|---|---|---|
| `personne` (une par code et par rôle, fusionnées si même SIRET, voir Q4) | `PMECLIENT` (19), `PMEFOURNISSEUR`, `PMESOUSTRAITANT`, `PMEARCHITECTE` (149), `PMECHARGEAFFAIRE` | Ces tables **n'ont ni nom ni adresse** : l'identité est dans `COMM_TIERS` (CODEGESTION = code du tiers, TYPETIERS = rôle) |
| `per_raison_sociale`, adresse | `COMM_TIERSADR` (NOM, CIVILITE, ADR, CP, VILLE, PAYS), via `COMM_TIERS.IDADRFACTURATION / IDADRLIVRAISON / IDADRCOMPTA` | Une `coordonnee` ADRESSE par usage (facturation, livraison, comptabilité) |
| `per_casquettes` | Table d'origine (PMECLIENT → CLIENT, PMEFOURNISSEUR → FOURNISSEUR, PMESOUSTRAITANT → SOUS_TRAITANT, PMEARCHITECTE → ARCHITECTE) et `TYPETIERS` | Union des rôles si le même tiers apparaît dans plusieurs tables |
| `per_siret` | `PMECLIENT.SIRET` | Nettoyage des espaces, contrôle de longueur (14) |
| `per_cli_compte`, `per_fou_*`, `per_st_*` | `COMM_TIERS.COMPTE`, `COMPTETIERS` | — |
| `per_mode_reglement` / condition | `COMM_TIERS.MODEREG` → `APIMODEREGLEMENT` | Par la correspondance du § 4.2 |
| `per_cli_encours_max` | `COMM_TIERS.ENCOURSAUTORISE` | — |
| `per_rel_*` (relances) | `COMM_TIERS.EXCLURERELANCE`, `SEUILRELANCE` | Exclusion → relances désactivées |
| `per_cli_categorie` | `PMECLIENT.CODECATEGORIE`, `CODEFAMILLE`, `CLEACTIVITE` → `PMEACTIVITE` | Catégorie client, sinon étiquette |
| `per_tva_intra` | `COMM_TIERS.NII` | — |
| `coordonnee` WEB | `COMM_TIERS.SITEINTERNET` | — |
| `per_iban` / `per_bic` | `COMM_TIERS.IDRIB` → table RIB (à localiser, Q5) | — |
| `lien_personne` FACTURER_A | `PMECLIENT.TPAYEURCODE` / `TPAYEURTYPE` (tiers payeur) | — |
| `individu` + `rattachement` | `COMM_TIERSINTERLOC` (IDADR → adresse du tiers) | La fonction est reprise en texte |
| Chargé d'affaires | `PMECHARGEAFFAIRE` → `COMM_TIERS` ou `COMM_EMPLOYE` | Devient un `individu` lié au salarié s'il en est un |
| Notes | `PMECLIENT.NOTE`… | Vers une `crm_note` de type note |
| ∅ | `PMECLIENT.NUMPARAM*`, `NBEX*` (modèles d'édition et nombre d'exemplaires), `UNEFACPARCDE`, `UNEFACPARBL`, `RELEVE`, `PERIODICITE`, `ASSUJETTITPF`, `RTCFIELD1` | Champs supplémentaires `x_` si l'utilisateur les veut (Q12) |

**Anomalie à lever** (Q5) : `COMM_TIERS` ne compte que **34 lignes**, pour 19 clients et 149 architectes, sans compter les fournisseurs et sous-traitants. Trois explications sont possibles : la base de développement est incomplète, une autre table porte l'identité (une table `PMETIERS` ou des adresses dans `PMEAFFAIRE`), ou les architectes n'ont qu'un code. Il faut une requête de comptage sur une vraie base avant de figer la jointure. Pour les tiers qui n'ont pas de fiche `COMM_TIERS`, l'import se rabat sur les adresses recopiées dans les affaires et les documents (`PMEAFFAIRE.NOMCLIENT`, `ADRCLIENT`… ; `PMEDOCDEVCLI.NOM`, `ADR`…).

#### OPTIM

| LogiBTP | OPTIM | Transformation |
|---|---|---|
| `personne` | `bib_tiers` (360) : TRS_Code, TRS_RaisonSociale, TRS_NomReduit, TRS_IsParticulier, TRS_Siret, TRS_CompteTiers, TRS_EncoursMax, TRS_IsDesactive, champs FE | Une ligne = une personne (le modèle est déjà unique, comme le nôtre) |
| `per_casquettes` | `bib_tiers_categ` → `ref_categ` (IsClient, IsFournisseur, IsSsTraitant, IsInterim, IsLoueur, IsFabricant, IsProspect…) | Chaque indicateur vrai ajoute une casquette ; IsFabricant → étiquette (pas de casquette) |
| `per_niv_code` (particulier ou société) | `TRS_IsParticulier` | — |
| `per_mode_reglement` | `TRS_ModeReglement` (achats) / `TRS_ModeReglementVte` (ventes) → `z_parametre` | Vente → client, achat → fournisseur |
| TVA par défaut | `TRS_TVA` / `TRS_TVAVte` → `z_parametre` | Vers le taux par défaut du tiers |
| `per_fe_*` (facturation électronique) | `TRS_PRM_ID_TypeFE`, `TRS_IsRFECtrl`, `TRS_DateRFECtrl`, `TRS_RFECtrlMessage` | Le statut de contrôle annuaire RFE est repris tel quel |
| `per_iban` / `per_bic` | Champs IBAN de `bib_tiers` | — |
| `coordonnee` EMAIL | `TRS_EmailAchat`, `TRS_EmailVente` | Usage achat ou vente |
| `lien_personne` | `TRS_TRS_ID_CompteFact` (compte de facturation), `TRS_TRS_ID_ComptePaie` (payeur) | FACTURER_A / payeur |
| `coordonnee` ADRESSE | `z_adresse` polymorphe (type `TRS`) | Une coordonnée par adresse |
| `individu` + `rattachement` | `bib_personne` (968) : PRS_TRS_ID, nom, prénom, fonction, téléphone, courriel | La fonction va dans `rattachement` |
| Évaluation fournisseur | `TRS_Evaluation` → `z_parametre` | Étiquette ou champ `x_` |
| Nature | `TRS_FTY_ID` → `ref_famille_type` | Nature d'achat par défaut du fournisseur |
| Notes | `TRS_Observation`, `TRS_ObsReglement` | `crm_note` |
| ∅ | `TRS_IsImport`, `TRS_BIB_ID` | Ignorés |

### 4.4 Ressources (salariés, équipes, matériels)

| LogiBTP | MDE | OPTIM | Transformation |
|---|---|---|---|
| `salarie` + `individu` (nom, prénom) | `PMESALARIE` (code) et `COMM_EMPLOYE` (CODEGESTION, CIVILITE, NOM, PRENOM, MATRICULE, INSEE, DATEENTREE, DATEDEPART, SALBASE, TAUXHORAIRE, TYPECONTRAT, CATEGORIE, EMPLOI, QUALIF, COEF) | `ref_salarie` (132) : SLR_Matricule, SLR_MatriculePaye, SLR_Nom, SLR_Prenom, SLR_NumSecu, SLR_DateEntree, SLR_DateSortie, SLR_IsInterim, adresse, téléphones, courriel | — |
| `sal_matricule` **(obligatoire)** | MATRICULE, sinon CODEGESTION | SLR_Matricule, sinon SLR_ID | Un matricule vide est généré à partir du code |
| `sal_matricule_paie` | — | SLR_MatriculePaye | — |
| `sal_num_secu` | INSEE | SLR_NumSecu | Donnée sensible : niveau de confidentialité à conserver |
| `sal_statut` (CDI / CDD / INTERIM) | TYPECONTRAT (texte libre) | SLR_IsInterim | Rapprochement par mots-clés, CDI par défaut |
| `sal_salaire` **(obligatoire)** | SALBASE | ∅ | OPTIM : **0 par défaut** (Q13) |
| `sal_cout_horaire` | TAUXHORAIRE | `ref_salarie_fonction` / `bib_article` de la ressource MO (SLR_ART_ID) | — |
| `sal_service`, `sal_poste` | CATEGORIE, EMPLOI, QUALIF | SLR_SFN_ID → `ref_salarie_fonction` | Service et poste créés à la volée |
| `sal_date_entree` | DATEENTREE | SLR_DateEntree | Date de sortie : salarié inactif |
| Mission d'intérim (`mission_interim`) | — | SLR_IsInterim + SLR_TRS_ID (agence) | Une mission ouverte par intérimaire |
| `habilitation` / `type_habilitation` | — | `ref_salarie_habilitation` / `bib_habilitation` | Dates de validité reprises |
| `equipe` / `equipe_composition` | `PMEEQUIPE`, `PMECOMPOEQUIPE`, `PMESALARIEEQUIPE` | `svh_equipe`, `svh_equipe_salarie` | — |
| `materiel` | `PMEMATERIEL`, `PMETYPEMATERIEL` | `bib_materiel` (21), `bib_materiel_visite` | `mat_valeur_achat` et `mat_date_achat` **obligatoires** : 0 et date de reprise par défaut (Q13) ; les visites vont dans l'entretien |
| `calendrier` / `jour_ferme` | — | `svhz_profil_horaire` | Profils horaires vers les calendriers |
| ∅ | NOMURGENCE, TELURGENCE, LIEUNAISSANCE, photo (IDPHOTO) | SLR_PRM_Id_Couleur, SLR_IsPlanningHebdo, SLR_IDExt | Photo → GED ; le reste en `x_` ou ignoré |

### 4.5 Bibliothèque

| LogiBTP | MDE | OPTIM | Transformation |
|---|---|---|---|
| `bibliotheque` | `PMEBIBLIO` (CODEBIBLIO vc(3)) | `bib_bibliotheque` | Une par bibliothèque source |
| `element` (ele_code, ele_libelle) | `PMEELEMENT` : CODE, LIBELLE, LIBELLECOM, LIBELLETEC, REFERENCE | `bib_article` (11 567) : ART_Code, ART_Libelle, ART_LibelleHTML (sinon RTF), ART_LibTech | MDE : RTF → HTML par `rtfEnHtml` ; OPTIM : HTML repris et nettoyé |
| `ele_type` (ARTICLE / OUVRAGE / ENSEMBLE) | `TYPEELEM` vc(2) : codes à lister (Q6) | ART_IsOuvrage → OUVRAGE, ART_IsTexte → **ligne de texte de la bibliothèque** (∅ en élément, Q7), sinon ARTICLE | — |
| `ele_nat_id` → `nature_element` | `CLENATURE` → `PMENATUREELEMENT` (205 ; COEFFG, COEFBEN, COEFVTE) | ART_FTY_ID → `ref_famille_type` (IsMO, IsMateriaux, IsEngin, IsSsTraitance, IsFraisChantier, IsInterim, IsVente) | Chaque nature source devient une `nature_element` rattachée au **regroupement** déduit (MO, MATERIAUX, ENGIN, SOUS_TRAITANCE, PRESTATION, VENTE) par `associerNature` ; les coefficients par défaut sont repris |
| `famille_element` (hiérarchique) | `PMEFAMILLE` (hiérarchique) | `bib_type_prod_prest` (ART_TPP_ID, ART_TPP_ID_SsFam) | Arbre conservé |
| `ele_gestion` (STOCK / ACHAT / SOUS_TRAITANCE / NON_GERE) | GESTSTOCK, CODESSTPRINC | ART_TypeGestion, présence dans `bib_article_stock` | — |
| Unités `ele_unite_stock`, `_achat`, `_vente`, `ele_unites` (conversions) | UNITEACHAT, UNITEVENTE, UNITESTOCK, RATIOSTOCK, RATIOVENTE, `PMEELEMENTUNITEVTE` | ART_UNT_ID (une seule unité) et les unités des tarifs | Ratios → conversions de `ele_unites` (règle `UNITE_TRANSFORMEE` / `STK_UNITE`) |
| Prix `ele_pa`, `ele_coef_fg`, `ele_pr`, `ele_coef_benef`, `ele_pv` | PA, COEFPERTE, DEBOURSE, COEFFG, PR, COEFBEN, PV, COEFVENTE, OPTIONPVIMPOSE / TYPEPVIMPOSE | Tarifs dans `bib_article_lien_tarif` (ARL_TypeTarif, PrixAchat, Remise, PrixVente), ART_CoefPerte | `float` / `double` → `decimal` ; PV imposé → prix de vente fixe ; coefficient de perte appliqué au déboursé (Q9) |
| `ele_composition` (jsonb) | `PMEELEMENTOUVCOMP` | `bib_article_lien_ouvrage` (ARO_Qte, QteFixe, CoefPerte, Cadence) | Quantité relative ou absolue (QteFixe), comme dans `convertirOptim` ; cadence → temps unitaire de MO |
| Temps de pose | TEMPS, CLEMOPOSE, OPTIONPOSE, OPTCOMPOPOSE | ART_Cadence, ART_IsMO | Vers la composante MO de l'ouvrage |
| `tarif_fournisseur` | `PMEELEMENTARTFOUR`, `PMEFOURNISSEURTARIF`, CODEFOURPRINC | `bib_article_lien_tarif` (ARL_TRS_ID), ART_TRS_ID | Fournisseur principal = tarif préféré |
| `ele_cpt_code` | COMPTEACHAT, COMPTEVENTE | Via `svcz_profil_import_compta_lien` | Sinon par la nature |
| `ele_tva_code` | TVA vc(1), CATEGORIE | ART_TYV_ID | Par la correspondance TVA |
| Stock (seuils, dépôt) | — | `bib_article_stock` | Vers `stk_emplacement` (seuils) |
| Poste de travaux | CODEPOSTE | `bib_poste_travaux` | ∅ aujourd'hui (déjà noté au TODO : poste de travaux) |
| Métré type | CLEMETRE | — | Métré attaché à l'élément : voir § 4.8 |
| ∅ | CODEFABRICANT, BIBLIOIMPORT / DEBBIBLIOIMPORT / PVBIBLIOIMPORT / PROTECTBIBLIOIMPORT (bibliothèques éditeurs), IDIMAGE, SUIVICHANTIER | ART_PlanningNbMax, ART_DelaiLivr, ART_AchatStockAtelier, ART_IsRessource | Image → GED ; le reste en `x_` ou ignoré |

### 4.6 Structure (projets, affaires, chantiers, marchés)

**Différence de modèle.** Dans LogiBTP, l'affaire regroupe des chantiers, et le **marché** appartient à un chantier (`mar_cha_id NOT NULL`). MDE porte les montants de marché sur le chantier. OPTIM les porte sur l'affaire et sur le chantier, et distingue les « vrais » chantiers des lignes de regroupement (`CHT_IsChantier`).

| LogiBTP | MDE | OPTIM | Transformation |
|---|---|---|---|
| `affaire` (aff_code, aff_libelle) | `PMEAFFAIRE` : CODE, LIBELLE, DATEAFFAIRE, DESCRIPTIF, NOTE | `afc_affaire` (814) : AFF_Code, AFF_Libelle, AFF_Reference, AFF_Commentaire | — |
| `aff_statut` (OUVERTE / CLOSE) | CLEETAT → `PMEETATAFFAIRE`, DATECLOTURE | AFF_Etat → `z_parametre` | Table d'états à valider (Q8) |
| `aff_responsable_ind_id` | CODECHARGEAFF | AFF_ChargeAff | Vers l'individu du salarié ou du chargé d'affaires |
| `aff_nature` (C / G) | CLETYPEMARCHE → `PMETYPEMARCHE` | AFF_TypeMarche, AFF_IsPublic | Public ou privé → étiquette ; nature C par défaut |
| Client de l'affaire | CODECLIENT, IDADRCLIENT, IDINTERLOCCLIENT (adresse **recopiée** : NOMCLIENT, ADRCLIENT…) | `afc_affaire_tiers` (rôles) / `afc_affaire_personne` | Lien vers la personne ; l'adresse recopiée n'est gardée que si elle diffère de la fiche |
| `intervenant` / `fonction_intervenant` | CODEARCHI (architecte), CODECHARGEAFF | `afc_affaire_tiers` / `afc_affaire_personne` (rôles MOE, BE, BC…) | Rôle source → fonction d'intervenant |
| `chantier` (cha_code, cha_aff_id, adresse) | `PMECHANTIER` : CODE, CODEAFFAIRE, LIBELLE, ADR, CP, VILLE, DATEDEBUT, DATEFINPREV, DATEFIN, CODECLIENT | `afc_chantier` (848) : CHT_Code, CHT_AFF_ID, CHT_Libelle, CHT_LibelleEdition, adresse dans `z_adresse` (type CHT), dates prévues et réelles | OPTIM : `CHT_IsChantier = 0` → pas de chantier, mais un regroupement (Q14) |
| `cha_statut` (OUVERT / TERMINE / CLOS) | CLEETAT → `PMEETATCHANTIER` | CHT_ETAT → `z_parametre` | — |
| `cha_conducteur_ind_id` / `cha_charge` / `cha_chef` | CODESALRESP | CHT_ConducTvx | — |
| `cha_code_analytique` | — | CHT_CodeAna | — |
| `cha_depot` / `cha_stock_tenu` | — | CHT_AchatStockAtelier | — |
| Chantier principal | `PMEAFFAIRE.CODECHTPRINC` | — | Ordre d'affichage |
| `marche` (mar_montant_ht, retenue) | `PMECHANTIER.MTHTMARCHEPREV`, `MTHTAVENANTPREV`, `MTTTC*`, CLETYPEMARCHE, DATESIGNATURE, TYPEFAC, CLEDOCINIT (devis initial), CODEFACACPT | `afc_chantier.CHT_TotPVT_Marche`, `CHT_TotRG`, `afc_affaire.AFF_DateSignature` ; devis de référence (VDE_IsMarche) | Un marché par chantier, rattaché au devis initial (`mar_ent_id`) ; avenants → documents liés |
| `marche_poste` / `marche_acompte` | `PMEDOCPOSTEHT`, `PMEDOCACPT` | `vte_doc_complement` | — |
| `marche_revision` / `formule_revision` / `index_prix` / `index_valeur` | — | `vte_revision_formule`, `vte_indice`, `vte_indice_valeur` (VDE_VRF_ID, VDE_VRV_ID) | Les valeurs d'indices sont reprises ; un indice inconnu est créé |
| `projet` | ∅ | `afc_dossier` / `afc_dossier_devis` (suivi commercial), `afc_chantier_suivico` | Dossier → projet (statut EN_COURS / REMIS / OBTENU / PERDU) |
| Phases de chantier | ∅ | `afc_chantier_phase` (CPH_ID, utilisé par le pointage) | Vers des tâches de planning (Q14) |
| Budget d'étude (Rentabilité) | ∅ | `afc_etude`, `afc_etude_prix_detail`, `afc_etude_exec_detail`, totaux `*_EtdExec` | Vers le budget du module Rentabilité si le format convient, sinon ∅ (Q15) |
| Actions d'affaire | `PMEAFFACTION` → `PMEACTION` | — | `crm_note` de type action |
| ∅ | DOSSIERS, PLANS (texte), ORIGINEMARCHE | AFF_TotPRT_*, AFF_TotNbHReal (totaux calculés), AFF_RGP_ID (regroupements), dates de planification | Totaux recalculés par LogiBTP ; plans → GED si ce sont des chemins |

### 4.7 Documents de vente

#### Types de documents

| `TYPE_DOCUMENT` | MDE (table d'en-tête) | OPTIM (`VDE_Type_ID` → `z_parametre`) |
|---|---|---|
| V_DEVIS | `PMEDOCDEVCLI` (TYPE vc(1) : devis ou variante, CODEDEVINIT = devis initial) | 700 DEV ; 707 BPU (devis BPU, `VDE_VDE_ID_BPU`) |
| V_COMMANDE | `PMEDOCCDECLI` | ∅ (commande portée par le devis accepté) |
| V_RECEPTION (BL) | `PMEDOCBLCLI` | ∅ |
| V_SITUATION | `PMEDOCSITTX` | 702 SIT et `vte_situation` / `vte_situation_ligne` |
| V_FACTURE | `PMEDOCFACCLI` (type facture) | 703 FAC ; 701 ATT (attachement, Q16) ; 982 INT (facture intermédiaire ?) |
| V_AVOIR | `PMEDOCFACCLI` (type avoir) | 704 AVR ; `VDE_IsRectificative` + `VDE_VDE_ID_Rectifie` |
| V_DEMANDE_ACOMPTE | `PMEDOCACPT` (acomptes du pied) | Acompte de `vte_doc_complement` |
| V_PRODUCTION | — | 983 TRA (travaux, Q16) |
| ∅ | — | `VDE_IsModele` (modèles) → modèles de documents LogiBTP ; `VDE_IsVirtuel`, `VDE_IsSauvegarde`, `VDE_IsProjetBudget` → non repris (Q16) |

#### En-tête

| LogiBTP `document` | MDE | OPTIM `vte_doc_entete` |
|---|---|---|
| `ent_numero` | CODE | VDE_Numero (code chrono) |
| `ent_date` | DATEDOC | VDE_Date |
| `ent_libelle` / texte d'en-tête | LIBELLE, DESCRIPTIF, LETTREENTETE (RTF) | libellés et `vte_doc_param` (textes) |
| `ent_std_id` (statut) | CLEETATDOC → `PMEETATDOCUMENT` (TYPEDOC, ENVOYE, ACCEPTE, NONMODIFIABLE) | VDE_Etat → `z_parametre` |
| `ent_verrouille` | NONMODIFIABLE de l'état, ou facture validée | Facture comptabilisée (`VDE_IsComptabilise`), facture transmise (FE) |
| `ent_tiers_id` + adresses jsonb | CODECLIENT + adresse **recopiée** (NOM, CIVILITE, ADR, CP, VILLE, PAYS, NOMINTERLOC) | VDE_TRS_ID_Client + `vte_doc_tiers` (rôles et adresse recopiée) |
| `ent_intervenants` jsonb | CODECHARGEAFF | `vte_doc_tiers` (autres rôles) |
| `ent_affaire_id`, `ent_chantier_id` | CODEAFFAIRE (chantier par les lignes ou par le marché) | VDE_AFF_ID, VDE_CHT_ID |
| `ent_marche_id` | Devis initial du chantier (`CLEDOCINIT`) | VDE_IsMarche |
| `ent_groupe_id`, `ent_indice`, `ent_is_reference` (versions) | CODEDEVINIT (devis d'origine), TYPE | VDE_Version, VDE_Indice |
| `ent_bib_id` | CODEBIBLIO, BIBLIOIMPOSE | — |
| `ent_mode_reglement`, `ent_cpa_code` | Mode de règlement de l'en-tête | Échéancier `vac_doc_echeance_reglement` |
| `ent_tva_id` | TYPEFACTVA, CLENATTX | TVA par défaut |
| `ent_coef_fa`, coefficients par nature | `PMEDOCCOEFDEF`, `PMEDOCLIGNENAT`, COEFVAR, MTFRAIS, REPARTFRAIS | Lignes de frais (IsFA) réparties, comme dans `convertirOptim` |
| `ent_redacteur_id` | UTILCREATION | VDE_CQui |
| Totaux `ent_total_*` | MTDEB, MTPR, MTPVBRUT, MTHT, MTREMISE, MTHTNET, MTTVA, MTTTC, MTNETAPAYER, MTACOMPTE | VDE_Mt* |
| `document_origine` (dor_type IMPORT) | Table et clé source | Table et clé source |

#### Lignes

Le modèle de lignes d'OPTIM (`vte_doc_ligne`, 34 662 lignes) est **celui du fichier `.optim`**, puisque `Devis.xml` reprend les champs `VDL_*` sans leur préfixe. Le convertisseur existant s'applique donc presque tel quel. Les lignes de MDE (`PMEDOC…LIG`, 20 661 lignes rien que pour les devis) suivent un modèle voisin, qu'il faut traduire vers le même pivot.

| LogiBTP `document_ligne` | MDE `PMEDOC…LIG` | OPTIM `vte_doc_ligne` |
|---|---|---|
| `lig_parent_id`, `lig_chemin`, `lig_ordre` | IDLIG, IDPARENT, NUMORDRE, NIVTR (niveau de titre), NIVCOMPO (niveau de composition) | Hierarchie, NumLigne, parent |
| `lig_tyl_id` (TITRE, OUVRAGE, ELEMENT, TEXTE, SOUS_TOTAL…) | TYPELIG vc(1) : valeurs à lister (Q6) ; IDSSTOTAL → SOUS_TOTAL | TypeLigne 4/3 → TITRE, 2 → OUVRAGE, 1 → ELEMENT, IsVideTexte → TEXTE (règles existantes) |
| Composante d'ouvrage | NIVCOMPO > 0 | IsSousDetail, QteFixe |
| `lig_code` | CODEELEM | Code article |
| `lig_libelle_html` | LIBELLE + LIBELLECOM (RTF) ; LIBELLETEC → texte technique | Libellé HTML, sinon RTF |
| `lig_qte`, `lig_qte_type` (R / A) | QUANTITE, QUANTITETOT | Qte, QteFixe |
| `lig_unt_code` | UNITE, DECUNITE | Unité (`associerUnite`) |
| `lig_pa`, `lig_coef_fg`, `lig_pr`, `lig_coef_benef`, `lig_pv` | DEBOURSE, COEFFG, PR, COEFBEN, COEFVENTE, PV | PAU, PctFG, PRU, PctVte, PVU (et PGU, PFIU) |
| `lig_coef_fa` | FRAIS, COEFVAR, PVVAR, ARRONDIGAL | Lignes IsFA écartées, et leur coût réparti par PGU dans le coefficient de frais généraux (règle existante) |
| `lig_pv_fixe` | PVIMPOSE, MTIMPOSE | Prix imposé |
| Remise | REMISE | Remise de ligne |
| `lig_nat_id` | CLENATURE | Nature de l'article ou du FTY |
| `lig_tva_id` / `lig_tva_taux` | CODETVA, TAUXTVA | PRM_TVA |
| `lig_mtr_id` | CLEMETRE → `PMEMETRE` | `vte_metre` (type VDL) |
| Dimensions techniques | LONGUEUR, LARGEUR, HAUTEUR (+ unités) | — |
| Temps | TEMPS, TEMPSTOT, CLEMOPOSE | Cadence |
| Compte | COMPTE | — |
| Variante / option | VARIANTE | `associerOption` |
| Poste | CODEPOSTE | ∅ (poste de travaux, TODO) |
| Couleurs | — | COUL_xx → étiquettes (règle existante) |
| ∅ | NUMEROTATION (numérotation éditée : recalculée), PVEDIT, TYPEARRONDI | IsFraisIndirect, PFIU (gardés dans le rapport) |

#### Pied, TVA et avancement

| LogiBTP | MDE | OPTIM |
|---|---|---|
| Lignes de pied (PIED_HT, PIED_TTC) | `PMEDOCPOSTEHT`, `PMEDOCPOSTETTC` | `vte_doc_complement` (prorata, remises, retenues) |
| `document_tva` | `PMEDOCTVA` | Recalculée |
| Retenue de garantie / `caution` | `PMEDOCRETENUE` | `vac_doc_retenue_caution` (polymorphe : VDE, VSI, FAC) |
| `document_deduction` (acomptes déduits) | `PMEDOCACPT` | `vte_doc_complement` |
| `document_revision` | — | `vte_revision_formule` / `vte_indice_valeur` |
| Avancement `lig_avt_*` (situations V_SITUATION / V_FACTURE_AVT) | `PMEDOCSITTX` et ses lignes | `vte_situation` / `vte_situation_ligne` (1 875) : VSL_VDL_ID → ligne du devis, VSL_Pct_Avct, VSL_Qte_Avct, VSL_MtHT, VSL_IsMtFixe |
| `document_lien` (TRANSFORMATION / COPIE) / `document_ligne_lien` | CODEDEVINIT, CLEDEVINIT (ligne de devis d'origine), `TRACABILITE` / `TRACABILITEDOC` | `vte_lien_doc`, VDE_VDE_ID_BPU, VSL_VDL_ID |

**Règle de cohérence.** Une situation LogiBTP se rattache ligne à ligne à un devis de référence (`f_document_valable`). Le devis source doit donc être repris **avant** ses situations, et la chaîne devis → situations → factures recréée par `document_lien` et `document_ligne_lien`. Une situation dont la ligne de devis d'origine est introuvable est reprise en lignes libres, et signalée.

### 4.8 Métrés

| LogiBTP `metre` | MDE | OPTIM |
|---|---|---|
| `mtr_lig_id` | `PMEMETRE` (via CLEMETRE de la ligne ou de l'élément) | `vte_metre` (polymorphe : VDL → ligne, ART → article) |
| `mtr_libelle`, `mtr_resultat` | `PMEMETRELIGNE` (2 513) : LIBELLE, RESULTAT, NIVTOT, TYPE | Formule, résultat |
| `mtr_variable` | VARRESULT, `PMEMETREVAR` | Variable |
| `mtr_script` | Lignes → script de métré, une instruction par ligne ; totaux (`PMEMETRECOLTOT`, NIVTOT) → sous-totaux | Formule → script |

Les formules sources n'ont pas forcément la même syntaxe que le script LogiBTP. Une formule non traduisible est reprise **en valeur** (le résultat), avec la formule d'origine en commentaire du script, et signalée dans le rapport.

### 4.9 Documents d'achat et de sous-traitance

| `TYPE_DOCUMENT` | MDE | OPTIM |
|---|---|---|
| Demande de prix (∅ aujourd'hui ? voir Q16) | `ENTETEDEVISFOURNISSEUR` / `LIGNEDEVISFOURNISSEUR` | 143 DPRX |
| A_COMMANDE | `ENTETECDEFOURNISSEUR` / `LIGNECDEFOURNISSEUR` | 141 CDE (`ach_doc_entete`, DOE_Type) ; 316 APPRO |
| A_RECEPTION | `ENTETERECEPTIONFOURNISSEUR` / `LIGNE…` | 142 BL ; 1144 BLCH (livraison sur chantier) |
| A_FACTURE / A_AVOIR | `ENTETEFACTUREFOURNISSEUR` / `LIGNE…` | 382 FAC, `ach_export_facture_entete` / `_ligne` ; 454 REGUL |
| T_AO | `ENTETEAOSSTRAIT` / `LIGNE…` | `afc_prestation_st_consultation` |
| T_COMMANDE | `ENTETECDESSTRAIT` / `LIGNE…` | `afc_prestation_st` / `afc_prestation_st_ligne` |
| T_FACTURE_AVT | `ENTETEFACTURESSTRAIT` / `LIGNE…` | `afc_prestation_st_situation` |
| S_RESERVATION | — | 145 RESA |
| ∅ ou E_* | — | 303 CI (commande interne ?) |

Lignes d'achat : `ach_ligne_achat` (OPTIM) ou `LIGNE*` (MDE), vers `document_ligne` de type ELEMENT. Le chantier de la ligne va dans `lig_cha_id`, puisque la ventilation par chantier se fait par les lignes (`v_document_chantiers_part`) ; les chantiers de la pièce sont alimentés dans `document_chantier`. Les liens commande → BL → facture (`ach_doc_lien_ligne_achat`, `TRACABILITE`) deviennent `document_ligne_lien`. Les lignes préparées (`ach_ligne_prepa`) sont les besoins non commandés : ∅, ou demandes d'achat (Q16).

Paiement direct des sous-traitants (`stt_paiement_direct`) : le champ source est à localiser, et il est probablement porté par la prestation.

### 4.10 Règlements, échéances, retenues

| LogiBTP (module Règlement) | MDE | OPTIM |
|---|---|---|
| `document_echeance` | `COMM_ECHEANCE`, `FIN_ECHEANCE` | `vac_doc_echeance_reglement` (polymorphe : VDE, VSI, FAC) |
| `reglement` | `FIN_DOCUMENT` | `vac_reglement_facture_vte`, `vac_reglement_lot` (remises) |
| `pointage` (lettrage règlement ↔ échéance) | `FIN_ECHEANCE` ↔ `FIN_DOCUMENT` | `vac_reglement_facture_vte` |
| `caution` | `PMEDOCRETENUE` | `vac_doc_retenue_caution` |

Les règlements ne sont repris que pour les pièces reprises, c'est-à-dire selon la profondeur d'historique choisie (Q2). La règle par défaut proposée : pour une facture soldée hors période, aucun règlement ; pour une facture ouverte, son solde est repris, quelle que soit sa date.

### 4.11 Pointage, planning, coûts réels

| LogiBTP | MDE | OPTIM | Transformation |
|---|---|---|---|
| `poi_pointage` (sal, date, chantier, type MO, minutes, début / fin, coût) | `PMECHTSUIVMO*` (suivi de main-d'œuvre par chantier) | `svh_rapport_journalier` (28 571) : RJR_SLR_ID, RJR_CHT_ID, RJR_CPH_ID, RJR_Date, RJR_Heure, RJR_HeureSup1–3, RJR_HoraireDeb/Fin1–3, RJR_Taux, RJR_Coef | Heures décimales → minutes (arrondi à la minute) ; heures supplémentaires → type MO HS1 / HS2 / HS3 ; horaires → début / fin |
| Absences | — | RJR_BoolAbsent, RJR_ABS_ID → `svhz_absence` | → `poi_nature_absence` |
| Déplacements et repas (variables de pointage) | — | RJR_NbDepl, RJR_DPL_ID, RJR_MontantDepl, RJR_NbRepas, RJR_RPS_ID, RJR_MontantRepas | Vers les indemnités du pointage, si le modèle les porte, sinon ∅ (Q17) |
| Options de pointage | — | RJR_Opt*_CHP_ID / CHV_ID | ∅ ou `x_` |
| Prépa paie | — | `ppp_*`, `pppz_*` | ∅ (hors périmètre) |
| Coûts réels (fournitures, matériel, régie) | `PMECHTSUIVFO`, `PMECHTSUIVMAT`, `PMECHTSUIVREGIE` | `svc_rapport_conso` (12 316) | Vers les coûts du module Rentabilité (consommations hors pièces) ou vers des sorties de stock (Q15) |
| `pla_tache` / `pla_affectation` | — | `pln_planification`, `pln_affectation` (polymorphe : SAL → salarié, MAT → matériel, ART → ressource), `pln_affectation_jour` | Tâche par chantier ou phase ; affectation journalière |

### 4.12 Stock

| LogiBTP | MDE | OPTIM |
|---|---|---|
| Dépôts (`stk_emplacement`, chantier-dépôt) | `PMEDEPOT` | Atelier (`CHT_AchatStockAtelier`), `bib_article_stock` |
| `stk_mouvement` | `PMESTOCKMVT`, `PMESTOCKENT` / `SORT` / `TRANS` / `INVENT` (pièces S_*) | Pièces de stock de `ach_doc_entete` |
| `stk_valeur` | `PMESTOCKREEL` | `bib_article_stock` |

Proposition : on ne reprend pas l'historique des mouvements. La reprise crée **un inventaire d'ouverture** (S_INVENTAIRE) par dépôt, à la date de reprise, avec les quantités et valeurs réelles. Cela évite de rejouer des années de mouvements avec des règles de valorisation différentes (Q18).

### 4.13 GED et CRM

| LogiBTP | MDE | OPTIM | Transformation |
|---|---|---|---|
| `contenu_ged` (par empreinte SHA-256) / `document_ged` / `version_ged` | Binaires `SYS_MDE*` (images d'éléments, photos) ; chemins PLANS et DOSSIERS | `ged_document` (GDC_Base64, GDC_NomFichier, GDC_TypeFichier, dates) | Base64 → fichier rangé sous le nom de la base (`SocieteCourante.Base`) ; doublons dédupliqués par l'empreinte |
| `repertoire_ged` | — | `ged_conteneur` | Arborescence conservée |
| Rattachement à la fiche | — | `ged_document_entite` (polymorphe : affaire, chantier, tiers, document…) | Par la table de correspondance |
| `crm_note` (ACTION / MESSAGE / TACHE) / `crm_type_note` | `PMEAFFACTION`, NOTE des fiches | `msg_message_observation` (polymorphe) | Une note par message, rattachée à sa fiche |
| Notes de chantier, plans | `PP_*` (tables propres : atelier, notes de chantier, plans) | — | À étudier au cas par cas (Q19) |

### 4.14 Utilisateurs et droits

| LogiBTP | MDE | OPTIM |
|---|---|---|
| Comptes utilisateurs | `SYS_*` (utilisateurs) | `z_utilisateur`, `z_profil`, `z_utilisateur_externe` (SLR / UTL) |

Proposition : on ne reprend **pas** les comptes, car les mots de passe ne sont pas transposables et les profils de droits sont différents. L'import fournit en revanche une **liste** (nom, courriel, profil source) dans le rapport, pour faciliter la création des comptes (Q20). Les noms d'auteur (`UTILCREATION`, `CQui`) sont gardés en texte dans la traçabilité.

---

## 5. Transformations transverses

1. **Montants.** Les `float` / `double` deviennent des `decimal` : conversion par la représentation décimale la plus courte, puis arrondi unique à 6 décimales. Les coefficients (`COEFFG`, `PctFG`…) suivent la même règle. Les montants des lignes sont **recalculés** par le moteur, et les totaux source ne servent qu'au contrôle.
2. **Pourcentages.** OPTIM stocke certains coefficients en pourcentage (`PctFG`, `PctVte`) là où LogiBTP attend un coefficient multiplicateur. La règle de `convertirOptim` est réutilisée.
3. **Textes riches.** Le RTF passe par `rtfEnHtml` (module Import). Le HTML est nettoyé par la liste blanche de l'éditeur. Le texte brut est échappé.
4. **Codes et identifiants.** Les codes texte de MDE sont gardés comme codes LogiBTP. Les entiers d'OPTIM servent seulement à la correspondance, et le code métier (`TRS_Code`, `AFF_Code`) est gardé. Une collision de codes, entre bibliothèques ou entre sociétés, est résolue par un suffixe et signalée.
5. **Types et états.** Les valeurs `z_parametre` et les tables d'états de MDE sont mappées vers les codes de `codes.js` / `Codes.cs` (`TYPE_DOCUMENT`, statuts), **jamais en dur dans le code de l'import** : la correspondance est un fichier JSON relu.
6. **Liens polymorphes (OPTIM).** `z_adresse`, `ged_document_entite`, `vte_doc_tiers`, `vac_doc_echeance_reglement`, `vac_doc_retenue_caution`, `vte_metre`, `pln_affectation` et `msg_message_observation` sont résolus par le couple (type, ID) via la table de correspondance. Un type inconnu est signalé, jamais deviné.
7. **Adresses recopiées.** Les documents et affaires gardent l'adresse figée au moment de la pièce (adresses jsonb du document), même si elle diffère de la fiche, parce qu'une facture émise ne change pas.
8. **Dates.** `datetime` devient une date ou un horodatage UTC (le fuseau source est supposé Europe/Paris). Les heures décimales deviennent des minutes.
9. **Multi-société (OPTIM).** Toute lecture est filtrée par `SCT_ID`. Les référentiels partagés (sans `SCT_ID` : unités, `z_parametre`, bibliothèques communes) sont copiés dans chaque base reprise.
10. **Indicateurs désactivés.** `IsDesactive` / `ACTIF = 0` donnent une fiche inactive. La fiche est reprise si elle est référencée par une pièce reprise, et ignorée sinon (option).

## 6. Données sans équivalent

| Donnée | Source | Proposition |
|---|---|---|
| Vues, écrans et binaires d'interface | MDE `SYS_MDE*` | Ignorées |
| Cubes, statistiques, dictionnaire | OPTIM `cub_*`, `s_*`, `z_dictionnaire*`, `z_cube*`, `z_commune` | Ignorés (LogiBTP recalcule) |
| Données génériques | OPTIM `z_dataspec_*` | À examiner : candidates aux champs supplémentaires `x_` |
| Tables propres au client | MDE `PP_*` | Au cas par cas (Q19) |
| Prépa paie détaillée | OPTIM `ppp_*`, `pppz_*` | Ignorée |
| Grilles analytiques | MDE `CMP_GRILLEANA`, `CMP_POSTEANA` | Ignorées, sauf le code analytique du chantier |
| Études d'exécution détaillées | OPTIM `afc_etude_*` | Partiellement vers le budget du module Rentabilité (Q15) |
| Suivi commercial | OPTIM `afc_dossier`, `afc_chantier_suivico` | Vers `projet` et `crm_note` |
| Poste de travaux | MDE CODEPOSTE, OPTIM `bib_poste_travaux` | ∅ aujourd'hui (déjà au TODO) ; texte du rapport, ou `x_` |
| Paramètres d'édition par tiers | MDE `NUMPARAM*`, `NBEX*` | Ignorés (modèles LogiBTP) |
| Totaux calculés | `*_TotPRT_*`, `*_TotPVT_*`, `CA`, `SOLDE` | Recalculés par LogiBTP |
| Bibliothèques d'éditeurs (Batiprix, Tarifeo, Arteva) | MDE `BIBLIOIMPORT*`, OPTIM `SCT_PRM_ID_Batiprix` / `Tarifeo` / `Arteva` | Ignorées : réabonnement côté LogiBTP |
| Comptes et mots de passe | `z_utilisateur`, `SYS_*` | Liste seulement (Q20) |

Tout champ ignoré figure dans le rapport de reprise, avec le nombre de valeurs non vides perdues. On sait ainsi ce qui se perd réellement, pas seulement ce qui existe dans le schéma.

## 7. Risques et anomalies relevés

1. **Identité des tiers MDE.** 34 lignes dans `COMM_TIERS`, pour au moins 168 tiers référencés (Q5). C'est le point bloquant de la reprise MDE.
2. **Absence de clés étrangères dans OPTIM.** Les 633 relations sont déduites par nommage, et des orphelins sont probables. L'import compte et liste les références cassées au lieu d'échouer.
3. **`z_parametre` d'OPTIM.** Les identifiants (700, 703, 141…) viennent **de cette base**. Rien ne garantit qu'ils soient les mêmes sur une autre installation OptimBTP. La correspondance doit être faite **par `PRM_Code` + `PRM_TypeParam`**, jamais par l'identifiant.
4. **Écarts d'arrondi.** Les sources calculent en `float` / `double` avec leur propre règle d'arrondi. Des écarts de quelques centimes sont attendus sur les totaux recalculés, d'où la question du traitement des pièces verrouillées (Q8).
5. **Pièces émises.** Une facture émise (et éventuellement transmise en facturation électronique) ne doit pas changer de montant. Elle est reprise verrouillée avec ses totaux d'origine, et son numéro est conservé sans trou.
6. **Volumes.** 374 k lignes pour OPTIM, et une GED en base64 dans `longtext`. Il faut une lecture en flux et des écritures par lots ; la GED doit être traitée hors transaction des pièces.
7. **Sensibilité.** Les numéros de sécurité sociale, IBAN et salaires sont repris avec le niveau de confidentialité de LogiBTP. Le rapport de reprise ne doit pas les afficher en clair.
8. **Analyses sources.** Les deux analyses décrivent des **bases de développement**, pas les bases de production. Les volumes, les états et certains types peuvent différer. Il faut une passe de simulation sur une copie de la base réelle avant toute reprise définitive.

## 8. Questions ouvertes (tranchées le 16/11/2026, voir § 10)

- **Q1 — Multi-société OPTIM.** Une société OPTIM (`SCT_ID`) donne-t-elle une base LogiBTP, comme je le propose ? Ou faut-il regrouper certaines sociétés (filiales, établissements : `SCT_SCT_ID` indique une hiérarchie) dans une même base ?
- **Q2 — Profondeur d'historique.** Faut-il tout reprendre ? Je propose un autre défaut : toutes les fiches (tiers, bibliothèque, ressources), les affaires et chantiers ouverts ou clos depuis N années, les pièces de ces chantiers, et les factures non soldées quelle que soit leur date. Quelle valeur pour N ?
- **Q3 — Lancement.** L'import en ligne de commande depuis l'installeur, sur une base neuve, suffit-il ? Ou faut-il aussi un écran d'administration avec la simulation et le rapport ?
- **Q4 — Fusion des tiers.** Un même tiers présent comme client et fournisseur (MDE : deux codes dans deux tables) doit-il être fusionné en une seule personne, par SIRET ou par nom et code postal ? Ou faut-il garder deux personnes ?
- **Q5 — Tiers MDE.** Pouvez-vous confirmer, sur une vraie base MDE, où sont le nom, l'adresse et le RIB des fournisseurs, sous-traitants et architectes ? Quelques requêtes de comptage suffisent, et je peux les rédiger.
- **Q6 — Codes MDE.** Valeurs de `PMEELEMENT.TYPEELEM` et de `PMEDOC…LIG.TYPELIG` : l'analyse ne les liste pas. Une requête `SELECT DISTINCT` sur la base réelle les donnera.
- **Q7 — Textes de bibliothèque OPTIM** (`ART_IsTexte`). Faut-il les reprendre comme éléments de type texte, ce qui demande une évolution de `ele_type`, ou comme modèles de texte ?
- **Q8 — Pièces verrouillées et écarts de calcul.** Je propose qu'une pièce émise garde ses totaux d'origine, même si le moteur trouve quelques centimes d'écart, avec l'écart signalé dans le rapport. Les devis non acceptés seraient recalculés. Est-ce acceptable ?
- **Q9 — Coefficient de perte.** Les deux sources ont un coefficient de perte par article (et par composante pour OPTIM). LogiBTP n'en a pas en propre : faut-il l'intégrer dans la quantité de composante, ou dans le déboursé ?
- **Q10 — Devises.** Peut-il y avoir des pièces dans une autre devise que l'euro ?
- **Q11 — Analytique.** Les grilles analytiques de MDE (`CMP_GRILLEANA`) servent-elles à l'export comptable actuel ? Si oui, il faut les reprendre dans le paramétrage Sage 100.
- **Q12 — Champs supplémentaires.** Parmi les champs sans équivalent (§ 6), lesquels voulez-vous conserver en champs supplémentaires `x_`, plutôt que de les perdre ?
- **Q13 — Valeurs obligatoires manquantes.** Salaire d'un salarié (absent d'OPTIM), valeur et date d'achat d'un matériel : 0 et date de reprise par défaut, ou faut-il rendre ces colonnes facultatives ?
- **Q14 — Regroupements et phases OPTIM.** Les `afc_chantier` qui ne sont pas de vrais chantiers (`CHT_IsChantier = 0`) et les phases (`afc_chantier_phase`) : faut-il les reprendre comme sous-chantiers, tâches de planning ou étiquettes ?
- **Q15 — Rentabilité.** Faut-il reprendre les budgets d'étude (`afc_etude_*`) et les consommations réelles (`svc_rapport_conso`, `PMECHTSUIV*`) dans le module Rentabilité ? Ou suffit-il de reprendre les chantiers ouverts sans leur passé économique ?
- **Q16 — Types de pièces sans équivalent direct.** Comment traiter les types suivants : attachement (701 ATT), facture intermédiaire (982 INT), travaux (983 TRA), commande interne (303 CI), demande de prix fournisseur (143 DPRX, `ENTETEDEVISFOURNISSEUR`), approvisionnement (316 APPRO), besoins préparés (`ach_ligne_prepa`), modèles de devis (`VDE_IsModele`) ?
- **Q17 — Variables de pointage.** Faut-il reprendre les déplacements, repas et options du pointage OPTIM ? Si oui, sous quelle forme, selon le modèle du pointage LogiBTP ?
- **Q18 — Stock.** Un inventaire d'ouverture à la date de reprise, sans historique des mouvements, vous convient-il ?
- **Q19 — Tables `PP_*` de MDE.** Ces tables (atelier, notes de chantier, plans) sont-elles utilisées, et faut-il les reprendre ?
- **Q20 — Utilisateurs.** La liste des utilisateurs dans le rapport vous suffit-elle, avec la création des comptes à la main ? Ou faut-il créer les comptes, avec un mot de passe à définir à la première connexion ?

## 9. Découpage initial

Remplacé par le plan du § 11.

---

## 10. Décisions du 16/11/2026

Réponses de l'utilisateur. Elles priment sur les propositions des § 3 à 8.

### 10.1 Conditions générales

- **Écarts de calcul (risque 4, Q8).** Toutes les pièces sont reprises **avec les montants vendus de la source**, devis non acceptés compris, puisqu'ils peuvent avoir été envoyés. Après recalcul par `MoteurDevisBtp`, l'écart avec le total source est porté par une **ligne d'écart d'arrondi** (`lig_is_ecart_arrondi`, une seule par parent, mécanisme existant de `db/100_btp.sql`). Les pièces validées peuvent en plus être reprises en **PV fixe** (`lig_pv_fixe`), ligne par ligne. Le rapport liste chaque écart d'arrondi créé et son montant.
- **GED (risque 6).** Elle est reprise **dans un deuxième temps**, par un lot à part, après la reprise des données.

### 10.2 Réponses aux questions

| Q | Décision |
|---|---|
| Q1 | Les sociétés OPTIM d'un même SIRET (des établissements) sont **regroupées dans une seule base**. La reprise prend donc une liste de `SCT_ID`, et non plus une seule. Voir le point restant R1. |
| Q2 | **Tout est repris**, sauf les éléments **en sommeil** (`ART_IsDesactive`, inactifs de MDE). Une ligne de pièce qui portait un élément en sommeil garde son code, son libellé et ses prix, sans lien vers la bibliothèque. Il n'y a pas de limite de date. |
| Q3 | **Écran d'administration** avec simulation et rapport, en plus de la commande de l'installeur. On crée la base, puis on lance la reprise depuis l'écran. |
| Q4 | Les tiers en double doivent **pouvoir être fusionnés**. La simulation propose des groupes de doublons (même SIRET, sinon même nom normalisé et même code postal). L'utilisateur les coche dans l'écran, puis la reprise crée une seule `personne` qui cumule les casquettes. |
| Q5 | Jointure confirmée, **la même pour tous les types de tiers** : `PMECLIENT` (ou `PMEFOURNISSEUR`, `PMESOUSTRAITANT`, `PMEARCHITECTE`, `PMECHARGEAFFAIRE`) `C` ⋈ `COMM_TIERS T ON T.CodeGestion = C.Code AND T.TypeTiers = <type>`, puis `COMM_TIERSADR A` (adresses : `T.Code = A.Code`, la principale par `IdAdrFacturation`) et `COMM_TIERSINTERLOC I ON A.IdInterloc = I.Identifiant` (contacts). **Toutes** les adresses du tiers et **tous** les contacts de chaque adresse sont repris. Les 34 lignes de la base de développement sont donc un simple jeu réduit. Colonnes reprises : Nom, Civilite, Adr, Cp, Ville, Pays ; contact Nom, Tel, Fax, Portable, EMail ; Compte, CompteTiers, DateCreation, DateModification, EnCoursAutorise, TPayeurCode ; `RTCField1` (zone supplémentaire, voir Q12). |
| Q6 | Énumérations MDE fournies, détaillées au § 10.3. |
| Q7 | Les textes de bibliothèque d'OPTIM (`ART_IsTexte`) deviennent des **modèles de texte**, c'est-à-dire des éléments `ele_type = 'TEXTE'` (type existant, `modules/bibliotheque/db/064`). |
| Q8 | Voir § 10.1 : montants vendus identiques à la source pour toutes les pièces, avec une ligne d'écart d'arrondi. |
| Q9 | Le coefficient de perte est intégré **dans les quantités** : la quantité de la composante est multipliée par le coefficient de perte. |
| Q10 | Les reprises sont toujours en euros. Une autre devise rencontrée est une anomalie bloquante du rapport. |
| Q11 | **Oui** : les grilles analytiques de MDE servent à l'export comptable, et sont reprises dans le paramétrage comptable (Sage 100). |
| Q12 | `z_dataspec_*` (OPTIM) et `SYS_RTCINFOS` / colonnes `RTCFIELD*` (MDE) sont des **champs supplémentaires des fiches**. Ils deviennent des champs `x_` (module Fiche, `1.1_champs_supplementaires`) créés à la reprise. Les champs supplémentaires des **documents** de MDE (aides au calcul) ne sont pas intégrés : les valeurs de l'en-tête sont recopiées dans une **note CRM** rattachée au document. |
| Q13 | Valeur obligatoire absente : **0, ou la date de reprise**, par défaut. Le rapport donne la **liste des valeurs forcées** (fiche, champ, valeur posée) pour que l'utilisateur les corrige ensuite. |
| Q14 | Les `afc_chantier` avec `CHT_IsChantier = 0` sont de **vrais chantiers**, mais pas forcément commerciaux (gestion, matériel…). Ils sont repris en chantiers **internes** (`cha_interne`). `afc_chantier_phase` n'est pas repris. |
| Q15 | Les consommations (`svc_rapport_conso`, `PMECHTSUIV*`) ne sont reprises que **si elles ne sont pas liées à un document**, pour éviter les doublons avec les pièces reprises : ce sont les saisies manuelles des anciens programmes. Les pièces reprises **alimentent le module Rentabilité** comme les autres : elles passent par `v_document_valable`, et la ventilation des achats par chantier par `v_document_chantiers_part`. |
| Q16 | **Non repris** : attachement (701 ATT), facture intermédiaire (982 INT), travaux (983 TRA), commande interne (303 CI), approvisionnement (316 APPRO), besoins préparés (`ach_ligne_prepa`), modèles de devis (`VDE_IsModele`). La demande de prix fournisseur (143 DPRX, `ENTETEDEVISFOURNISSEUR`) devient la **demande de prix d'achat** LogiBTP (`A_DEVIS`). |
| Q17 | Les déplacements, repas et options du pointage sont repris, **selon le modèle du pointage LogiBTP**. |
| Q18 | Le stock est repris par un **inventaire d'ouverture** à la date de reprise, sans l'historique des mouvements. |
| Q19 | Les tables `PP_*` de MDE servent à alimenter les **ordres et la synthèse par chantier** (module Exécution). Cette partie est faite **dans un deuxième temps**. |
| Q20 | Pas de création de comptes. Le rapport donne la liste des utilisateurs. Pour OPTIM, il y ajoute le **lien avec la fiche salarié ou interlocuteur** (`z_utilisateur` / `z_utilisateur_externe` : SLR → salarié, UTL ou PRS → individu), pour que le compte se rattache en un clic à sa création. MDE n'a pas ce lien. |

### 10.3 Énumérations MDE (Q6)

Ces valeurs entrent dans le fichier de correspondances par défaut (lot 0). Elles ne sont jamais écrites en dur dans le code.

**`eTypeDocument`** (`PMEETATDOCUMENT.TYPEDOC`, traçabilité, GED) :

| Code | Sens | LogiBTP |
|---|---|---|
| DC | Devis client | V_DEVIS |
| CC | Commande client | V_COMMANDE |
| LC | Réception (BL) client | V_RECEPTION |
| RC | Retour client | V_RETOUR |
| FC | Facture client | V_FACTURE (sous-type par `eTypeFacture`) |
| VC | Facture d'avancement client | V_FACTURE_AVT |
| ST | Situation client | V_SITUATION |
| AC | Avoir client | V_AVOIR |
| DF | Demande de prix fournisseur | A_DEVIS |
| CF | Commande fournisseur | A_COMMANDE |
| LF | Réception fournisseur | A_RECEPTION |
| RF | Retour fournisseur | A_RETOUR |
| FF | Facture fournisseur | A_FACTURE |
| AF | Avoir fournisseur | A_AVOIR |
| OS / DS | AO et demande de prix sous-traitant | T_AO |
| CS | Commande sous-traitant | T_COMMANDE |
| FS | Facture sous-traitant | T_FACTURE_AVT |
| AS | Avoir sous-traitant | Avoir de sous-traitance (type à confirmer au lot 10 : A_AVOIR sur le sous-traitant, à défaut) |
| A, C, DB, E, M, TA, TG, TC, TQ, TF, TE, TS | Affaire, chantier, base, élément, matériel, fiches de tiers | Rattachement polymorphe (GED, notes) vers la fiche correspondante |

**`eTypeFacture`** (`PMEDOCFACCLI.TYPE`) : C acompte → V_DEMANDE_ACOMPTE (facture d'acompte) ; T avancement → V_FACTURE_AVT ; A avoir → V_AVOIR ; F facture → V_FACTURE.

**`eTypeEtatCalcule`** (état de transformation d'une pièce) : C en cours, P partielle, T totale, S soldée. Cette valeur sert à **contrôler** les liens `document_lien` recréés (une pièce T ou S doit avoir des suites). Elle n'est pas stockée.

**`eTypeTiers`** (`COMM_TIERS.TYPETIERS`) : A architecte → ARCHITECTE ; G chargé d'affaires → individu (salarié s'il existe) ; C client → CLIENT ; F fournisseur → FOURNISSEUR ; E salarié → salarié ; S sous-traitant → SOUS_TRAITANT.

**`eTypeTiersPayeur`** (`PMECLIENT.TPAYEURTYPE`) : F facturer à → `lien_personne` FACTURER_A ; T tiers payeur simple → lien payeur ; S subrogation → lien payeur avec subrogation (en note si le modèle ne la porte pas) ; vide → aucun lien.

**`eTypeLigneVente`** (`TYPELIG` des lignes de vente) :

| Code | Sens | LogiBTP |
|---|---|---|
| T | Tranche | TITRE (niveau `NIVTR`) |
| E | Élément | OUVRAGE si la ligne a des enfants de composition (`NIVCOMPO` + 1), sinon ELEMENT ; composantes par `NIVCOMPO > 0` |
| L | Libellé | TEXTE |
| S | Sous-total | SOUS_TOTAL |
| R | Récapitulatif | Non repris en ligne (recalculé par l'édition) ; signalé |
| A | Ligne d'affaire | TEXTE portant le libellé de l'affaire (à vérifier sur données au lot 8) |
| D | Ligne de document (rappel d'une pièce) | TEXTE, avec lien de traçabilité si la pièce est reprise |
| vide | Nulle | Ignorée |

**`eTypeLigneAchat`** (lignes d'achat) : U unitaire (référencée) → ELEMENT lié à l'élément ; R non référencée → ELEMENT sans élément ; E prestation → ELEMENT de nature prestation ; T texte → TEXTE ; 1 sous-total → SOUS_TOTAL ; 2 remise → ligne de remise (pied HT) ; vide → ignorée.

**`eTypeLigneSousTraitance`** : A aucune, H hors fourniture, T totale. Cette valeur indique la part de sous-traitance d'une ligne de vente. Elle est reprise sur la ligne d'achat ou de sous-traitance liée, ou en étiquette.

**`eTypeAvancement`** (situations) : D détaillé → avancement par ligne (`lig_avt_*`) ; C global en cumul → avancement global cumulé ; S global par situation → avancement global de la situation ; vide → aucun.

**`eTypeArrondie`** (`TYPEARRONDI`) : A aucun, D défaut, E excès, P proche, F / X / H arrondis psychologiques. LogiBTP n'a qu'une règle d'arrondi. Le type source n'est pas rejoué : l'écart qu'il produisait est absorbé par la ligne d'écart d'arrondi (§ 10.1).

**`eTypeCompteur`** : correspondance des compteurs `SYS_DEFSTE.NUM*` vers `compteur_numero` par type de pièce (NUMDEVCLI → V_DEVIS, NUMFACCLI → V_FACTURE…). NUMFACLOC (location) et NUMFACINT (interne) sont sans objet, et RGMNUMOF / RGMNUMBL sont ignorés.

**`eTypeAdresse`** : chantier, dépôt de chantier, dépôt, entreprise, tiers client, fournisseur ou sous-traitant, salarié. Ces valeurs donnent l'usage de la `coordonnee` ADRESSE ou l'adresse du chantier ou du dépôt.

### 10.4 Points restants (tous tranchés le 16/11/2026)

Ces points seront tranchés dans le lot indiqué. Je les signale ici, sans attendre de réponse pour avancer.

- **R1 — Établissements regroupés (lot 1). Tranché le 16/11/2026** : les établissements ne sont pas des entités comptables et partagent la même numérotation. Il n'y a donc ni collision ni préfixe : un compteur unique par type de pièce, qui repart après le plus grand numéro de l'ensemble des établissements. L'établissement d'origine est gardé en **étiquette** sur les affaires, chantiers et pièces.
- **R2 — Sous-traitance (lot 12, validé le 16/11/2026).** Le type LogiBTP de l'avoir de sous-traitance (AS) sera vérifié sur le code du module Sous-traitance.
- **R3 — Lignes A / D de vente (lot 10, validé le 16/11/2026).** Le sens exact des lignes d'affaire et de document sera vérifié sur des données réelles.

---

## 11. Plan en lots

Règles communes :

- Un lot reste dans un module ou dans le cœur. Il est confié à l'agent `lot-dev`, avec un commit par lot ; les lots s'enchaînent (plan : `documentation/conception/plans/reprise-mde-optim.md`).
- Les codes (sources, correspondances, anomalies) vont dans `codes.js` / `Codes.cs` du module Import, avec la parité testée.
- Tout nouveau script SQL est une mineure du module (`<majeur>.<mineur>_<nom>.sql`), suivie de `npm run manifeste`.
- **Aucune** écriture vers la base source.
- Les tests de base utilisent des bases MDE et OPTIM de test construites par des scripts (conteneurs Docker SQL Server et MariaDB), jamais les bases de l'utilisateur.

### Phase 1 : reprise des données

| Lot | Contenu | Module | Critère de fin |
|---|---|---|---|
| **0** | Fichier de correspondances par défaut, en JSON versionné : énumérations MDE du § 10.3, codes `z_parametre` d'OPTIM par `PRM_Code` + `PRM_TypeParam` (types de pièces, états, TVA, règlements), regroupements de natures, casquettes. Schéma de validation du fichier. Bases sources de test, avec des scripts de création d'un jeu réduit MDE et OPTIM | `modules/import` | Fichier validé par son schéma ; bases de test montées par un script ; documentation `documentation/modules/IMPORT.md` complétée |
| **1** | Socle de reprise : modèle pivot (montants en decimal), table `import_correspondance` et journal de reprise (mineure du module Import), moteur de domaines ordonnés, simulation en transaction annulée, rapport (volumes, correspondances, valeurs forcées, écarts d'arrondi, champs perdus, anomalies, utilisateurs). Liste de sociétés sources (R1) et commande `installation societe importer` | `modules/import` (+ `modules/installation` pour la commande) | Reprise à vide sur une base neuve, rapport produit ; tests unitaires JS / C# |
| **2** | Lecteurs de source en lecture seule : SQL Server (MDE) et MariaDB (OPTIM, filtre par liste de `SCT_ID`), lecture en flux, inventaire des tables et volumes. Dépendances NuGet `Microsoft.Data.SqlClient` et `MySqlConnector`, puis `npm run rapport-dependances` | `modules/import` | Lecture des deux bases de test ; un test prouve qu'aucun ordre d'écriture n'est émis |
| **3** | Écran d'administration « Reprise de données » : connexion à la source, choix des sociétés, simulation, rapport consultable, ajustement des correspondances, **choix des fusions de tiers**, lancement de la reprise réelle. Écran refusé si la base contient déjà des données métier | `modules/import` (interface) + route déclarée dans `SpecialisationDroitsBtp.Routes` et `EcrituresBtp.Routes` | Parcours e2e simulation → rapport → reprise sur la base de test ; aucun texte, icône ni couleur en dur |
| **4** | Société et référentiels : identité, compteurs, décimales, unités, TVA, modes et conditions de règlement, pays, civilités, plan comptable, **grilles analytiques** vers le paramétrage Sage 100 (Q11), natures et familles | Cœur (`src/`) | Référentiels des deux bases de test repris ; compteurs repartant après le plus grand numéro |
| **5** | Champs supplémentaires des fiches : `z_dataspec_*` et `SYS_RTCINFOS` / `RTCFIELD*` vers des champs `x_` créés par l'API du module Fiche (Q12) | Cœur | Champs créés et valeurs reprises sur les fiches de test |
| **6** | Annuaire : personnes et casquettes, **toutes les adresses et tous les contacts** (jointure du § 10.2, Q5), tiers payeurs, RIB, facturation électronique, **fusion des doublons** choisis dans l'écran | Cœur | Nombre de fiches, adresses et contacts égal à la source, moins les fusions ; tests de fusion |
| **7** | Ressources : salariés, intérim, équipes, matériels, habilitations, calendriers ; valeurs forcées listées (Q13) | Cœur | Fiches reprises ; liste des valeurs forcées dans le rapport |
| **8** | Bibliothèque : éléments (hors sommeil, Q2), ouvrages et compositions avec le **coefficient de perte dans les quantités** (Q9), modèles de texte (Q7), unités et conversions, tarifs fournisseurs | Cœur | Prix de vente d'un ouvrage source retrouvé à 0,01 € près |
| **9** | Structure : projets (suivi commercial), affaires, chantiers dont chantiers **internes** (Q14), marchés, intervenants, révision | Cœur | Arborescence complète ; marchés rattachés à leur devis |
| **10** | Pièces de vente : en-têtes, lignes (`convertirOptim` pour OPTIM, traducteur MDE de `eTypeLigneVente`), pieds, TVA, versions, métrés, statuts ; **ligne d'écart d'arrondi** pour retrouver le montant source, **PV fixe** sur les pièces validées (§ 10.1) ; champs supplémentaires des en-têtes MDE en note CRM (Q12) | Cœur (+ `modules/import` pour le convertisseur commun) | Total HT et TTC de **chaque** pièce égal au total source ; écarts listés |
| **11** | Situations et avancement (`eTypeAvancement`), factures d'avancement, avoirs, acomptes, retenues, chaîne devis → situation → facture, contrôlée par `eTypeEtatCalcule` | Cœur | Cumul d'avancement de chaque chantier égal à la source |
| **12** | Achats et sous-traitance : demandes de prix (A_DEVIS), commandes, réceptions, retours, factures, avoirs, AO, contrats et situations de sous-traitance, liens de lignes, ventilation par chantier (R2). Types non repris exclus (Q16) | Cœur | Coûts d'achat par chantier (`v_document_chantiers_part`) égaux à la source |
| **13** | Règlements et échéances : échéanciers, règlements, lettrage, cautions | `modules/reglement` + cœur | Soldes clients et fournisseurs égaux à la source à la date de reprise |
| **14** | Exploitation : pointage en minutes (heures supplémentaires, absences, **déplacements, repas, options** selon le modèle LogiBTP, Q17), planning, inventaire de stock d'ouverture (Q18), **consommations non liées à un document** vers Rentabilité (Q15) | Cœur | Heures par salarié, chantier et mois égales à la source ; marge de Rentabilité d'un chantier de test cohérente avec la source |
| **15** | Recette de la phase 1 : simulation complète sur une copie de chaque base réelle (faite par l'utilisateur sur son poste), relecture du rapport, mise à jour de la documentation (`MODULES.md`, `JOURNAL-LOTS.md`, `TODO.md`) | Documentation + tests | Rapport validé par l'utilisateur ; `npm test` et `dotnet test LogiBTP.slnx` verts |

### Phase 2 : deuxième temps

| Lot | Contenu | Module | Critère de fin |
|---|---|---|---|
| **16** | GED : contenus base64 d'OPTIM et binaires de MDE, dédupliqués par empreinte et rangés sous le nom de la base ; répertoires ; rattachements polymorphes ; notes et messages (`msg_message_observation`, `PMEAFFACTION`) | Cœur (module GED) | Nombre de fichiers et empreintes vérifiés ; rattachement à la bonne fiche |
| **17** | Tables `PP_*` de MDE vers les ordres et la synthèse par chantier (module Exécution), après une analyse courte de ces tables | Cœur (module Exécution) | Ordres et synthèse d'un chantier de test cohérents avec MDE |
