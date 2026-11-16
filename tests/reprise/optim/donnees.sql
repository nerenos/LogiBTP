-- Jeu de données réduit de la base source OPTIM de test (fictif). Chargé après schema.sql par tests/reprise/monter.sh.
-- Jeu de base du lot 0 : sociétés, paramètres, référentiels, annuaire ; chaque lot de domaine complète ce fichier.
-- Cas couverts : deux établissements d'un même SIRET (regroupés dans une base, R1) et une autre société ; types portés
-- par z_parametre (rapprochés par PRM_TypeParam + PRM_Code, jamais par PRM_ID) ; tiers à plusieurs catégories ;
-- plusieurs adresses (z_adresse polymorphe, TRS) et contacts ; doublon de tiers (même SIRET) ; zones supplémentaires
-- (z_dataspec_*).
SET NAMES utf8mb4;

-- Sociétés : 1 et 2 partagent le SIRET (établissements), 3 est une autre société
INSERT INTO ref_societe (SCT_ID, SCT_SCT_ID, SCT_Niveau, SCT_TRS_ID, SCT_RaisonSociale, SCT_LibelleCourt, SCT_CodeChrono,
  SCT_CodeCompta, SCT_CodeAna, SCT_IsDesactive) VALUES
 (1, 0, 1, 900, 'CONSTRUCTIONS DU RHONE', 'CDR', 'CDR', 'CDR', 'AN-LYON', 0),
 (2, 1, 2, 901, 'CONSTRUCTIONS DU RHONE - AGENCE ALPES', 'CDR-ALP', 'CDR', 'CDR', 'AN-ALPES', 0),
 (3, 0, 1, 902, 'RHONE ENERGIE', 'RHE', 'RHE', 'RHE', '', 0);

-- Paramètres (les PRM_ID n'ont aucun sens hors de cette base)
INSERT INTO z_parametre (PRM_ID, PRM_Code, PRM_Libelle, PRM_TypeParam, PRM_Ordre, PRM_IsDesactive) VALUES
 (700, 'DEV', 'Devis', 'TypeDocVte', 1, 0),
 (701, 'ATT', 'Attachement', 'TypeDocVte', 2, 0),
 (702, 'SIT', 'Etat situation', 'TypeDocVte', 3, 0),
 (703, 'FAC', 'Facture', 'TypeDocVte', 4, 0),
 (704, 'AVR', 'Avoir', 'TypeDocVte', 5, 0),
 (707, 'BPU', 'Bordereau', 'TypeDocVte', 6, 0),
 (982, 'INT', 'Bon d''intervention', 'TypeDocVte', 7, 0),
 (983, 'TRA', 'Bon de travail', 'TypeDocVte', 8, 0),
 (141, 'CDE', 'Commande', 'TypeDocAchat', 1, 0),
 (142, 'BL', 'Bon de livraison', 'TypeDocAchat', 2, 0),
 (143, 'DPRX', 'Demande de prix', 'TypeDocAchat', 3, 0),
 (145, 'RESA', 'Ordre de réservation', 'TypeDocAchat', 4, 0),
 (303, 'CI', 'Cession Interne', 'TypeDocAchat', 5, 0),
 (316, 'APPRO', 'Demande d''appro', 'TypeDocAchat', 6, 0),
 (382, 'FAC', 'Facture', 'TypeDocAchat', 7, 0),
 (454, 'REGUL', 'Regule', 'TypeDocAchat', 8, 0),
 (1144, 'BLCH', 'Document reçu sur chantier', 'TypeDocAchat', 9, 0),
 (1046, 'INFO', 'Information', 'Message_Type', 1, 0),
 (1047, 'MSG', 'Message', 'Message_Type', 2, 0),
 (1048, 'TACHE', 'Tâche', 'Message_Type', 3, 0),
 (1201, 'M', 'M.', 'Civilite', 1, 0),
 (1203, 'DR', 'Docteur', 'Civilite', 3, 0),
 (1202, 'MME', 'Mme', 'Civilite', 2, 0);

-- Taux de TVA et modes de règlement (PRM_TypeParam propre à la base : retrouvés par les colonnes qui les citent ;
-- taux en PRM_Param_Num1). Le taux 8,5 % n'existe pas dans LogiBTP : il est créé.
INSERT INTO z_parametre (PRM_ID, PRM_Code, PRM_Libelle, PRM_TypeParam, PRM_Ordre, PRM_IsDesactive, PRM_Param_Num1) VALUES
 (51, 'T20', 'TVA 20 %', 'TVA', 1, 0, 20),
 (52, 'T10', 'TVA 10 %', 'TVA', 2, 0, 10),
 (53, 'AUTO', 'Autoliquidation', 'TVA', 3, 0, 0),
 (54, 'T85', 'TVA DOM 8,5 %', 'TVA', 4, 0, 8.5),
 (61, 'CHQ', 'Chèque', 'ModeRegl', 1, 0, 0),
 (62, 'VIR', 'Virement', 'ModeRegl', 2, 0, 0),
 (63, 'TRAITE', 'Traite acceptée', 'ModeRegl', 3, 0, 0);

-- Plan comptable : commun (SCT_ID 0), propre à CDR (1), propre à l'autre société (3, non repris)
INSERT INTO svcz_compte (CPT_ID, CPT_NumCompte, CPT_Libelle, CPT_SCT_ID) VALUES
 (1, '411000', 'Clients', 0), (2, '401000', 'Fournisseurs', 0), (3, '704100', 'Travaux CDR', 1), (4, '704900', 'Travaux RHE', 3),
 (5, '512100', 'Banque CDR', 1);

-- Référentiels
INSERT INTO z_unite (UNT_ID, UNT_Code, UNT_Libelle, UNT_IsDefaut, UNT_IsDesactive) VALUES
 (1, 'U', 'Unité', 1, 0), (2, 'm²', 'Mètre carré', 0, 0), (3, 'ml', 'Mètre linéaire', 0, 0), (4, 'h', 'Heure', 0, 0),
 (5, 'Ens', 'Ensemble', 0, 0), (6, 'Forf', 'Forfait', 0, 0);
INSERT INTO ref_categ (CAT_ID, CAT_Code, CAT_Libelle, CAT_IsAchat, CAT_IsVente, CAT_IsFournisseur, CAT_IsSsTraitant,
  CAT_IsInterim, CAT_IsLoueur, CAT_IsClient, CAT_IsFabricant, CAT_IsProspect, CAT_IsDesactive) VALUES
 (1, 'CLI', 'Client', 0, 1, 0, 0, 0, 0, 1, 0, 0, 0),
 (2, 'FOU', 'Fournisseur', 1, 0, 1, 0, 0, 0, 0, 0, 0, 0),
 (3, 'ST', 'Sous-traitant', 1, 0, 0, 1, 0, 0, 0, 0, 0, 0),
 (4, 'INT', 'Intérim', 1, 0, 0, 0, 1, 0, 0, 0, 0, 0),
 (5, 'LOC', 'Loueur', 1, 0, 0, 0, 0, 1, 0, 0, 0, 0),
 (6, 'PRO', 'Prospect', 0, 1, 0, 0, 0, 0, 0, 0, 1, 0),
 (7, 'FAB', 'Fabricant', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0);
INSERT INTO ref_famille_type (FTY_ID, FTY_Code, FTY_Libelle, FTY_IsDesactive, FTY_Ordre, FTY_IsMateriaux, FTY_IsMO,
  FTY_IsEngin, FTY_IsSsTraitance, FTY_IsFraisChantier, FTY_IsInterim, FTY_IsVente) VALUES
 (1, 'MAT', 'Matériaux', 0, 1, 1, 0, 0, 0, 0, 0, 0),
 (2, 'MO', 'Main-d''œuvre', 0, 2, 0, 1, 0, 0, 0, 0, 0),
 (3, 'ENG', 'Engins', 0, 3, 0, 0, 1, 0, 0, 0, 0),
 (4, 'ST', 'Sous-traitance', 0, 4, 0, 0, 0, 1, 0, 0, 0),
 (5, 'FC', 'Frais de chantier', 0, 5, 0, 0, 0, 0, 1, 0, 0),
 (6, 'INTERIM', 'Intérim', 0, 6, 0, 1, 0, 0, 0, 1, 0),
 (7, 'VTE', 'Vente', 0, 7, 0, 0, 0, 0, 0, 0, 1);

-- Annuaire (bib_tiers n'a pas de SCT_ID : les tiers sont communs aux sociétés)
INSERT INTO bib_tiers (TRS_ID, TRS_IsTiers, TRS_NomReduit, TRS_RaisonSociale, TRS_Code, TRS_IsParticulier, TRS_Siret,
  TRS_CompteTiers, TRS_IsDesactive, TRS_EncoursMax, TRS_EmailAchat, TRS_EmailVente, TRS_Observation) VALUES
 (900, 0, 'CDR', 'CONSTRUCTIONS DU RHONE', 'SOC-CDR', 0, '98765432100011', NULL, 0, 0, '', '', NULL),
 (901, 0, 'CDR ALPES', 'CONSTRUCTIONS DU RHONE - AGENCE ALPES', 'SOC-CDRALP', 0, '98765432100029', NULL, 0, 0, '', '', NULL),
 (902, 0, 'RHE', 'RHONE ENERGIE', 'SOC-RHE', 0, '11122233300044', NULL, 0, 0, '', '', NULL),
 (10, 1, 'DUPONT', 'DUPONT Marie', 'CLI-DUPONT', 1, NULL, '411DUPONT', 0, 0, '', 'marie.dupont@exemple.fr', 'Cliente particulière'),
 (11, 1, 'IMMO GRAND LYON', 'SAS IMMO GRAND LYON', 'CLI-IGL', 0, '33344455500016', '411IGL', 0, 150000.5, '', 'factures@igl.fr', NULL),
 (12, 1, 'NEGOBAT', 'NEGOBAT SA', 'FOU-NEGO', 0, '66677788800013', '401NEGO', 0, 0, 'cde@negobat.fr', 'ventes@negobat.fr', NULL),
 (13, 1, 'NEGOBAT (doublon)', 'NEGOBAT', 'CLI-NEGO', 0, '66677788800013', '411NEGO', 0, 0, '', '', 'Créé en double côté vente'),
 (14, 1, 'TERRASS 69', 'TERRASSEMENTS 69', 'ST-T69', 0, '12312312300012', '401T69', 0, 0, '', '', NULL),
 (15, 1, 'ANCIEN', 'ANCIEN FOURNISSEUR', 'FOU-OLD', 0, NULL, '401OLD', 1, 0, '', '', NULL);
UPDATE bib_tiers SET TRS_TVA = 51, TRS_ModeReglementVte = 62 WHERE TRS_ID = 11;
UPDATE bib_tiers SET TRS_TVA = 53, TRS_ModeReglement = 63 WHERE TRS_ID = 14;
UPDATE bib_tiers SET TRS_TVAVte = 54, TRS_ModeReglementVte = 61 WHERE TRS_ID = 10;
-- Payeur (facturé au bailleur) et RIB d'un sous-traitant.
UPDATE bib_tiers SET TRS_TRS_ID_CompteFact = 11 WHERE TRS_ID = 10;
UPDATE bib_tiers SET TRS_NumCpteBq = 'FR76 3000 6000 0112 3456 7890 189', TRS_NumCpteBic = 'AGRIFRPP' WHERE TRS_ID = 14;
UPDATE bib_tiers SET TRS_TvaIntra = 'FR33987654321' WHERE TRS_ID IN (900, 901);
INSERT INTO bib_tiers_categ (TRC_ID, TRC_TRS_ID, TRC_CAT_ID, TRC_IsValDefaut) VALUES
 (1, 10, 1, 1), (2, 11, 1, 1), (3, 11, 6, 0), (4, 12, 2, 1), (5, 12, 7, 0), (6, 13, 1, 1), (7, 14, 3, 1), (8, 14, 5, 0),
 (9, 15, 2, 1);
INSERT INTO z_adresse (ADR_Id, ADR_Libelle, ADR_TypeEntite, ADR_Entite_Id, ADR_Ligne1, ADR_Ligne2, ADR_CP, ADR_Ville,
  ADR_Pays, ADR_NumTel1, ADR_NumPort, ADR_Email, ADR_IsDesactive) VALUES
 (1, 'Siège', 'TRS', 900, '5 rue de la République', NULL, '69002', 'Lyon', 'France', '0472000000', NULL, NULL, 0),
 (2, 'Agence', 'TRS', 901, '3 avenue des Alpes', NULL, '38000', 'Grenoble', 'France', NULL, NULL, NULL, 0),
 (3, 'Domicile', 'TRS', 10, '7 impasse des Lilas', NULL, '69500', 'Bron', 'France', NULL, '0644444444', 'marie.dupont@exemple.fr', 0),
 (4, 'Siège', 'TRS', 11, '100 cours Lafayette', 'Tour Part-Dieu', '69003', 'Lyon', 'France', '0472111111', NULL, NULL, 0),
 (5, 'Facturation', 'TRS', 11, 'Service comptable', 'BP 1234', '69421', 'Lyon Cedex 03', 'France', NULL, NULL, 'factures@igl.fr', 0),
 (6, 'Siège', 'TRS', 12, 'ZA des Platières', NULL, '69440', 'Mornant', 'France', '0478999999', NULL, NULL, 0),
 (7, 'Siège', 'TRS', 13, 'ZA des Platières', NULL, '69440', 'Mornant', 'France', NULL, NULL, NULL, 0),
 (8, 'Siège', 'TRS', 14, 'Route de Vienne', NULL, '69200', 'Vénissieux', 'France', NULL, NULL, NULL, 0);
INSERT INTO bib_personne (PRS_ID, PRS_TRS_ID, PRS_Nom, PRS_Prenom, PRS_Civilite, PRS_LibFct, PRS_IsPrincipal,
  PRS_IsComptable, PRS_IsDesactive, PRS_NumTel, PRS_NumPort, PRS_Email) VALUES
 (1, 11, 'LEROY', 'Antoine', 1201, 'Directeur de programmes', 1, 0, 0, '0472111112', '0655555555', 'a.leroy@igl.fr'),
 (2, 11, 'MOREL', 'Sophie', 1202, 'Comptable', 0, 1, 0, '0472111113', NULL, 's.morel@igl.fr'),
 (3, 12, 'GIRARD', 'Paul', 1201, 'Commercial', 1, 0, 0, NULL, '0666666666', 'p.girard@negobat.fr'),
 (4, 14, 'FAURE', 'Nicolas', 1201, 'Gérant', 1, 0, 0, NULL, '0677777777', NULL);

-- Zones supplémentaires (DTB : définition, DTD : valeur, entité polymorphe). Le sens des codes DTB_DataType et
-- DTB_SaisieType n'est pas documenté : l'import déduit le type de la colonne de valeur renseignée (DTD_TXT, DTD_Num, DTD_Date).
INSERT INTO z_dataspec_bdd (DTB_ID, DTB_Code, DTB_Libelle, DTB_Ordre, DTB_DataType, DTB_SaisieType, DTB_IsDesactive) VALUES
 (1, 'NUM_PARC', 'Numéro de parc', 1, 0, 0, 0),
 (2, 'DATE_CT', 'Date du contrôle technique', 2, 2, 0, 0),
 (3, 'POIDS', 'Poids (kg)', 3, 1, 0, 0);
INSERT INTO z_dataspec_data (DTD_ID, DTD_DTB_ID, DTD_TypeEntite, DTD_Entite_Id, DTD_TXT, DTD_Num, DTD_Date) VALUES
 (1, 1, 'MTR', 1, 'P-0012', 0, NULL),
 (2, 2, 'MTR', 1, '', 0, '2026-03-15'),
 (3, 3, 'ART', 1, '', 25.5, NULL);

-- Ressources (lot 7) : profil horaire (calendrier), salariés de deux établissements retenus et d'une société non
-- retenue, intérimaire chez une agence (tiers 14), sorti ; habilitations (une rapprochée, une créée) ; équipe ;
-- matériels (famille / type / énergie dans z_parametre, location, générique par nombre) et visite réglementaire ;
-- utilisateurs liés à un salarié (SLR) ou à un interlocuteur (PRS), accès mobile d'un salarié.
INSERT INTO z_parametre (PRM_ID, PRM_Code, PRM_Libelle, PRM_TypeParam, PRM_Ordre, PRM_IsDesactive) VALUES
 (801, 'ENG', 'Engins', 'FamilleMateriel', 1, 0), (802, 'MPEL', 'Mini-pelle', 'TypeMateriel', 1, 0),
 (803, 'VEH', 'Véhicules', 'FamilleMateriel', 2, 0), (804, 'UTIL', 'Utilitaire de chantier', 'TypeMateriel', 2, 0),
 (810, 'GO', 'Gazole', 'Energie', 1, 0);
INSERT INTO svhz_profil_horaire (PRH_ID, PRH_Libelle) VALUES (1, 'Horaire chantier 39 h');
INSERT INTO svhz_profil_horaire_periode (PHP_ID, PHP_PRH_ID, PHP_IsAbsence, PHP_DateDebut, PHP_DateFin,
  PHP_HoraireLundiDeb1, PHP_HoraireLundiFin1, PHP_HoraireLundiDeb2, PHP_HoraireLundiFin2,
  PHP_HoraireMardiDeb1, PHP_HoraireMardiFin1, PHP_HoraireMardiDeb2, PHP_HoraireMardiFin2,
  PHP_HoraireMercrediDeb1, PHP_HoraireMercrediFin1, PHP_HoraireMercrediDeb2, PHP_HoraireMercrediFin2,
  PHP_HoraireJeudiDeb1, PHP_HoraireJeudiFin1, PHP_HoraireJeudiDeb2, PHP_HoraireJeudiFin2,
  PHP_HoraireVendrediDeb1, PHP_HoraireVendrediFin1, PHP_HoraireVendrediDeb2, PHP_HoraireVendrediFin2) VALUES
 (1, 1, 0, '0101', '1231', '07:30', '12:00', '13:00', '16:30', '07:30', '12:00', '13:00', '16:30', '07:30', '12:00', '13:00', '16:30',
  '07:30', '12:00', '13:00', '16:30', '07:30', '12:00', '13:00', '15:30');
INSERT INTO ref_salarie_fonction (SFN_ID, SFN_Code, SFN_Libelle, SFN_IsSal, SFN_IsDesactive) VALUES
 (1, 'MAC', 'Maçon', 1, 0), (2, 'CE', 'Chef d''équipe', 1, 0);
INSERT INTO ref_salarie (SLR_ID, SLR_SCT_ID, SLR_Matricule, SLR_MatriculePaye, SLR_Nom, SLR_Prenom, SLR_SFN_ID, SLR_PRH_ID, SLR_TRS_ID,
  SLR_NumSecu, SLR_Observation, SLR_IsDesactive, SLR_DateEntree, SLR_DateSortie, SLR_IsInterim, SLR_Adresse, SLR_CodePostal, SLR_Ville,
  SLR_Telephone, SLR_Portable, SLR_Email) VALUES
 (1, 1, 'M001', 'P001', 'MARTIN', 'Jean', 2, 1, 0, '180016912345612', NULL, 0, '2015-03-01', NULL, 0, '12 rue Pasteur', '69007', 'Lyon',
  NULL, '0601010101', 'j.martin@cdr.fr'),
 (2, 2, 'M002', NULL, 'DUBOIS', 'Pierre', 1, 1, 0, NULL, NULL, 0, '2020-09-01', NULL, 0, NULL, NULL, NULL, NULL, NULL, ''),
 (3, 1, '', NULL, 'LAMBERT', 'Kevin', 1, 0, 14, NULL, 'Intérimaire', 0, '2026-10-01', '2026-12-31', 1, NULL, NULL, NULL, NULL, NULL, ''),
 (4, 1, 'M004', NULL, 'ROUX', 'Alain', 1, 1, 0, NULL, NULL, 1, '2001-01-15', '2024-06-30', 0, NULL, NULL, NULL, NULL, NULL, ''),
 (5, 3, 'X01', NULL, 'AUTRE', 'Société', 1, 0, 0, NULL, NULL, 0, '2022-01-01', NULL, 0, NULL, NULL, NULL, NULL, NULL, '');
INSERT INTO bib_habilitation (HAB_ID, HAB_Code, HAB_Libelle, HAB_DureeAn, HAB_IsSansLimite, HAB_IsDesactive) VALUES
 (1, 'CACES R482 A', 'CACES engins compacts', 10, 0, 0), (2, 'ECHAF', 'Montage d''échafaudage', 0, 1, 0);
INSERT INTO ref_salarie_habilitation (SHA_ID, SHA_SLR_ID, SHA_HAB_ID, SHA_DateObtention, SHA_OrgaObtention, SHA_DateValidite, SHA_IsDesactive) VALUES
 (1, 1, 1, '2020-01-15', 'AFPA', '2030-01-15', 0), (2, 2, 2, '2025-05-01', NULL, NULL, 0), (3, 5, 1, '2022-02-01', NULL, NULL, 0);
INSERT INTO svh_equipe (EQP_ID, EQP_Code, EQP_Libelle, EQP_Observation, EQP_SCT_ID, EQP_IsDesactive) VALUES
 (1, 'EQ-GO', 'Équipe gros œuvre', NULL, 1, 0), (2, 'EQ-RHE', 'Équipe autre société', NULL, 3, 0);
INSERT INTO svh_equipe_salarie (EQS_ID, EQS_EQP_ID, EQS_SLR_ID) VALUES (1, 1, 1), (2, 1, 2), (3, 1, 3), (4, 2, 5);
INSERT INTO bib_materiel (MTR_ID, MTR_FamilleMateriel_ID, MTR_TypeMateriel_ID, MTR_IsGenerique, MTR_Qte, MTR_IsLocation, MTR_TRS_ID,
  MTR_Numero, MTR_Marque, MTR_Modele, MTR_Designation, MTR_NumSerie, MTR_Immatriculation, MTR_Energie_ID, MTR_Poid, MTR_Hauteur,
  MTR_UniteCompteur, MTR_Compteur, MTR_DateEntree, MTR_DateGarantie, MTR_IsDesactive) VALUES
 (1, 801, 802, 0, 1, 0, '', 'MP01', 'Kubota', 'KX019', 'Mini-pelle 1,9 t', 'KB123', '', 810, 1900, 2.4, 'H', 1250, '2021-04-01',
  '2023-04-01', 0),
 (2, 803, 804, 0, 1, 1, '14', 'VU02', 'Renault', 'Master', 'Fourgon de chantier', '', 'AB-123-CD', 810, 0, 0, 'KM', 45000, '2024-01-10',
  NULL, 0),
 (3, 0, 0, 1, 12, 0, '', '', '', '', 'Étais tirant-poussant', '', '', 0, 0, 0, '', 0, NULL, NULL, 0);
INSERT INTO bib_materiel_visite (MTV_ID, MTV_MTR_ID, MTV_Ordre, MTV_Type, MTV_Libelle, MTV_Frequence, MTV_DateDernier, MTV_DateProchain,
  MTV_IsDesactive) VALUES (1, 2, 1, 0, 'Contrôle technique', 24, '2025-03-15', '2027-03-15', 0);
INSERT INTO z_profil (PRF_ID, PRF_Libelle) VALUES (1, 'Administrateur'), (2, 'Conducteur de travaux');
INSERT INTO z_utilisateur (UTL_ID, UTL_PRF_ID, UTL_Nom, UTL_Prenom, UTL_NomReduit, UTL_PRS_ID, UTL_SLR_ID, UTL_SCT_ID, UTL_Login,
  UTL_Email, UTL_IsDesactive) VALUES
 (1, 2, 'MARTIN', 'Jean', 'JM', 0, 1, 1, 'jmartin', 'j.martin@cdr.fr', 0),
 (2, 1, 'LEROY', 'Antoine', 'AL', 1, 0, 1, 'aleroy', 'a.leroy@igl.fr', 0),
 (3, 1, 'ANCIEN', 'Compte', 'AC', 0, 0, 1, 'ancien', NULL, 1);
INSERT INTO z_utilisateur_externe (UTX_ID, UTX_TypeEntite, UTX_Entite_Id, UTX_IsUserAppMob, UTX_IsDesactive) VALUES (1, 'SLR', 2, 1, 0);

-- Bibliothèque (lot 8) : bibliothèque par défaut et bibliothèque désactivée, familles sur deux niveaux, articles (béton
-- avec perte, tarif de référence remisé et tarif d'un second fournisseur avec conversion d'unité ; heure de MO à tarif
-- sans fournisseur), texte (Q7), article désactivé (composante sans lien), ouvrage dont le PV est retrouvé en mode
-- prix de vente, ouvrage à montant fixe. L'article 1 porte la zone supplémentaire POIDS (z_dataspec_data 3).
INSERT INTO bib_bibliotheque (BIB_ID, BIB_Code, BIB_Libelle, BIB_IsDesactive, BIB_IsDefaut) VALUES
 (1, 'GENERALE', 'Bibliothèque générale', 0, 1), (2, 'ANCIENNE BIB', 'Ancienne bibliothèque', 1, 0);
INSERT INTO bib_type_prod_prest (TPP_ID, TPP_BIB_ID, TPP_TPP_ID, TPP_Niveau, TPP_Code, TPP_Libelle, TPP_IsDesactive) VALUES
 (1, 1, 0, 1, 'GO', 'Gros œuvre', 0), (2, 1, 1, 2, 'BETON', 'Bétons', 0), (3, 2, 0, 1, 'VIEILLE', 'Famille désactivée', 1);
INSERT INTO bib_article (ART_ID, ART_BIB_ID, ART_IsTexte, ART_IsOuvrage, ART_Code, ART_Libelle, ART_LibelleHTML, ART_LibTech, ART_UNT_ID,
  ART_FTY_ID, ART_IsMO, ART_CoefPerte, ART_IsDesactive, ART_TPP_ID, ART_TPP_ID_SsFam, ART_DelaiLivr, ART_CodeBarre, ART_PRM_TVA) VALUES
 (1, 1, 0, 0, 'BETON-C25', 'Béton C25/30', '<b>Béton</b> C25/30', 'Classe XC1', 1, 1, 0, 0.05, 0, 1, 2, 3, '3760000000011', 51),
 (2, 1, 0, 0, 'MO-MACON', 'Heure de maçon', NULL, NULL, 4, 2, 1, 0, 0, 1, 0, NULL, NULL, 51),
 (3, 1, 1, 0, 'TXT-GARANTIE', 'Garantie décennale', '<p>Garantie décennale</p><p>Assurance dommages-ouvrage</p>', NULL, 1, 0, 0, 0, 0, 0, 0, NULL, NULL, 0),
 (4, 1, 0, 1, 'DALLE', 'Dalle béton', NULL, NULL, 2, 7, 0, 0, 0, 1, 0, NULL, NULL, 51),
 (5, 1, 0, 0, 'ANCIEN', 'Article désactivé', NULL, NULL, 1, 1, 0, 0, 1, 0, 0, NULL, NULL, 51),
 (6, 1, 0, 1, 'FORFAIT-POSE', 'Forfait de pose', NULL, NULL, 6, 7, 0, 0, 0, 0, 0, NULL, NULL, 51);
INSERT INTO bib_article_lien_ouvrage (ARO_ID, ARO_ART_ID_Ouvrage, ARO_ART_ID_Composant, ARO_Ordre, ARO_CoefPerte, ARO_Qte, ARO_QteFixe, ARO_IsDesactive) VALUES
 (1, 4, 1, 1, 0, 0.15, 0, 0), (2, 4, 2, 2, 0, 0.5, 0, 0), (3, 4, 5, 3, 0, 1, 0, 0), (4, 4, 2, 4, 0, 9, 0, 1),
 (5, 6, 2, 1, 1.1, 2, 1, 0);
INSERT INTO bib_article_lien_tarif (ARL_ID, ARL_ART_ID, ARL_TypeTarif, ARL_IsRef, ARL_TRS_ID, ARL_REFERENCE, ARL_PrixAchat, ARL_TxRemise,
  ARL_PrixVente, ARL_IsMtFixe, ARL_Conv, ARL_UNT_IDConv, ARL_IsDesactive) VALUES
 (1, 1, 'ACHAT', 1, 12, 'BC25', 100, 10, 120, 0, 0, 0, 0),
 (2, 1, 'ACHAT', 0, 14, 'T-B25', 95, 0.05, 0, 0, 6, 5, 0),
 (3, 2, 'ACHAT', 1, NULL, NULL, 35, 0, 45, 0, 0, 0, 0),
 (4, 4, 'VENTE', 1, NULL, NULL, 0, 0, 41.4, 0, 0, 0, 0),
 (5, 6, 'VENTE', 1, NULL, NULL, 0, 0, 150, 1, 0, 0, 0),
 (6, 1, 'ACHAT', 0, 12, 'ANC', 80, 0, 0, 0, 0, 0, 1);

-- Structure (lot 9) : états (libellés libres), projets, affaires et chantiers des sociétés 1, 2 et 3 (écartée),
-- chantier interne, adresse de chantier, tiers et contacts d'affaire, indices, valeurs, formule de révision.
INSERT INTO z_parametre (PRM_ID, PRM_Code, PRM_Libelle, PRM_TypeParam, PRM_Ordre, PRM_IsDesactive) VALUES
 (960, 'ENC', 'En cours', 'EtatAffaire', 1, 0), (961, 'SOL', 'Soldée', 'EtatAffaire', 2, 0),
 (962, 'ENC', 'En cours', 'EtatChantier', 1, 0), (963, 'TER', 'Terminé', 'EtatChantier', 2, 0),
 (964, 'OBT', 'Obtenu', 'EtatDossier', 1, 0), (965, 'PER', 'Perdu', 'EtatDossier', 2, 0);
INSERT INTO afc_dossier (DOS_ID, DOS_DateAO, DOS_TRS_ID_MOU, DOS_LibelleMOU, DOS_Adr1MOU, DOS_CPMOU, DOS_VilleMOU, DOS_Designation,
  DOS_Observation, DOS_TRS_ID_MOE, DOS_Commune, DOS_Cout, DOS_Etat, DOS_IsDesactive) VALUES
 (1, '2024-03-15', 11, 'IMMO GRAND LYON', '100 cours Lafayette', '69003', 'Lyon', 'Groupe scolaire Jean Moulin', 'Appel d''offres', 14,
  'Villeurbanne', 2500000, 964, 0),
 (2, '2024-04-01', 0, 'Mairie de Bron', NULL, NULL, NULL, 'Gymnase', NULL, 0, NULL, 0, 965, 0),
 (3, '1900-01-01', 0, NULL, NULL, NULL, NULL, 'Dossier désactivé', NULL, 0, NULL, 0, 0, 1);
INSERT INTO afc_affaire (AFF_ID, AFF_SCT_ID, AFF_Code, AFF_Reference, AFF_Libelle, AFF_Etat, AFF_ChargeAff, AFF_IsPublic, AFF_Commentaire,
  AFF_DateSignature, AFF_DateDebutPrev, AFF_DateFinReel, AFF_TRS_ID, AFF_IsDesactive) VALUES
 (1, 1, '24-001', 'Réf. IGL 2024/12', 'Groupe scolaire Jean Moulin', 960, 1, 1, 'Marché à bons de commande', '2024-05-02', '2024-06-01', NULL, 11, 0),
 (2, 2, '23-045', NULL, 'Maison individuelle Dupont', 961, 0, 0, NULL, NULL, '2023-03-01', '2023-12-15', 10, 0),
 (3, 3, '24-900', NULL, 'Affaire de RHONE ENERGIE', 960, 0, 0, NULL, NULL, NULL, NULL, 11, 0);
INSERT INTO afc_chantier (CHT_ID, CHT_SCT_ID, CHT_AFF_ID, CHT_Code, CHT_Libelle, CHT_LibelleEdition, CHT_ETAT, CHT_IsChantier, CHT_Observation,
  CHT_ConducTvx, CHT_TotPVT_Marche, CHT_DateDebPrev, CHT_DateFinPrev, CHT_DateDebutReel, CHT_DateFinReel, CHT_CodeAna, CHT_TRS_ID, CHT_IsDesactive) VALUES
 (1, 1, 1, 'C24-001', 'Groupe scolaire - gros œuvre', 'GS Jean Moulin GO', 962, 1, 'Accès par la rue Racine', 1, 1250000.25,
  '2024-06-01', '2025-08-31', '2024-06-10', NULL, 'AN-LYON', 11, 0),
 (2, 2, 2, 'C23-045', 'Maison Dupont', '', 963, 1, NULL, 2, 185000, '2023-03-01', '2023-12-01', '2023-03-06', '2023-12-15', NULL, 10, 0),
 (3, 1, 0, 'ATELIER', 'Atelier et dépôt', '', 962, 0, NULL, 0, 0, '1900-01-01', NULL, '1900-01-01', NULL, 'AN-LYON', 0, 0),
 (4, 3, 3, 'C24-900', 'Chantier RHONE ENERGIE', '', 962, 1, NULL, 0, 50000, '1900-01-01', NULL, '1900-01-01', NULL, NULL, 11, 0);
INSERT INTO z_adresse (ADR_Id, ADR_Libelle, ADR_TypeEntite, ADR_Entite_Id, ADR_Ligne1, ADR_Ligne2, ADR_CP, ADR_Ville, ADR_Pays, ADR_IsDesactive) VALUES
 (40, 'Chantier', 'CHT', 1, '8 rue Racine', 'Bâtiment B', '69100', 'Villeurbanne', 'France', 0);
INSERT INTO afc_affaire_tiers (AFT_ID, AFT_AFF_ID, AFT_CHT_ID, AFT_TRS_ID, AFT_IsClient, AFT_IsArchi, AFT_IsFournisseur, AFT_IsSTraitant) VALUES
 (1, 1, 0, 11, 1, 0, 0, 0), (2, 1, 1, 14, 0, 0, 0, 1), (3, 1, 0, 12, 0, 0, 1, 0), (4, 3, 0, 11, 1, 0, 0, 0);
INSERT INTO afc_affaire_tiers_personne (AFP_ID, AFP_AFT_ID, AFP_AFF_ID, AFP_PRS_ID, AFP_CHT_ID, AFP_IsPrincipal) VALUES
 (1, 1, 1, 1, 0, 1), (2, 2, 1, 4, 1, 0);
INSERT INTO vte_indice (VID_ID, VID_Reference, VID_Description, VID_IsDesactive) VALUES
 (1, 'BT 01', 'Tous corps d''état', 0), (2, 'ICC', 'Indice du coût de la construction', 0);
INSERT INTO vte_indice_valeur (VIV_ID, VIV_VID_ID, VIV_DateValeur, VIV_Valeur, VIV_IsDesactive) VALUES
 (1, 1, '2024-01-01', 129.7, 0), (2, 1, '2024-02-15', 130.1, 0), (3, 2, '2024-01-01', 2077, 0), (4, 2, '2024-04-01', 0, 1);
INSERT INTO vte_revision_formule (VRF_ID, VRF_Observation, VRF_NbDecimale, VRF_PctFixe, VRF_Pct01, VRF_VID_ID_01, VRF_Pct02, VRF_VID_ID_02,
  VRF_IsDesactive) VALUES (1, 'Révision gros œuvre', 4, 12.5, 62.5, 1, 25, 2, 0);

-- Pièces de vente (lot 10) : devis en deux versions (chrono 5, la seconde acceptée et marché du chantier), facture
-- comptabilisée de l'agence, modèle, société écartée et attachement non repris ; ouvrage au sous-détail (quantité fixe),
-- élément, frais indirects écartés, texte.
INSERT INTO z_parametre (PRM_ID, PRM_Code, PRM_Libelle, PRM_TypeParam, PRM_Ordre, PRM_IsDesactive) VALUES
 (970, 'ACC', 'Accepté', 'EtatDocVte', 1, 0), (971, 'ENC', 'En cours', 'EtatDocVte', 2, 0);
INSERT INTO vte_doc_entete (VDE_ID, VDE_Type_ID, VDE_SCT_ID, VDE_AFF_ID, VDE_CHT_ID, VDE_TRS_ID_Client, VDE_Reference, VDE_Chrono, VDE_Indice,
  VDE_Etat, VDE_DateDoc, VDE_Libelle, VDE_NosRef, VDE_RefExt, VDE_PRM_ModeRegl, VDE_MtHT, VDE_MtTTC, VDE_IsComptabilise, VDE_IsMarche, VDE_IsModele,
  VDE_IsVirtuel, VDE_IsSauvegarde, VDE_IsProjetBudget, VDE_IsDesactive) VALUES
 (1, 700, 1, 1, 1, 11, 'DEV-0005', 5, 1, 971, '2024-04-10', 'Groupe scolaire - estimation', '', NULL, 62, 990, 1188, 0, 0, 0, 0, 0, 0, 0),
 (2, 700, 1, 1, 1, 11, 'DEV-0005-B', 5, 2, 970, '2024-04-20', 'Groupe scolaire - gros œuvre', 'NR-12', 'AO-2024-7', 62, 1026, 1231.2, 0, 1, 0, 0, 0, 0, 0),
 (3, 703, 2, 2, 2, 10, 'FAC-0012', 12, 1, 0, '2023-12-20', 'Maison Dupont - solde', '', NULL, 0, 1000, 1100, 1, 0, 0, 0, 0, 0, 0),
 (4, 700, 1, 0, 0, 11, 'MOD-1', 0, 1, 0, '2024-01-01', 'Modèle', '', NULL, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0),
 (5, 700, 3, 3, 4, 11, 'DEV-0900', 900, 1, 0, '2024-01-01', 'Société écartée', '', NULL, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
 (6, 701, 1, 1, 1, 11, 'ATT-0001', 1, 1, 0, '2024-05-01', 'Attachement', '', NULL, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
INSERT INTO vte_doc_ligne (VDL_ID, VDL_VDE_ID, VDL_VDL_ID, VDL_Ordre, VDL_TypeLigne, VDL_IsVideTexte, VDL_IsSousDetail, VDL_IsFraisIndirect,
  VDL_Code, VDL_Libelle, VDL_UNT_ID, VDL_Qte, VDL_QteFixe, VDL_PAU, VDL_PRU, VDL_PGU, VDL_PctVte, VDL_PVU, VDL_MtHT, VDL_IsMtFixe, VDL_PRM_TVA,
  VDL_FTY_ID, VDL_IsDesactive) VALUES
 (1, 1, 0, 1, 1, 0, 0, 0, 'EST', 'Estimation globale', 6, 1, 0, 900, 900, 0, 0.1, 990, 990, 0, 51, 0, 0),
 (10, 2, 0, 1, 4, 0, 0, 0, '', 'Lot 1 - Gros œuvre', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
 (11, 2, 10, 1, 2, 0, 0, 0, 'DALLE', 'Dalle béton', 2, 20, 0, 0, 0, 0, 0.2, 41.4, 828, 0, 51, 0, 0),
 (12, 2, 11, 1, 1, 0, 1, 0, 'BETON-C25', 'Béton C25', 0, 0.1, 0, 85, 85, 5, 0, 108, 0, 0, 0, 0, 0),
 (13, 2, 11, 2, 1, 0, 1, 0, 'TREILLIS', 'Treillis soudé', 1, 2, 1, 1, 1, 0, 0, 1.2, 0, 0, 0, 0, 0),
 (14, 2, 10, 2, 1, 0, 0, 0, 'MO-MACON', 'Main-d''œuvre maçon', 4, 5, 0, 30, 30, 3, 0.2, 39.6, 198, 0, 51, 0, 0),
 (15, 2, 0, 2, 1, 0, 0, 1, '', 'Frais de chantier', 6, 1, 0, 50, 50, 0, 0, 0, 0, 0, 51, 0, 0),
 (16, 2, 0, 3, 0, 1, 0, 0, '', 'Délai : 3 mois', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
 (30, 3, 0, 1, 1, 0, 0, 0, 'SOLDE', 'Solde des travaux', 6, 1, 0, 1000, 1000, 0, 0, 1000, 1000, 0, 52, 0, 0);

-- Avancement (lot 11) : situation 1 (dalle à 50 %, main-d'œuvre à 100 %) facturée par la facture de situation FS-0001
-- (comptabilisée), situation 2 en cours (dalle à 80 %), situation désactivée écartée.
INSERT INTO vte_situation (VSI_ID, VSI_VSI_ID_Prec, VSI_VDE_ID_Marche, VSI_Numero, VSI_Date, VSI_Libelle, VSI_Reference, VSI_Etat,
  VSI_Pct_Avct, VSI_MtHT, VSI_MtTTC, VSI_IsDesactive, VSI_IsBkp) VALUES
 (1, 0, 2, 1, '2024-06-30', 'Situation n° 1', 'SIT-0001', 970, 59.65, 612, 734.40, 0, 0),
 (2, 1, 2, 2, '2024-07-31', 'Situation n° 2', 'SIT-0002', 971, 83.86, 860.40, 1032.48, 0, 0),
 (3, 0, 2, 9, '2024-07-31', 'Situation abandonnée', 'SIT-0009', 971, 10, 100, 120, 1, 0);
INSERT INTO vte_situation_ligne (VSL_ID, VSL_VSI_ID, VSL_VDL_ID, VSL_Pct_Avct, VSL_Qte_Avct, VSL_MtHT, VSL_PRM_TVA, VSL_IsDesactive) VALUES
 (1, 1, 11, 50, 10, 414, 51, 0), (2, 1, 14, 100, 5, 198, 51, 0), (3, 1, 12, 50, 0.05, 0, 0, 0),
 (4, 2, 11, 80, 16, 662.40, 51, 0), (5, 2, 14, 100, 5, 198, 51, 0);
INSERT INTO vte_doc_entete (VDE_ID, VDE_Type_ID, VDE_SCT_ID, VDE_AFF_ID, VDE_CHT_ID, VDE_TRS_ID_Client, VDE_Reference, VDE_Chrono, VDE_Indice,
  VDE_Etat, VDE_DateDoc, VDE_Libelle, VDE_NosRef, VDE_PRM_ModeRegl, VDE_MtHT, VDE_MtTTC, VDE_IsComptabilise, VDE_IsMarche, VDE_IsModele,
  VDE_IsVirtuel, VDE_IsSauvegarde, VDE_IsProjetBudget, VDE_IsDesactive, VDE_VSI_ID) VALUES
 (7, 702, 1, 1, 1, 11, 'FS-0001', 1, 1, 0, '2024-06-30', 'Situation n° 1', '', 62, 612, 734.40, 1, 0, 0, 0, 0, 0, 0, 1);

-- Achats et sous-traitance (lot 12) : commande, réception partielle, facture ventilée sur deux chantiers, régule négative
-- (avoir), demande d'appro et société écartées, facture d'une situation de sous-traitance (reprise par la situation) ;
-- prestation de sous-traitance (modèle écarté), deux situations, consultation.
INSERT INTO ach_doc_entete (DOE_ID, DOE_DOE_ID_Cde, DOE_DOE_ID_BL, DOE_Type, DOE_CHT_ID, DOE_SCT_ID, DOE_Code, DOE_Date, DOE_PRM_ID_TVA,
  DOE_PAT, DOE_MtTTC, DOE_IsTransfereCompta, DOE_IsBkp, DOE_TPP_Libelle, DOE_NumeroAR) VALUES
 (1, 0, 0, 141, 1, 1, 'CDE-0001', '2024-06-05', 51, 300, 360, 0, 0, 'Aciers et ciment', 'AR-55'),
 (2, 1, 0, 142, 1, 1, 'BL-0001', '2024-06-10', 51, 250, 300, 0, 0, 'Livraison partielle', NULL),
 (3, 1, 2, 382, 1, 1, 'FAC-ACH-1', '2024-06-30', 51, 250, 300, 1, 0, 'Facture Négobat', NULL),
 (4, 0, 0, 454, 1, 1, 'RG-0001', '2024-07-05', 51, -20, -24, 1, 0, 'Régularisation', NULL),
 (5, 0, 0, 316, 1, 1, 'APP-0001', '2024-06-01', 51, 0, 0, 0, 0, 'Appro', NULL),
 (6, 0, 0, 141, 4, 3, 'CDE-0900', '2024-06-01', 51, 10, 12, 0, 0, 'Société écartée', NULL),
 (7, 0, 0, 382, 1, 1, 'FAC-ST-1', '2024-06-30', 53, 2500, 2500, 1, 0, 'Situation terrassement', NULL);
INSERT INTO ach_doc_tiers (DOT_ID, DOT_DOE_ID, DOT_TRS_ID) VALUES (1, 1, 12), (2, 2, 12), (3, 3, 12), (4, 4, 12), (5, 7, 14);
INSERT INTO ach_ligne_achat (LGA_ID, LGA_DOE_ID, LGA_Ordre, LGA_IsTitre, LGA_CodeExt, LGA_LibelleExt, LGA_UNT_ID, LGA_Qte, LGA_PAU, LGA_TxRemise,
  LGA_QteLivre, LGA_IsDesactive) VALUES
 (1, 1, 1, 0, 'CIM', 'Ciment', 1, 20, 10, 0, 20, 0),
 (2, 1, 2, 0, 'ACIER', 'Acier HA', 1, 10, 10, 0, 5, 0),
 (3, 1, 3, 0, 'OLD', 'Ligne supprimée', 1, 1, 99, 0, 0, 1);
INSERT INTO ach_doc_lien_ligne_achat (DOL_ID, DOL_DOE_ID, DOL_LGA_ID, DOL_IsDesactive) VALUES (1, 2, 1, 0), (2, 2, 2, 0);
INSERT INTO ach_export_facture_entete (FAC_ID, FAC_DOE_ID, FAC_PSS_ID, FAC_Code, FAC_Date, FAC_Libelle, FAC_IsTransfere, FAC_TRS_ID_Payeur,
  FAC_ModeRegl, FAC_MontantHT, FAC_MontantTTC, FAC_IsDesactive) VALUES
 (1, 3, 0, 'FN-2024-001', '2024-06-30', 'Facture Négobat juin', 1, 12, 0, 250, 300, 0),
 (2, 4, 0, 'FN-2024-RG1', '2024-07-05', 'Régule prix acier', 1, 12, 0, -20, -24, 0),
 (3, 7, 1, 'T69-2024-01', '2024-06-30', 'Situation 1 terrassement', 1, 14, 0, 2500, 2500, 0);
INSERT INTO ach_export_facture_ligne (FAL_ID, FAL_FAC_ID, FAL_Ordre, FAL_CHT_ID, FAL_IsTitre, FAL_Code, FAL_Libelle, FAL_UNT_ID, FAL_Qte, FAL_PAU,
  FAL_PAT, FAL_TVA, FAL_IsDesactive) VALUES
 (1, 1, 1, 1, 0, 'CIM', 'Ciment', 1, 20, 10, 200, 51, 0),
 (2, 1, 2, 3, 0, 'ACIER', 'Acier HA', 1, 5, 10, 50, 51, 0),
 (3, 2, 1, 1, 0, '', 'Régularisation prix acier', 1, 1, -20, -20, 51, 0),
 (4, 3, 1, 1, 0, '', 'Situation 1', 1, 1, 2500, 2500, 53, 0);
INSERT INTO afc_prestation_st (PST_ID, PST_AFF_ID, PST_SCT_ID, PST_CHT_ID, PST_TRS_ID, PST_IsModele, PST_Code, PST_Libelle, PST_DateCreat,
  PST_DateMarcheST, PST_TotPAT, PST_PRM_ID_TVA, PST_IsPaieDirect, PST_RefDevisST, PST_IsDesactive) VALUES
 (1, 1, 1, 1, 14, 0, 'ST-24-001', 'Terrassement', '2024-05-02', '2024-05-20', 5000, 53, 1, 'DV-T69-12', 0),
 (2, 1, 1, 1, 14, 1, 'ST-MODELE', 'Modèle', '2024-01-01', '1900-01-01', 0, 53, 0, NULL, 0);
INSERT INTO afc_prestation_st_ligne (PSL_ID, PSL_PST_ID, PSL_PSL_ID, PSL_Ordre, PSL_TypeLigne, PSL_IsSousDetail, PSL_Code, PSL_Libelle, PSL_UNT_ID,
  PSL_Qte, PSL_PAU, PSL_PAT, PSL_IsDesactive) VALUES
 (1, 1, 0, 1, 4, 0, '', 'Lot terrassement', 0, 0, 0, 0, 0),
 (2, 1, 1, 1, 1, 0, 'DECAP', 'Décapage', 2, 100, 20, 2000, 0),
 (3, 1, 1, 2, 1, 0, 'FOUIL', 'Fouilles', 2, 50, 60, 3000, 0);
INSERT INTO afc_prestation_st_situation (PSS_ID, PSS_PST_ID, PSS_PSS_ID_Prec, PSS_Numero, PSS_Date, PSS_Libelle, PSS_Reference, PSS_IsValid,
  PSS_Pct_Avct, PSS_MtHT, PSS_IsDesactive) VALUES
 (1, 1, 0, 1, '2024-06-30', 'Situation 1', 'ST-SIT-1', 1, 50, 2500, 0),
 (2, 1, 1, 2, '2024-07-31', 'Situation 2', 'ST-SIT-2', 0, 80, 4000, 0);
INSERT INTO afc_prestation_st_situation_ligne (PSI_ID, PSI_PSS_ID, PSI_PSL_ID, PSI_Pct_Avct, PSI_Qte_Avct, PSI_MtHT_Avct, PSI_IsDesactive) VALUES
 (1, 1, 2, 50, 50, 1000, 0), (2, 1, 3, 50, 25, 1500, 0), (3, 2, 2, 100, 100, 2000, 0), (4, 2, 3, 66.67, 33.33, 2000, 0);
INSERT INTO afc_prestation_st_consultation (PSC_ID, PSC_PST_ID, PSC_TRS_ID, PSC_DateConsultation, PSC_Ordre, PSC_RefOffre, PSC_MtHTOffre, PSC_IsDesactive) VALUES
 (1, 1, 14, '2024-05-01', 1, 'OFF-77', 5200, 0);

-- Règlements (lot 13) : échéances polymorphes (VDE facture 3, VSI situation 1 → facture 7 avec son échéance de retenue,
-- FAC facture d'achat 1 soldée, ligne de groupement écartée) ; retenue et caution ; remise de deux règlements de
-- tiers différents (un règlement par tiers) et règlement sans échéance (réparti) ; régule d'achat sans échéance (ouverte).
INSERT INTO vac_doc_echeance_reglement (VER_ID, VER_TypeEntite, VER_Entite_ID, VER_IsGroupement, VER_VRG_ID, VER_ModeRegl, VER_DateEch, VER_Montant,
  VER_IsSolde, VER_RefPiece, VER_MQuand, VER_IsDesactive) VALUES
 (1, 'VDE', 3, 0, 0, 62, '2024-01-20', 1100, 1, NULL, NULL, 0),
 (2, 'VSI', 1, 0, 0, 62, '2024-07-31', 697.68, 0, NULL, NULL, 0),
 (3, 'VSI', 1, 0, 1, 62, '2025-06-30', 36.72, 0, NULL, NULL, 0),
 (4, 'FAC', 1, 0, 0, 62, '2024-07-31', 300, 1, 'FN-2024-001', '2024-07-25', 0),
 (5, 'VDE', 3, 1, 0, 62, '2024-01-20', 1100, 0, NULL, NULL, 0);
INSERT INTO vac_doc_retenue_caution (VRG_ID, VRG_TypeEntite, VRG_Entite_ID, VRG_Libelle, VRG_Pct, VRG_MontantTotalRG, VRG_MontantCaution, VRG_NbMois,
  VRG_DateRG, VRG_IsCaution, VRG_Banque, VRG_NumActe, VRG_IsDesactive) VALUES
 (1, 'VSI', 1, 'Retenue 5 %', 5, 36.72, 0, 0, '2024-06-30', 0, NULL, NULL, 0),
 (2, 'VDE', 7, 'Caution bancaire', 5, 0, 36.72, 12, '2024-06-30', 1, 'BNP Paribas', 'CA-2024-1', 0);
INSERT INTO vac_reglement_lot (VEL_ID, VEL_Date, VEL_Montant, VEL_ModeRegl, VEL_Commentaire, VEL_TropPercu, VEL_IsDesactive) VALUES
 (1, '2024-02-15', 1300, 62, 'Remise 15/02', 0, 0);
INSERT INTO vac_reglement_facture_vte (VRV_ID, VRV_VDE_ID, VRV_VER_ID, VRV_VEL_ID, VRV_ModeRegl, VRV_Date, VRV_Montant, VRV_Libelle, VRV_IsDesactive) VALUES
 (1, 3, 1, 1, 62, '2024-02-15', 800, 'Chèque 1', 0),
 (2, 7, 2, 1, 62, '2024-08-15', 500, 'Chèque 2', 0),
 (3, 3, 0, 0, 62, '2024-03-01', 300, 'Virement solde', 0);

-- Exploitation (lot 14) : rapports journaliers (heures et heures supplémentaires, horaires, déplacements en zone et
-- grand déplacement, panier, option), absences consécutives regroupées, ligne désactivée ; planning (tâche du chantier
-- avec salarié, matériel et article non repris, absence écartée, tâche à venir sans affectation détaillée).
INSERT INTO svhz_absence (ABS_ID, ABS_Code, ABS_Libelle) VALUES (1, 'CP', 'Congés payés'), (2, 'ENFMAL', 'Enfant malade');
INSERT INTO svhz_deplacement (DPL_ID, DPL_CODE) VALUES (1, 'Z2'), (2, 'GDEP');
INSERT INTO svhz_repas (RPS_ID, RPS_Code, RPS_Libelle) VALUES (1, 'PAN', 'Panier');
INSERT INTO svh_rapport_journalier (RJR_ID, RJR_SLR_ID, RJR_FTY_ID, RJR_CHT_ID, RJR_ABS_ID, RJR_Date, RJR_BoolAbsent, RJR_Heure, RJR_HeureSup1,
  RJR_HoraireDeb1, RJR_HoraireFin1, RJR_Taux, RJR_NbDepl, RJR_DPL_ID, RJR_NbRepas, RJR_RPS_ID, RJR_Opt1Texte, RJR_Commentaire, RJR_IsDesactive) VALUES
 (1, 1, 2, 1, 0, '2024-06-10', 0, 7, 1, '08:00:00', '16:00:00', 30, 1, 1, 1, 1, 'Outillage perso', NULL, 0),
 (2, 1, 2, 1, 0, '2024-06-11', 0, 8, 0, NULL, NULL, 30, 1, 2, 0, 0, NULL, 'Coulage dalle', 0),
 (3, 2, 0, 3, 0, '2024-06-10', 0, 7.5, 0, NULL, NULL, 0, 0, 0, 0, 0, NULL, NULL, 0),
 (4, 2, 0, 0, 1, '2024-06-11', 1, 7, 0, NULL, NULL, 0, 0, 0, 0, 0, NULL, NULL, 0),
 (5, 2, 0, 0, 1, '2024-06-12', 1, 7, 0, NULL, NULL, 0, 0, 0, 0, 0, NULL, NULL, 0),
 (6, 2, 0, 0, 2, '2024-06-14', 1, 7, 0, NULL, NULL, 0, 0, 0, 0, 0, NULL, NULL, 0),
 (7, 1, 2, 1, 0, '2024-07-01', 0, 8, 0, NULL, NULL, 30, 0, 0, 0, 0, NULL, NULL, 1);
INSERT INTO pln_planification (PLA_ID, PLA_CHT_ID, PLA_ABS_ID, PLA_SLR_ID, PLA_DateDebut, PLA_DateFin, PLA_Libelle, PLA_IsDesactive) VALUES
 (1, 1, 0, 0, '2024-06-10', '2024-06-14', 'Coffrage voiles', 0),
 (2, 0, 1, 2, '2024-06-11', '2024-06-12', 'Congés', 0),
 (3, 2, 0, 2, '2026-12-01', '2026-12-03', 'Reprise d''enduit', 0);
INSERT INTO pln_affectation (PLF_ID, PLF_PLA_ID, PLF_TypeEntite, PLF_EntiteId, PLF_DureePrev, PLF_IsDesactive) VALUES
 (1, 1, 'SAL', 1, 32, 0), (2, 1, 'MAT', 1, 16, 0), (3, 1, 'ART', 5, 4, 0);

-- Lot 14, stock : stock de l'atelier (chantier 3) et sans lieu (dépôt par défaut), ligne désactivée ; consommations
-- hors pièce (RCS_DOE_ID : liée à une pièce, écartée ; sans article : signalée).
INSERT INTO bib_article_stock (ARS_ID, ARS_ART_ID, ARS_AchatStockAtelier, ARS_QteStock, ARS_IsDesactive) VALUES
 (1, 1, 3, 12.5, 0), (2, 1, 0, 4, 0), (3, 1, 1, 9, 1);
INSERT INTO svc_rapport_conso (RCS_ID, RCS_ART_ID, RCS_CHT_ID, RCS_DOE_ID, RCS_MateriauLib, RCS_Date, RCS_QUANTITE, RCS_PrixUnitaire, RCS_Montant) VALUES
 (1, 1, 1, NULL, 'Béton de propreté', '2024-06-12', 3, 95, 285),
 (2, 1, 1, 5, NULL, '2024-06-13', 8, 95, 760),
 (3, NULL, 1, NULL, 'Location benne', '2024-06-14', 1, 150, 150);
