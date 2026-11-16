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
  '4120A', 'FR12123456789', 'SARL', '10000', 2, 'EUR', 'VT', 'HA', 'D000124', 'F000057', 'C000033', 'S000012', 2, 2, 2, 2);
GO

-- Référentiels
INSERT INTO dbo.PMEUNITEMESURE (UNITE, NBDEC) VALUES ('U', 0), ('M2', 2), ('ML', 2), ('H', 2), ('ENS', 0), ('KG', 3);
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
INSERT INTO dbo.APIMODEREGLEMENT (CODE, NOM) VALUES ('CHQ', 'Chèque'), ('VIR', 'Virement'), ('V30', 'Virement 30 jours fin de mois'), ('3X', 'Trois fois');
-- POUR : pourcentage ; NJ : nombre de jours ; JOUR : jour du mois imposé (0 : aucun) ; MOISENTIER : fin de mois.
INSERT INTO dbo.APIMODEREGLEMENTL (CODE, LIG, POUR, JOUR, NJ, MODEP, TYPEP, MOISENTIER) VALUES
 ('CHQ', 1, 100, 0, 0, 1, 'C', 0),
 ('VIR', 1, 100, 0, 0, 2, 'V', 0),
 ('V30', 1, 100, 0, 30, 2, 'V', 1),
 ('3X', 1, 40, 0, 0, 1, 'C', 0),
 ('3X', 2, 30, 0, 30, 1, 'C', 0),
 ('3X', 3, 30, 0, 60, 1, 'C', 0);
INSERT INTO dbo.APIPAYS (CODE, NOM, CODEDEVISE) VALUES ('FR', 'France', 'EUR'), ('BE', 'Belgique', 'EUR');
INSERT INTO dbo.APICIVILITE (LIBELLE, FORMEJURIDIQUE) VALUES ('Monsieur', 0), ('Madame', 0), ('SARL', 1), ('SCI', 1);
INSERT INTO dbo.CMP_PLANCP (COMPTE, NOM, FAMILLE) VALUES
 ('411000', 'Clients', 4), ('401000', 'Fournisseurs', 4), ('401100', 'Sous-traitants', 4),
 ('704000', 'Travaux', 7), ('604000', 'Achats de prestations', 6), ('601000', 'Achats de matériaux', 6);
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
INSERT INTO dbo.PMEARCHITECTE (CODE, TYPETIERS) VALUES ('A001', 'A');
INSERT INTO dbo.PMECHARGEAFFAIRE (CODE, TYPETIERS) VALUES ('G001', 'G');
GO

-- Annuaire : identité, adresses (COMM_TIERSADR.CODE → COMM_TIERS.CODE) et contacts (IDADR → adresse)
INSERT INTO dbo.COMM_TIERS (CODE, COMPTE, COMPTETIERS, CODEGESTION, TYPETIERS, NII, DEVISE, MODEREG, EXCLURERELANCE,
  ENCOURSAUTORISE, SITEINTERNET, IDADRFACTURATION, IDADRLIVRAISON, DATECREATION, DATEMODIFICATION) VALUES
 (1, '411000', 'CMARTIN', 'C001', 'C', NULL, 'EUR', 'CHQ', 0, 0, NULL, 11, 12, '2019-03-01', '2024-05-10'),
 (2, '411000', 'CTILLEULS', 'C002', 'C', 'FR44444555666', 'EUR', 'V30', 1, 50000, NULL, 21, 0, '2020-01-15', '2020-01-15'),
 (3, '411000', 'CMATBAT', 'C003', 'C', 'FR77777888999', 'EUR', 'V30', 0, 20000, 'www.matbat.fr', 31, 0, '2018-06-01', '2023-02-01'),
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
