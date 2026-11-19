-- Jeu de données réduit de la base source MDE de test (fictif). Chargé après schema.sql par tests/reprise/monter.sh.
-- Jeu de base du lot 0 : société, référentiels, annuaire ; chaque lot de domaine complète ce fichier.
-- Cas couverts : client particulier, client société avec payeur, client aussi fournisseur (même SIRET : doublon à
-- fusionner), plusieurs adresses par tiers et plusieurs contacts par adresse, zone supplémentaire RTCFIELD1.
SET NOCOUNT ON;
GO

-- Société
INSERT INTO dbo.SYS_DEFSTE (DOSSIER, NOM, ADRESSE, CODEPOSTAL, VILLE, SIRET, TELEPHONE, EMAIL, APE, NINTRACOMMUNAUTAIRE,
  FORMEJURIDIQUE, CAPITALSOCIAL, NBREDEC, DEVISEPIVOT, JOURNALVENTE, JOURNALACHAT, NUMDEVCLI, NUMFACCLI, NUMCDEFOU,
  NUMSITTX, DECIMALEQTE, DECIMALEPU, DECIMALETOT, DECIMALETPS)
VALUES ('DEV', 'BATI TEST', '12 rue des Artisans', '69003', 'LYON', '12345678900017', '0478000000', 'contact@bati-test.fr',
  '4120A', 'FR12123456789', 'SARL', '10000', 2, 'E', 'VT', 'HA', 'D000124', 'F000057', 'C000033', 'S000012', 2, 2, 2, 2);
GO

-- Référentiels
-- Devises : MDE code souvent l'euro « E » (reconnu d'office) ; « EU » est l'euro par son code ISO (Q10).
INSERT INTO dbo.APIDEVISEE (CODE, NOM, SYMBOLE, VALEURO, CODEISO) VALUES ('EU', 'Euro', NULL, 1, 'EUR');
GO
INSERT INTO dbo.PMEUNITEMESURE (UNITE, NBDEC) VALUES ('U', 0), ('M2', 2), ('ML', 2), ('H', 2), ('ENS', 0), ('KG', 3), ('BAR', 0);
INSERT INTO dbo.CATEGORIEACHATVENTE (CODE, LIBELLE, TYPE, JOURNALVENTE, JOURNALACHAT)
VALUES ('F', 'France', 'N', 'VT', 'HA'), ('A', 'Autoliquidation', 'A', 'VT', 'HA');
INSERT INTO dbo.TVA (CODECATEGORIE, CODE, TAUX, COMPTEV, COMPTEA, LIBELLE, DEFAUT) VALUES
 ('F', '1', 20.00, '44571200', '44566200', 'TVA 20 %', 1),
 ('F', '2', 10.00, '44571100', '44566100', 'TVA 10 %', 0),
 ('F', '3', 5.50, '44571055', '44566055', 'TVA 5,5 %', 0),
 ('A', '9', 0.00, '44571900', '44566900', 'Autoliquidation', 0);
INSERT INTO dbo.PMETVA (CODECATEGORIE, CODE, TAUX, COMPTEV, COMPTEA, LIBELLE, DEFAUT) VALUES
 ('F', '1', 20.00, '44571200', '44566200', 'TVA 20 %', 1),
 ('F', '2', 10.00, '44571100', '44566100', 'TVA 10 %', 0);
INSERT INTO dbo.APIMODEREGLEMENT (CODE, NOM) VALUES ('CHQ', 'Chèque'), ('VIR', 'Virement'), ('V30', 'Virement 30 jours fin de mois'), ('3X', 'Trois fois'),
 ('L10', 'LCR 30 jours le 10'), ('FM15', 'Virement 30 j FM le 15');
-- POUR : pourcentage ; NJ : nombre de jours ; JOUR : jour du mois (0 : aucun) ; TYPEP : C comptant, N net (le JOUR s'il est
-- donné), F fin de mois, M fin de mois le JOUR ; MODEP : mode de paiement (PMEMODEPAIEMENT.CLE).
INSERT INTO dbo.PMEMODEPAIEMENT (CLE, NUMORDRE, LIBELLE, ACTIF) VALUES (1, 1, 'Chèque', 1), (2, 2, 'Virement', 1), (3, 3, 'Lettre de change', 1);
INSERT INTO dbo.APIMODEREGLEMENTL (CODE, LIG, POUR, JOUR, NJ, MODEP, TYPEP, MOISENTIER) VALUES
 ('CHQ', 1, 100, 0, 0, 1, 'C', 0),
 ('VIR', 1, 100, 0, 0, 2, 'N', 0),
 ('V30', 1, 100, 0, 30, 2, 'F', 1),
 ('3X', 1, 40, 0, 0, 1, 'C', 0),
 ('3X', 2, 30, 0, 30, 1, 'N', 0),
 ('3X', 3, 30, 0, 60, 1, 'N', 0),
 ('L10', 1, 100, 10, 30, 3, 'N', 0),
 ('FM15', 1, 100, 15, 30, 2, 'M', 0);
INSERT INTO dbo.APIPAYS (CODE, NOM, CODEDEVISE) VALUES ('FR', 'France', 'EUR'), ('BE', 'Belgique', 'EUR');
INSERT INTO dbo.APICIVILITE (LIBELLE, FORMEJURIDIQUE) VALUES ('Monsieur', 0), ('Madame', 0), ('SARL', 1), ('SCI', 1);
INSERT INTO dbo.CMP_PLANCP (COMPTE, NOM, FAMILLE) VALUES
 ('411000', 'Clients', 4), ('401000', 'Fournisseurs', 4), ('401100', 'Sous-traitants', 4),
 ('704000', 'Travaux', 7), ('604000', 'Achats de prestations', 6), ('601000', 'Achats de matériaux', 6);
-- Paramètres comptables (lot 4) : journaux, collectifs, exigibilité ; analytique (Q11, gardé dans le paramétrage).
INSERT INTO dbo.CMP_PARAMGEN (JOURNVENCODE, JOURNACHCODE, CPTCOLCLI, CPTCOLFRS, CPTCOLSST, EXIGIBILITETVA)
VALUES ('VE', 'AC', '411000', '401000', '401100', 'E');
INSERT INTO dbo.CMP_AXEANALYTIQUE (CODE, LIBELLE, ACTIF, AXEDEFAUT) VALUES (1, 'Chantiers', 1, 1);
INSERT INTO dbo.CMP_POSTEANA (AXE, CODE, LIBELLE) VALUES (1, 'CH01', 'Chantier Martin'), (1, 'FG', 'Frais généraux');
INSERT INTO dbo.CMP_GRILLEANA (CODE, AXE, POSTE, PCT, NUMGRILLEANA) VALUES (1, 1, 'CH01', 70, 1), (1, 1, 'FG', 30, 2);
INSERT INTO dbo.PMEACTIVITE (CLE, TYPETIERS, NUMORDRE, LIBELLE, DEFAUT, ACTIF) VALUES (1, 'C', 1, 'Particulier', 1, 1), (2, 'C', 2, 'Promoteur', 0, 1);
GO

-- Zones supplémentaires des fiches (Q12)
INSERT INTO dbo.SYS_RTCINFOS (TABLENAME, FIELDNAME, DISPLAYNAME, FIELDTYPE, FIELDSIZE, DATATYPE, REQUIRED) VALUES
 ('PMECLIENT', 'RTCFIELD1', 'Zone Sup 01', 'E', 50, 'S', 0),
 ('PMEFOURNISSEUR', 'RTCFIELD1', 'Code fournisseur groupe', 'E', 20, 'S', 0);
GO

-- Annuaire : rôles (le code de gestion relie le rôle à COMM_TIERS ; TYPETIERS donne le rôle, eTypeTiers)
INSERT INTO dbo.PMECLIENT (CODE, TYPETIERS, CLEACTIVITE, CODECATEGORIE, SIRET, TPAYEURCODE, TPAYEURTYPE, NOTE, RTCFIELD1) VALUES
 ('C001', 'C', 1, 'F', NULL, NULL, NULL, 'Client fidèle', 'VIP'),
 ('C002', 'C', 2, 'F', '44455566600012', 'C003', 'F', NULL, NULL),
 ('C003', 'C', 2, 'F', '77788899900015', NULL, NULL, NULL, NULL);
INSERT INTO dbo.PMEFOURNISSEUR (CODE, TYPETIERS, CODECATEGORIE, SIRET, RTCFIELD1) VALUES
 ('F001', 'F', 'F', '77788899900015', 'GRP-12'),
 ('F002', 'F', 'F', '22233344400019', NULL);
INSERT INTO dbo.PMESOUSTRAITANT (CODE, TYPETIERS, CODECATEGORIE, SIRET) VALUES ('S001', 'S', 'A', '55566677700011');
-- A002 : architecte sans fiche COMM_TIERS ni TYPETIERS (seulement sa fiche PMEARCHITECTE).
INSERT INTO dbo.PMEARCHITECTE (CODE, TYPETIERS, NOTE) VALUES ('A001', 'A', NULL), ('A002', '', 'Cabinet sans fiche tiers');
INSERT INTO dbo.PMECHARGEAFFAIRE (CODE, TYPETIERS) VALUES ('G001', 'G');
GO

-- Annuaire : identité, adresses (COMM_TIERSADR.CODE → COMM_TIERS.CODE) et contacts (IDADR → adresse)
INSERT INTO dbo.COMM_TIERS (CODE, COMPTE, COMPTETIERS, CODEGESTION, TYPETIERS, NII, DEVISE, MODEREG, EXCLURERELANCE,
  ENCOURSAUTORISE, SITEINTERNET, IDADRFACTURATION, IDADRLIVRAISON, DATECREATION, DATEMODIFICATION) VALUES
 (1, '411000', 'CMARTIN', 'C001', 'C', NULL, 'EUR', 'CHQ', 0, 0, NULL, 11, 12, '2019-03-01', '2024-05-10'),
 (2, '411000', 'CTILLEULS', 'C002', 'C', 'FR44444555666', 'E', 'V30', 1, 50000, NULL, 21, 0, '2020-01-15', '2020-01-15'),
 (3, '411000', 'CMATBAT', 'C003', 'C', 'FR77777888999', 'EU', 'V30', 0, 20000, 'www.matbat.fr', 31, 0, '2018-06-01', '2023-02-01'),
 (4, '401000', 'FMATBAT', 'F001', 'F', 'FR77777888999', 'EUR', 'V30', 0, 0, 'www.matbat.fr', 41, 0, '2018-06-01', '2023-02-01'),
 (5, '401000', 'FBOIS', 'F002', 'F', NULL, 'EUR', 'VIR', 0, 0, NULL, 51, 0, '2021-09-09', '2021-09-09'),
 (6, '401100', 'SELEC', 'S001', 'S', NULL, 'EUR', 'VIR', 0, 0, NULL, 61, 0, '2022-02-02', '2022-02-02'),
 (7, NULL, NULL, 'A001', 'A', NULL, 'EUR', NULL, 0, 0, NULL, 71, 0, '2017-01-01', '2017-01-01'),
 (8, NULL, NULL, 'G001', 'G', NULL, 'EUR', NULL, 0, 0, NULL, 81, 0, '2017-01-01', '2017-01-01');
INSERT INTO dbo.COMM_TIERSADR (IDENTIFIANT, CODE, NOM, CIVILITE, IDINTERLOC, ADR, CP, VILLE, PAYS) VALUES
 (11, 1, 'MARTIN Paul', 'Monsieur', 101, '3 chemin des Vignes', '69110', 'SAINTE-FOY-LES-LYON', 'FR'),
 (12, 1, 'MARTIN Paul (résidence secondaire)', 'Monsieur', 0, '1 route du Lac', '74000', 'ANNECY', 'FR'),
 (21, 2, 'SCI LES TILLEULS', 'SCI', 201, '45 avenue Foch' + CHAR(13) + CHAR(10) + 'Bâtiment B', '69006', 'LYON', 'FR'),
 (31, 3, 'MATBAT', 'SARL', 301, 'ZI Nord', '69120', 'VAULX-EN-VELIN', 'FR'),
 (41, 4, 'MATBAT', 'SARL', 401, 'ZI Nord', '69120', 'VAULX-EN-VELIN', 'FR'),
 (42, 4, 'MATBAT agence de Villeurbanne', 'SARL', 402, '8 rue Léon Blum', '69100', 'VILLEURBANNE', 'FR'),
 (51, 5, 'BOIS ET SCIAGE', NULL, 0, 'Le Bourg', '42000', 'SAINT-ETIENNE', 'FR'),
 (61, 6, 'ELEC PLUS', 'SARL', 601, '2 rue Volta', '69007', 'LYON', 'FR'),
 (71, 7, 'ATELIER D''ARCHITECTURE DURAND', NULL, 701, '10 quai Saint-Antoine', '69002', 'LYON', 'FR'),
 (81, 8, 'BERNARD Luc', 'Monsieur', 0, NULL, NULL, NULL, 'FR');
INSERT INTO dbo.COMM_TIERSINTERLOC (IDENTIFIANT, IDADR, NOM, TEL, FAX, PORTABLE, EMAIL, QUALIFICATION) VALUES
 (101, 11, 'Paul MARTIN', '0478111111', NULL, '0611111111', 'paul.martin@exemple.fr', NULL),
 (102, 11, 'Julie MARTIN', NULL, NULL, '0622222222', NULL, 'Conjointe'),
 (201, 21, 'M. GERANT', '0478222222', NULL, NULL, 'gerance@tilleuls.fr', 'Gérant'),
 (202, 21, 'Mme COMPTA', '0478222223', NULL, NULL, 'compta@tilleuls.fr', 'Comptable'),
 (301, 31, 'Service clients', '0478333333', '0478333334', NULL, 'ventes@matbat.fr', NULL),
 (401, 41, 'Service achats', '0478333333', NULL, NULL, 'achats@matbat.fr', NULL),
 (402, 42, 'Agence Villeurbanne', '0478444444', NULL, NULL, 'villeurbanne@matbat.fr', 'Agence'),
 (601, 61, 'Marc VOLTA', NULL, NULL, '0633333333', 'marc@elecplus.fr', 'Gérant'),
 (701, 71, 'Claire DURAND', '0478555555', NULL, NULL, 'claire@durand-archi.fr', 'Architecte DPLG');
GO

-- Ressources (lot 7) : salariés (PMESALARIE ⋈ COMM_EMPLOYE par CODEGESTION), dont le chargé d'affaires G001 (BERNARD
-- Luc, relié à son salarié), un CDD, un intérimaire et un sorti ; adresse d'un salarié par sa fiche COMM_TIERS de type E ;
-- équipe ; types de matériel et matériels (suivi kilométrique, hors service).
INSERT INTO dbo.COMM_EMPLOYE (CODE, CODEGESTION, CIVILITE, PRENOM, NOM, MATRICULE, DATENAISSANCE, INSEE, NOMURGENCE, TELURGENCE,
  HEUNORM, SALBASE, TAUXHORAIRE, DATEENTREE, DATEDEPART, CATEGORIE, EMPLOI, QUALIF, TYPECONTRAT, NOTE) VALUES
 (1, 'SAL01', 'M', 'Luc', 'BERNARD', 'P0001', '1975-04-12', '175046912345678', 'Anne BERNARD', '0699999999',
  151.67, 4200, 0, '2010-01-04', NULL, 'Cadre', 'Conducteur de travaux', 'Position B', 'CDI', NULL),
 (2, 'SAL02', 'M', 'Ahmed', 'KACI', 'P0002', NULL, NULL, NULL, NULL, 151.67, 2300, 15.2, '2024-03-01', NULL, 'Ouvrier', 'Maçon',
  'N3P2', 'Contrat à durée déterminée', 'Permis B'),
 (3, 'SAL03', 'M', 'Tom', 'PETIT', NULL, NULL, NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 'Ouvrier', 'Manœuvre', NULL, 'Intérim', NULL),
 (4, 'SAL04', 'M', 'René', 'VIEUX', 'P0004', NULL, NULL, NULL, NULL, 151.67, 2100, 0, '1990-09-01', '2023-12-31', 'Ouvrier',
  'Coffreur', NULL, 'CDI', NULL);
INSERT INTO dbo.PMESALARIE (CODE, TYPETIERS, COUTH, CLEEQUIPE, INACTIF, INTERIMAIRE, RTCFIELD1) VALUES
 ('SAL01', 'E', 48.5, 0, 0, 0, NULL), ('SAL02', 'E', 0, 1, 0, 0, NULL), ('SAL03', 'E', 22, 0, 0, 1, NULL), ('SAL04', 'E', 0, 0, 1, 0, NULL);
INSERT INTO dbo.COMM_TIERS (CODE, COMPTE, COMPTETIERS, CODEGESTION, TYPETIERS, NII, DEVISE, MODEREG, EXCLURERELANCE,
  ENCOURSAUTORISE, SITEINTERNET, IDADRFACTURATION, IDADRLIVRAISON, DATECREATION, DATEMODIFICATION) VALUES
 (9, NULL, NULL, 'SAL02', 'E', NULL, 'EUR', NULL, 0, 0, NULL, 91, 0, '2024-03-01', '2024-03-01');
INSERT INTO dbo.COMM_TIERSADR (IDENTIFIANT, CODE, NOM, CIVILITE, IDINTERLOC, ADR, CP, VILLE, PAYS) VALUES
 (91, 9, 'KACI Ahmed', 'Monsieur', 901, '3 rue des Acacias', '69200', 'VENISSIEUX', 'FR');
INSERT INTO dbo.COMM_TIERSINTERLOC (IDENTIFIANT, IDADR, NOM, TEL, FAX, PORTABLE, EMAIL, QUALIFICATION) VALUES
 (901, 91, 'KACI Ahmed', NULL, NULL, '0612121212', 'a.kaci@exemple.fr', NULL);
INSERT INTO dbo.PMEEQUIPE (CODE, LIBELLE, CLEEQUIPE, INACTIF, NOTE) VALUES ('EQ1', 'Équipe maçonnerie', 1, 0, NULL);
INSERT INTO dbo.PMESALARIEEQUIPE (CLEEQUIPE, NUMORDRE, CODESAL) VALUES (1, 1, 'SAL03'), (1, 2, 'SAL02');
INSERT INTO dbo.PMETYPEMATERIEL (CLE, NUMORDRE, LIBELLE, VEHICULE, ENTRETIEN, LOCATION, DEFAUT, ACTIF) VALUES
 (1, 1, 'Mini-pelle', 0, 1, 0, 1, 1), (2, 2, 'Camion benne', 1, 1, 0, 0, 1);
INSERT INTO dbo.PMEMATERIEL (CODE, TYPEMAT, LIBELLE, MARQUE, MODELE, SUIVIKM, KMCOMPTEUR, HORSSERVICE, NOTE, RTCFIELD1) VALUES
 ('MP-001', 1, 'Mini-pelle Kubota', 'Kubota', 'KX019', 0, 0, 0, NULL, NULL),
 ('CAMION-BENNE-02', 2, 'Camion benne 19 t', 'Renault', 'D19', 1, 125000, 0, 'Benne basculante', NULL),
 ('VIEUX', 2, 'Ancien camion', 'Berliet', NULL, 1, 480000, 1, NULL, NULL);
INSERT INTO dbo.SYS_RTCINFOS (TABLENAME, FIELDNAME, DISPLAYNAME, FIELDTYPE, FIELDSIZE, DATATYPE, REQUIRED) VALUES
 ('PMEMATERIEL', 'RTCFIELD1', 'Numéro de parc', 'E', 20, 'S', 0);
UPDATE dbo.PMEMATERIEL SET RTCFIELD1 = 'P-07' WHERE CODE = 'MP-001';
GO

-- Bibliothèque (lot 8) : natures (une sans regroupement connu), deux bibliothèques (code « E-1 » renommé), familles,
-- articles (MO, ciment géré en stock avec perte, unités d'achat et de vente, deux tarifs fournisseurs), texte, article
-- en sommeil, ouvrage dont le PV est retrouvé en mode déboursé (composante en sommeil sans lien), ouvrage qui contient
-- un ouvrage et dont le PV source est imposé.
INSERT INTO dbo.PMENATUREELEMENT (CLE, TYPEELEM, NUMORDRE, ABREVIATION, LIBELLE, COEFFG, COEFBEN, COEFVTE, DEFAUT, ACTIF) VALUES
 (1, 'M', 1, 'MO', 'Main-d''œuvre', 1.2, 1.1, 0, 1, 1),
 (2, 'F', 2, 'MAT', 'Matériaux', 1.1, 1.2, 0, 0, 1),
 (3, 'S', 3, 'STR', 'Sous-traitance', 1, 1.1, 0, 0, 1),
 (4, 'OT', 4, 'OUV', 'Ouvrages', 1, 1, 0, 0, 1),
 (5, 'ZZ', 5, 'DSP', 'Divers spéciaux', 1, 1, 0, 0, 1);
INSERT INTO dbo.PMEBIBLIO (CODE, LIBELLE) VALUES ('GEN', 'Bibliothèque générale'), ('E-1', 'Éditeur');
INSERT INTO dbo.PMEFAMILLE (CODE, CODEBIBLIO, LIBELLE, NIVEAU, CODEPARENT) VALUES
 ('MACO', 'GEN', 'Maçonnerie', 0, NULL), ('LIANT', 'GEN', 'Liants', 1, 'MACO');
INSERT INTO dbo.PMEELEMENT (CODE, CODEBIBLIO, REFERENCE, TYPEELEM, CLENATURE, LIBELLE, LIBELLECOM, LIBELLETEC, CODEFAMILLE,
  CODEFOURPRINC, PA, COEFPERTE, DEBOURSE, COEFFG, PR, COEFBEN, PV, OPTIONPVIMPOSE, UNITEACHAT, UNITEVENTE, UNITESTOCK,
  RATIOSTOCK, RATIOVENTE, CATEGORIE, TVA, COMPTEVENTE, GESTSTOCK, CODEBARRE, SOMMEIL) VALUES
 ('MOMAC', 'GEN', '', 'M', 1, 'Heure de maçon', '', NULL, 'MACO', NULL, 30, 0, 30, 1.2, 36, 1.1, 39.6, 0, NULL, NULL, 'H',
  NULL, NULL, 'F', '1', '704000', 0, NULL, 0),
 ('CIM35', 'GEN', 'CIM-REF', 'F', 2, 'Ciment CEM II', '{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fnil Arial;}}\pard\b Ciment\b0  CEM II \''e0 la palette\par}',
  'Sac de 35 kg', 'LIANT', 'F001', 0.2, 1.05, 0.21, 1.1, 0.231, 1.2, 0.2772, 0, 'U', 'KG', 'KG', 35, 1, 'F', '1', '704000', 1, '3700000000017', 0),
 ('TXT1', 'GEN', '', 'TX', 0, 'Garantie', '{\rtf1\ansi Garantie d\''e9cennale\par Assurance \u339?uvre\par}', NULL, NULL, NULL,
  0, 0, 0, 0, 0, 0, 0, 0, NULL, NULL, NULL, NULL, NULL, '', NULL, NULL, 0, NULL, 0),
 ('VIEUX', 'GEN', '', 'F', 2, 'Ancien article', '', NULL, NULL, NULL, 2, 0, 2, 1, 2, 1, 2, 0, NULL, NULL, 'U', NULL, NULL, 'F', '1', NULL,
  0, NULL, 1),
 ('CHA-C100X4', 'GEN', '', 'F', 2, 'Cornière 100x4', '', NULL, NULL, NULL, 8.10, 0, 8.10, 1, 8.10, 1, 1.00, 0, 'ML', 'KG', 'BAR',
  0.082645, 141.57, 'F', '1', NULL, 0, NULL, 0),
 ('ART1', 'E-1', '', 'F', 2, 'Article éditeur', '', NULL, NULL, NULL, 5, 0, 5, 1, 5, 1, 5, 0, NULL, NULL, 'U', NULL, NULL, 'F', '2', NULL,
  0, NULL, 0),
 ('MUR20', 'GEN', '', 'OT', 4, 'Mur parpaing 20', '', NULL, 'MACO', NULL, 0, 0, 21.2, 1.15, 24.38, 1.25, 30.475, 0, NULL, NULL, 'M2',
  NULL, NULL, 'F', '1', NULL, 0, NULL, 0),
 ('AMUR', 'GEN', '', 'OU', 4, 'Mur enduit', '', NULL, NULL, NULL, 0, 0, 51.2, 1.2, 61.44, 1.1, 70, 0, NULL, NULL, 'M2',
  NULL, NULL, 'F', '1', NULL, 0, NULL, 0);
INSERT INTO dbo.PMEELEMENTOUVCOMP (CODEOUV, CODECOMPO, NUMORDRE, CLENATURE, LIBELLECOM, DEBOURSE, COEFFG, PR, COEFBEN, PV,
  QUANTITEBASE, QUANTITECAD, QUANTITEUNIT, UNITE, TEMPS, SOMMEIL) VALUES
 ('MUR20', 'CIM35', 1, 2, '', 0.21, 1.1, 0.231, 1.2, 0.2772, 20, 0, 20, 'KG', 0, 0),
 ('MUR20', 'MOMAC', 2, 1, '', 30, 1.2, 36, 1.1, 39.6, 0.5, 0, 0.5, 'H', 0.5, 0),
 ('MUR20', 'VIEUX', 3, 2, 'Ancien article', 2, 1, 2, 1, 2, 1, 0, 1, 'U', 0, 0),
 ('MUR20', 'MOMAC', 4, 1, 'Composante en sommeil', 30, 1, 30, 1, 30, 9, 0, 9, 'H', 0, 1),
 ('AMUR', 'MUR20', 1, 4, '', 21.2, 1.15, 24.38, 1.25, 30.475, 1, 0, 1, 'M2', 0, 0),
 ('AMUR', 'MOMAC', 2, 1, '', 30, 1.2, 36, 1.1, 39.6, 1, 0, 1, 'H', 1, 0);
INSERT INTO dbo.PMEELEMENTUNITEVTE (CODEART, UNITE, NUMORDRE, QTEVTE, EQUIVSTOCK, RATIO, DEFAUT) VALUES ('CIM35', 'ENS', 1, 1, 350, 0, 0);
INSERT INTO dbo.PMEFOURNISSEURTARIF (CLE, CODEFOUR, REFERENCE, LIBELLE, PAPUBLIC, REMISE1, REMISE2, PANET, UNITEACHAT) VALUES
 (1, 'F001', 'CIM-35', 'Ciment CEM II 35 kg', 10, 30, 0, 7, 'U');
INSERT INTO dbo.PMEELEMENTARTFOUR (CLE, CODEART, NUMORDRE, PRINCIPAL, CODEFOUR, CLETARIFFOUR, PAPUBLIC, REMISEFOUR1, REMISEFOUR2,
  PANET, UNITEACHAT, RATIO, DATETARIF) VALUES
 (1, 'CIM35', 1, 1, 'F001', 1, 10, 30, 0, 7, 'U', 35, '2026-01-01'),
 (2, 'CIM35', 2, 0, 'F002', NULL, 0, 0, 0, 7.35, 'U', 35, NULL);
INSERT INTO dbo.SYS_RTCINFOS (TABLENAME, FIELDNAME, DISPLAYNAME, FIELDTYPE, FIELDSIZE, DATATYPE, REQUIRED) VALUES
 ('PMEELEMENT', 'RTCFIELD1', 'Marque', 'E', 30, 'S', 0);
UPDATE dbo.PMEELEMENT SET RTCFIELD1 = 'Vicat' WHERE CODE = 'CIM35';
GO

-- Structure (lot 9) : états, types de marché, affaires (ouverte, close par l'état, close par la date), chantiers
INSERT INTO dbo.PMEETATAFFAIRE (CLE, NUMORDRE, LIBELLE, NONMODIFIABLE) VALUES (1, 1, 'En cours', 0), (2, 2, 'Archivée', 1);
INSERT INTO dbo.PMEETATCHANTIER (CLE, NUMORDRE, LIBELLE, COMMENCE, TERMINE, NONMODIFIABLE) VALUES
 (1, 1, 'En cours', 1, 0, 0), (2, 2, 'Terminé', 1, 1, 0), (3, 3, 'Clôturé', 1, 1, 1);
INSERT INTO dbo.PMETYPEMARCHE (CLE, NUMORDRE, LIBELLE) VALUES (1, 1, 'Marché privé'), (2, 2, 'Marché public');
INSERT INTO dbo.PMEAFFAIRE (CODE, DATEAFFAIRE, CLEETAT, LIBELLE, CODECLIENT, CODECHARGEAFF, CODEARCHI, DESCRIPTIF, NOTE, DATECLOTURE) VALUES
 ('AF001', '2024-01-15', 1, 'Résidence Les Tilleuls', 'C001', 'G001', 'A001', 'Construction de 12 logements', 'Note affaire', NULL),
 ('AF002', '2023-05-02', 2, 'Ancienne affaire', 'C003', NULL, NULL, NULL, NULL, NULL),
 ('AF003', '2023-06-01', 1, 'Affaire soldée', 'C001', NULL, NULL, NULL, NULL, '2024-02-28');
INSERT INTO dbo.PMECHANTIER (CODE, CODEAFFAIRE, CLEETAT, LIBELLE, CODECLIENT, ADR, CP, VILLE, CODESALRESP, DATEDEBUT, DATEFINPREV, DATEFIN,
  DESCRIPTIF, CLETYPEMARCHE, ORIGINEMARCHE, DATESIGNATURE, MTHTMARCHEPREV, MTHTAVENANTPREV, MTHTTOTALPREV, CODECHARGEAFF, CODEARCHI) VALUES
 ('CH001', 'AF001', 1, 'Tilleuls bâtiment A', 'C001', '12 rue des Tilleuls', '69003', 'Lyon', 'SAL01', '2024-02-01', '2024-12-20', NULL,
  'Gros œuvre', 2, 'Appel d''offres', '2024-01-20', 150000, 12500.5, 0, 'G001', 'A001'),
 ('CH002', 'AF002', 3, 'Rénovation terminée', 'C003', NULL, NULL, NULL, NULL, '2023-05-10', NULL, '2023-09-30',
  NULL, 1, NULL, NULL, 0, 0, 48000, NULL, NULL),
 ('CH003', 'AF001', 2, 'Tilleuls VRD', 'C001', NULL, NULL, NULL, 'SAL09', NULL, NULL, '2024-06-30',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
GO

-- Pièces de vente (lot 10) : états, devis en deux versions (la seconde acceptée, PV imposés, écart de reprise de 0,05),
-- commande avec postes de pied, facture validée, avoir brouillon, facture d'avancement (lot 11, écartée).
INSERT INTO dbo.PMEETATDOCUMENT (CLE, TYPEDOC, NUMORDRE, LIBELLE, ENVOYE, ACCEPTE, NONMODIFIABLE) VALUES
 (1, 'DC', 1, 'En cours', 0, 0, 0), (2, 'DC', 2, 'Accepté', 1, 1, 1);
INSERT INTO dbo.PMEDOCDEVCLI (CLEDOC, CODE, TYPE, CODEDEVINIT, CLEETATDOC, DATEDOC, LIBELLE, CODEAFFAIRE, CODECLIENT, NOM, ADR, CP, VILLE, PAYS,
  CODECATEGORIE, CODECHT, MODREG, VALIDITENB, VALIDITEPER, LETTREENTETE, MTHT, MTPOSTESHT, MTPOSTESTTC, MTTTC) VALUES
 (101, 'DC000001', 'D', NULL, 1, '2024-01-10', 'Tilleuls - estimation', 'AF001', 'C001', 'Client un', '1 rue A', '69001', 'Lyon', 'FR',
  'F', 'CH001', 'CHQ', 3, 'M', NULL, 500, 0, 0, 600),
 (102, 'DC000002', 'D', 'DC000001', 2, '2024-01-18', 'Tilleuls - gros œuvre', 'AF001', 'C001', 'Client un', '1 rue A', '69001', 'Lyon', 'FR',
  'F', 'CH001', 'V30', 30, 'J', '{\rtf1 Suite à votre demande}', 598.80, 0, 0, 718.56);
-- Comme sur une base réelle : la ligne récapitulative R a IDLIG = 0, et les lignes de premier niveau IDPARENT = 0.
INSERT INTO dbo.PMEDOCDEVCLILIG (CLE, CLEDOC, IDLIG, IDPARENT, NUMORDRE, TYPELIG, NIVTR, NIVCOMPO, CODEELEM, CLENATURE, LIBELLE, LIBELLECOM,
  DEBOURSE, COEFFG, COEFBEN, PV, REMISE, CODETVA, QUANTITE, UNITE, DECUNITE, MONTANTHT, PVIMPOSE, EDITEE) VALUES
 (1001, 101, 1, 0, 1, 'E', 0, 0, NULL, 4, 'Ancienne estimation', NULL, 400, 1, 1.25, 500, 0, '1', 1, 'ENS', 0, 500, 0, 1),
 (1101, 102, 1, 0, 1, 'T', 1, 0, NULL, NULL, 'Gros œuvre', NULL, 0, 1, 1, 0, 0, NULL, 0, NULL, 0, 0, 0, 1),
 (1102, 102, 2, 1, 1, 'E', 0, 0, 'MUR20', NULL, 'Mur de 20', NULL, 21.2, 1, 1.4375, 30.5, 0, '1', 10, 'M2', 2, 305, 0, 1),
 (1103, 102, 3, 2, 1, 'E', 0, 1, 'CIM35', 2, 'Parpaing', NULL, 1.2, 1.1, 1.2, 1.584, 0, NULL, 10, 'U', 0, 0, 0, 1),
 (1104, 102, 4, 2, 2, 'E', 0, 1, 'MOMAC', 1, 'Main d''œuvre', NULL, 18, 1.1, 1.2, 25, 0, NULL, 0.5, 'H', 2, 0, 0, 1),
 (1105, 102, 5, 1, 2, 'E', 0, 0, NULL, 2, 'Enduit', '{\rtf1 \b Enduit\b0  monocouche}', 8, 1.15, 1.25, 11.5, 0, '1', 12.5, 'M2', 2, 143.75, 0, 1),
 (1106, 102, 6, 1, 3, 'E', 0, 0, NULL, 4, 'Échafaudage', NULL, 100, 1.1, 1.3, 150, 0, '1', 1, 'U', 0, 150, 1, 1),
 (1107, 102, 7, 0, 2, 'L', 0, 0, NULL, NULL, 'Garantie décennale', NULL, 0, 1, 1, 0, 0, NULL, 0, NULL, 0, 0, 0, 1),
 (1108, 102, 0, 0, 0, 'R', 0, 0, NULL, NULL, 'Récapitulatif', NULL, 0, 1, 1, 0, 0, NULL, 0, NULL, 0, 0, 0, 1);
UPDATE dbo.PMECHANTIER SET CLEDOCINIT = 102 WHERE CODE = 'CH001';
-- Marché MDE (19/11/2026) : devis et avenants servant à la facturation, reliés au chantier, dans l'ordre de NUMORDRE.
INSERT INTO dbo.PMEAFFBASEDOC (CLEDOC, NUMORDRE, CLEDOCINIT, DATEDOC, CODE, LIBELLE, CODECLIENT, CODECATEGORIE, CODECHT, MODREG, MTHT, MTTTC) VALUES
 (602, 2, NULL, '2024-03-15', 'MB000002', 'Avenant fenêtre', 'C001', 'F', 'CH001', 'V30', 100, 120),
 (601, 1, 102, '2024-01-25', 'MB000001', 'Tilleuls - marché', 'C001', 'F', 'CH001', 'V30', 598.75, 718.50);
INSERT INTO dbo.PMEAFFBASEDOCLIG (CLE, CLEDOC, CLELIGINIT, IDLIG, IDPARENT, NUMORDRE, TYPELIG, NIVTR, NIVCOMPO, CODEELEM, CLENATURE, LIBELLE,
  DEBOURSE, COEFFG, COEFBEN, PV, REMISE, CODETVA, QUANTITE, UNITE, DECUNITE, MONTANTHT, PVIMPOSE, EDITEE) VALUES
 (6108, 601, 1108, 0, 0, 0, 'R', 0, 0, NULL, NULL, 'Récapitulatif', 0, 1, 1, 0, 0, NULL, 0, NULL, 0, 0, 0, 1),
 (6101, 601, 1101, 1, 0, 1, 'T', 1, 0, NULL, NULL, 'Gros œuvre', 0, 1, 1, 0, 0, NULL, 0, NULL, 0, 0, 0, 1),
 (6102, 601, 1102, 2, 1, 1, 'E', 0, 0, 'MUR20', NULL, 'Mur de 20', 21.2, 1, 1.4375, 30.5, 0, '1', 10, 'M2', 2, 305, 0, 1),
 (6103, 601, 1103, 3, 2, 1, 'E', 0, 1, 'CIM35', 2, 'Parpaing', 1.2, 1.1, 1.2, 1.584, 0, NULL, 10, 'U', 0, 0, 0, 1),
 (6104, 601, 1104, 4, 2, 2, 'E', 0, 1, 'MOMAC', 1, 'Main d''œuvre', 18, 1.1, 1.2, 25, 0, NULL, 0.5, 'H', 2, 0, 0, 1),
 (6105, 601, 1105, 5, 1, 2, 'E', 0, 0, NULL, 2, 'Enduit', 8, 1.15, 1.25, 11.5, 0, '1', 12.5, 'M2', 2, 143.75, 0, 1),
 (6106, 601, 1106, 6, 1, 3, 'E', 0, 0, NULL, 4, 'Échafaudage', 100, 1.1, 1.3, 150, 0, '1', 1, 'U', 0, 150, 1, 1),
 (6201, 602, NULL, 1, 0, 1, 'E', 0, 0, NULL, 4, 'Plus-value fenêtre', 80, 1, 1.25, 100, 0, '1', 1, 'U', 0, 100, 0, 1);
INSERT INTO dbo.PMEDOCCDECLI (CLEDOC, CODE, CLEETATDOC, DATEDOC, LIBELLE, CODEAFFAIRE, CODECLIENT, CODECATEGORIE, MTHT, MTPOSTESHT, MTPOSTESTTC, MTTTC) VALUES
 (301, 'CC000001', NULL, '2024-02-01', 'Commande Tilleuls', 'AF001', 'C001', 'F', 200, 50, 0, 300),
 -- Copie exacte de l'avenant MB000002 du marché (même numéro) : reprise une seule fois, par le marché.
 (302, 'MB000002', NULL, '2024-03-15', 'Avenant fenêtre', 'AF001', 'C001', 'F', 100, 0, 0, 120);
INSERT INTO dbo.PMEDOCCDECLILIG (CLE, CLEDOC, IDLIG, IDPARENT, NUMORDRE, TYPELIG, NIVCOMPO, CLENATURE, LIBELLE, DEBOURSE, COEFFG, COEFBEN, PV,
  REMISE, CODETVA, QUANTITE, UNITE, MONTANTHT, PVIMPOSE) VALUES
 (3001, 301, 1, 0, 1, 'E', 0, 4, 'Prestation', 100, 1, 2, 200, 0, '1', 1, 'U', 200, 0);
INSERT INTO dbo.PMEDOCFACCLI (CLEDOC, CODE, TYPE, CLEETATDOC, DATEDOC, LIBELLE, CODEAFFAIRE, CODECHT, CODECLIENT, NOM, ADR, CP, VILLE,
  CODECATEGORIE, EDITIONDEFINITIVE, MTHT, MTPOSTESHT, MTPOSTESTTC, MTTTC) VALUES
 (201, 'FA000001', 'F', NULL, '2024-03-31', 'Facture forfait', 'AF001', 'CH001', 'C001', 'Client un', '1 rue A', '69001', 'Lyon', 'F', 1, 1000, 0, 0, 1100),
 (202, 'AV000001', 'A', NULL, '2024-04-05', 'Avoir geste commercial', 'AF001', NULL, 'C001', NULL, NULL, NULL, NULL, 'F', 0, 100, 0, 0, 120),
 (203, 'FA000002', 'T', NULL, '2024-04-30', 'Facture d''avancement', 'AF001', 'CH001', 'C001', NULL, NULL, NULL, NULL, 'F', 1, 296.25, 0, 0, 355.50);
INSERT INTO dbo.PMEDOCFACCLILIG (CLE, CLEDOC, IDLIG, IDPARENT, NUMORDRE, TYPELIG, NIVCOMPO, CLENATURE, LIBELLE, DEBOURSE, COEFFG, COEFBEN, PV,
  REMISE, CODETVA, QUANTITE, UNITE, MONTANTHT, PVIMPOSE) VALUES
 (2001, 201, 1, 0, 1, 'E', 0, 4, 'Forfait gros œuvre', 800, 1, 1.25, 1000, 0, '2', 1, 'ENS', 1000, 0),
 (2002, 202, 1, 0, 1, 'E', 0, 4, 'Geste commercial', 0, 1, 1, 100, 0, '1', 1, 'U', 100, 0);
GO

-- Avancement (lot 11) : situation détaillée (mur à 50 %, enduit à 100 %, composante ignorée) facturée par FA000002,
-- puis situation globale en cumul à 80 % du marché et de son avenant (brouillon, non facturée) ; lignes citées : PMEAFFBASEDOCLIG.
UPDATE dbo.PMEDOCFACCLI SET CODESITTX = 'ST000001' WHERE CLEDOC = 203;
INSERT INTO dbo.PMEDOCSITTX (CLEDOC, CODE, CODEFACAVT, CLEETATDOC, DATEDOC, LIBELLE, LIBELLESIT, CODEAFFAIRE, CODECHT, CODECLIENT, NUMERO,
  CODESITPREC, CODECATEGORIE, TYPEAVT, TYPEARRONDI, PCAVTCUMUL, MTHTCUMUL, MTTTCCUMUL, MTHT, MTTTC) VALUES
 (401, 'ST000001', 'FA000002', 2, '2024-04-30', 'Tilleuls', 'Situation n° 1', 'AF001', 'CH001', 'C001', 1, NULL, 'F', 'D', '', 49.47, 296.25, 355.50, 296.25, 355.50),
 (402, 'ST000002', NULL, NULL, '2024-05-31', 'Tilleuls', 'Situation n° 2', 'AF001', 'CH001', 'C001', 2, 'ST000001', 'F', 'C', '', 80, 559.00, 670.80, 262.75, 315.30);
INSERT INTO dbo.PMEDOCSITTXLIG (CLE, CLEDOC, CLEDEVBASE, IDLIG, IDPARENT, NUMORDRE, TYPELIG, NIVCOMPO, LIBELLE, CODETVA, QUANTITE, PVHT,
  MONTANTHT, PCAVT, QTESITUATION, MTSITUATION) VALUES
 (4001, 401, 6101, 1, 0, 1, 'T', 0, 'Gros œuvre', NULL, 0, 0, 0, 0, 0, 0),
 (4002, 401, 6102, 2, 1, 1, 'E', 0, 'Mur de 20', '1', 10, 30.5, 305, 50, 5, 152.50),
 (4003, 401, 6103, 3, 2, 1, 'E', 1, 'Parpaing', NULL, 10, 1.584, 15.84, 50, 5, 7.92),
 (4004, 401, 6105, 4, 1, 2, 'E', 0, 'Enduit', '1', 12.5, 11.5, 143.75, 100, 12.5, 143.75),
 (4005, 401, 6106, 5, 1, 3, 'E', 0, 'Échafaudage', '1', 1, 150, 150, 0, 0, 0);
GO

-- Achats et sous-traitance (lot 12) : commande fournisseur sur deux chantiers, facture transférée avec remise, avoir,
-- commande et facture de sous-traitance.
INSERT INTO dbo.ENTETECDEFOURNISSEUR (CODE, CODEDOCUTIL, TYPE, DATEDOC, CODETIERS, LIBELLE, CLEETATDOC, CATEGORIEAV, CODEAFFAIRE, CODECHT,
  CODEREGLEMENT, REFFOURNISSEUR, TOTHTNET, TOTALTTC) VALUES
 (501, 'CF000001', 'C', '2024-02-10', 'F001', 'Matériaux gros œuvre', 2, 'F', 'AF001', 'CH001', 'V30', 'ARC-77', 350, 420);
INSERT INTO dbo.LIGNECDEFOURNISSEUR (IDENTIFIANT, CODEDOCUMENT, NUMEROLIGNE, TYPELIGNE, CODEARTICLE, DESIGNATION, QUANTITE, PRIXUNITAIRE, REMISE,
  TOTALLIGNEHT, CODETVA, UNITEMESURE, CODECHT) VALUES
 (5001, 501, 1, 'U', 'CIM35', 'Ciment', 20, 7, 0, 140, 1, 'U', 'CH001'),
 (5002, 501, 2, 'R', NULL, 'Sable', 10, 21, 0, 210, 1, 'U', 'CH003'),
 (5003, 501, 3, 'T', NULL, 'Livraison semaine 7', 0, 0, 0, 0, 0, NULL, NULL);
INSERT INTO dbo.ENTETEFACTUREFOURNISSEUR (CODE, CODEDOCUTIL, TYPE, DATEDOC, CODETIERS, LIBELLE, CATEGORIEAV, CODEAFFAIRE, CODECHT,
  TRANSFERECOMPTABLE, TOTHTNET, TOTALTTC) VALUES
 (502, 'FF000001', 'F', '2024-02-28', 'F001', 'Facture matériaux', 'F', 'AF001', 'CH001', 1, 340, 408),
 (503, 'AVF00001', 'A', '2024-03-05', 'F001', 'Avoir retour sable', 'F', 'AF001', 'CH003', 0, -50, -60);
INSERT INTO dbo.LIGNEFACTUREFOURNISSEUR (IDENTIFIANT, CODEDOCUMENT, NUMEROLIGNE, TYPELIGNE, CODEARTICLE, DESIGNATION, QUANTITE, PRIXUNITAIRE,
  REMISE, TOTALLIGNEHT, CODETVA, UNITEMESURE, CODECHT) VALUES
 (5011, 502, 1, 'U', 'CIM35', 'Ciment', 20, 7, 0, 140, 1, 'U', 'CH001'),
 (5012, 502, 2, 'R', NULL, 'Sable', 10, 21, 0, 210, 1, 'U', 'CH003'),
 (5013, 502, 3, '2', NULL, 'Remise commerciale', 0, 0, 0, -10, 1, NULL, NULL),
 (5021, 503, 1, 'R', NULL, 'Retour sable', 1, -50, 0, -50, 1, 'U', 'CH003');
INSERT INTO dbo.ENTETECDESSTRAIT (CODE, CODEDOCUTIL, TYPE, DATEDOC, CODETIERS, LIBELLE, CLEETATDOC, CATEGORIEAV, CODEAFFAIRE, CODECHT, TOTHTNET, TOTALTTC) VALUES
 (601, 'CS000001', 'C', '2024-02-15', 'S001', 'Plâtrerie', 2, 'F', 'AF001', 'CH001', 1000, 1200);
INSERT INTO dbo.LIGNECDESSTRAIT (IDENTIFIANT, CODEDOCUMENT, NUMEROLIGNE, TYPELIGNE, DESIGNATION, QUANTITE, PRIXUNITAIRE, REMISE, TOTALLIGNEHT, CODETVA, UNITEMESURE) VALUES
 (6001, 601, 1, 'E', 'Lot plâtrerie', 1, 1000, 0, 1000, 1, 'ENS');
INSERT INTO dbo.ENTETEFACTURESSTRAIT (CODE, CODEDOCUTIL, TYPE, DATEDOC, CODETIERS, LIBELLE, CATEGORIEAV, CODEAFFAIRE, CODECHT, TRANSFERECOMPTABLE, TOTHTNET, TOTALTTC) VALUES
 (602, 'FS000001', 'F', '2024-03-31', 'S001', 'Plâtrerie situation 1', 'F', 'AF001', 'CH001', 1, 400, 480);
INSERT INTO dbo.LIGNEFACTURESSTRAIT (IDENTIFIANT, CODEDOCUMENT, NUMEROLIGNE, TYPELIGNE, DESIGNATION, QUANTITE, PRIXUNITAIRE, REMISE, TOTALLIGNEHT, CODETVA, UNITEMESURE) VALUES
 (6011, 602, 1, 'E', 'Plâtrerie situation 1', 1, 400, 0, 400, 1, 'ENS');
GO

-- Règlements (lot 13) : FIN_DOCUMENT (cumul réglé par pièce, CODELOGICIEL = clé de la pièce, TYPETIERS C / F) ;
-- échéances COMM_ECHEANCE (facture 201 en deux échéances partiellement réglées, avoir 202 remboursé, facture
-- fournisseur 502 soldée) ; facture 203 sans échéance (échéancier calculé, retenue de garantie PMEDOCRETENUE, 100
-- réglés) ; caution bancaire sur la facture 201 ; avoir fournisseur 503 sans rien (ouvert).
INSERT INTO dbo.FIN_DOCUMENT (CODELOGICIEL, IDLOGICIEL, PROVENANCE, REFERENCE, DATEPIECE, NETAPAYER, TIERS, CODEGESTION, TYPETIERS, RESTEDU, DEJAREGLE,
  DATEMODIF, MODEREG) VALUES
 (201, 1, 'FACTURE', 'FA000001', '2024-03-31', 1100, 1, 'C001', 'C', 350, 750, '2024-05-15', 'CHQ'),
 (202, 1, 'AVOIR', 'AV000001', '2024-04-05', -120, 1, 'C001', 'C', 0, -120, '2024-04-20', 'VIR'),
 (203, 1, 'FACTURE', 'FA000002', '2024-04-30', 355.50, 1, 'C001', 'C', 255.50, 100, '2024-05-31', 'VIR'),
 (502, 2, 'FACTURE', 'FF000001', '2024-02-28', 408, 1, 'F001', 'F', 0, 408, '2024-03-30', 'VIR');
INSERT INTO dbo.COMM_ECHEANCE (CODE, IDLOGICIEL, CODELOGICIEL, MONTANT, LIBELLE, DATEECH, DATEMODIF, FLAVOIR, DEJAREGLE, NLIGNE, FLRETENUEGARANTIE) VALUES
 (9001, 1, 201, 550, 'Échéance 1', '2024-04-30', '2024-04-30', 0, 550, 1, 0),
 (9002, 1, 201, 550, 'Échéance 2', '2024-05-31', '2024-05-15', 0, 200, 2, 0),
 (9003, 1, 202, -120, 'Avoir', '2024-04-05', '2024-04-20', 1, -120, 1, 0),
 (9004, 2, 502, 408, 'Échéance', '2024-03-31', '2024-03-30', 0, 408, 1, 0);
INSERT INTO dbo.PMEDOCRETENUE (CLEDOC, NUMORDRE, CODERETENUE, PC, TYPEBASE, MTBASE, MTRET, TYPECAUTION, TYPERGL, DESCRIPTIF, DATEECH) VALUES
 (203, 1, 'RG5', 5, 'T', 355.50, 17.78, '', '', 'Retenue de garantie 5 %', NULL),
 (201, 1, 'RG5', 5, 'T', 1100, 55, 'C', '', 'Banque Populaire', '2025-03-31');
GO

-- Exploitation (lot 14) : suivi de main-d'œuvre par chantier (heures, rubriques panier et zone, heures d'équipe sans
-- salarié non reprises, rubrique inconnue signalée).
INSERT INTO dbo.PMECHTSUIVMOCHT (CLE, DATETX, CODECHT, CODESAL, CODEEQUIPE, CLENATURE, CODEHEURE, CODERUB, NOMBRE, PRIX, MONTANT) VALUES
 (1, '2024-03-04', 'CH001', 'SAL01', NULL, 1, 'HN', NULL, 8, 48.5, 388),
 (2, '2024-03-05', 'CH001', 'SAL01', NULL, 1, 'HN', NULL, 7.5, 48.5, 363.75),
 (3, '2024-03-05', 'CH003', 'SAL03', NULL, 1, 'HS25', NULL, 2, 22, 44),
 (4, '2024-04-02', 'CH001', 'SAL02', NULL, NULL, 'HN', NULL, 8, 0, 0),
 (5, '2024-03-04', 'CH001', 'SAL01', NULL, NULL, NULL, 'PAN', 1, 10.5, 10.5),
 (6, '2024-03-04', 'CH001', 'SAL01', NULL, NULL, NULL, 'Z3', 1, 0, 0),
 (7, '2024-03-06', 'CH001', NULL, 'EQ1', 1, 'HN', NULL, 16, 0, 0),
 (8, '2024-03-07', 'CH001', 'SAL01', NULL, NULL, NULL, 'XYZ', 1, 0, 0);
GO

-- Lot 14, stock : dépôts (sans chantier → dépôt par défaut ; dépôt de chantier → stock tenu), stock réel par lot,
-- fournitures hors pièce (BLORIG : issue d'un bon de livraison, écartée), heures de matériel (unité J écartée).
INSERT INTO dbo.PMEDEPOT (CODE, TYPE, CODECHT, LIBELLE, PRINCIPAL) VALUES
 ('DEP1', 'D', NULL, 'Dépôt central', 1),
 ('DCH3', 'C', 'CH003', 'Stock du chantier VRD', 0);
INSERT INTO dbo.PMESTOCKREEL (CODEARTICLE, CODEDEPOT, CODELOT, QUANTITE) VALUES
 ('CIM35', 'DEP1', 'L1', 100), ('CIM35', 'DEP1', 'L2', 20.5), ('CIM35', 'DCH3', NULL, 5), ('INCONNU', 'DEP1', NULL, 3),
 ('CIM35', NULL, 'L3', 0);
INSERT INTO dbo.PMECHTSUIVFO (CLE, CODECHT, CODEDEPOT, BLORIG, CLEREGIEORIG, DATESUIVI, CLENATURE, CODEELEM, LIBELLE, QTE, DEBUNIT, DEBTOT) VALUES
 (1, 'CH001', 'DEP1', NULL, NULL, '2024-03-04', 2, 'CIM35', 'Ciment pour reprise', 50, 0.21, 10.5),
 (2, 'CH001', 'DEP1', 'BL0001', NULL, '2024-03-05', 2, 'CIM35', NULL, 80, 0.21, 16.8),
 (3, 'CH001', NULL, NULL, 12, '2024-03-18', 2, 'CIM35', NULL, 10, 0.25, 2.5),
 (4, 'CH001', NULL, NULL, NULL, '2024-03-19', NULL, NULL, 'Divers sans article', 1, 30, 30);
INSERT INTO dbo.PMECHTSUIVMAT (CLE, CODECHT, CODEMAT, DATEDEB, DUREE, UNITE, INFO) VALUES
 (1, 'CH001', 'MP-001', '2024-03-05', 6.5, 'H', 'Terrassement'),
 (2, 'CH001', 'MP-001', '2024-03-06', 2, 'J', NULL);
GO

-- Lot 16, GED et notes : une image partagée par un élément et la photo d'un salarié (un seul contenu), une image
-- inutilisée ; actions d'affaire (terminée, ouverte avec fin prévue, affaire inconnue).
INSERT INTO dbo.SYS_MDEIMAGES (CODE, FILENAME, CLASS, DATA) VALUES
 (1, 'C:\Images\ciment.png', 'TPNGImage', 0x89504E470D0A1A0A0000000D49484452),
 (2, 'inutile.png', 'TPNGImage', 0x0102);
UPDATE dbo.PMEELEMENT SET IDIMAGE = 1 WHERE CODE = 'CIM35';
UPDATE dbo.PMESALARIE SET IDPHOTO = 1 WHERE CODE = 'SAL01';
INSERT INTO dbo.PMEACTION (CODE, LIBELLE) VALUES ('TEL', 'Appel téléphonique');
INSERT INTO dbo.PMEAFFACTION (CLE, CODEAFFAIRE, CODEACTION, OBJET, DATEACTION, AUTEUR, DESTINATAIRE, DESCRIPTIF, DATEFINPREVUE, DATETERMINEE, NOTE) VALUES
 (1, 'AF001', 'TEL', 'Relance architecte', '2024-02-01', 'JM', 'Cabinet Arche', 'Plans d''exécution attendus', NULL, NULL, NULL),
 (2, 'AF001', NULL, NULL, '2024-03-01', NULL, NULL, 'Visite de chantier', '2026-12-01', NULL, 'À organiser'),
 (3, 'AFXXX', 'TEL', 'Affaire perdue', '2024-03-02', NULL, NULL, NULL, NULL, NULL, NULL);
GO
