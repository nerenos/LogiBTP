-- =============================================================================
-- Référentiel des unités. lig_unt_code reste une saisie libre (pas de clé étrangère) :
-- le référentiel alimente la liste de choix, une unité non référencée reste acceptée.
-- Script rejouable sur une base existante.
-- =============================================================================

CREATE TABLE IF NOT EXISTS unite (
    unt_code           VARCHAR(10)  PRIMARY KEY,
    unt_libelle        VARCHAR(50)  NOT NULL,
    unt_precision_qte  SMALLINT     NOT NULL DEFAULT 2,
    unt_ordre          INT          NOT NULL DEFAULT 0,
    unt_actif          BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO unite (unt_code, unt_libelle, unt_precision_qte, unt_ordre) VALUES
 ('u',    'Unité',            0, 1),
 ('ens',  'Ensemble',         0, 2),
 ('ft',   'Forfait',          0, 3),
 ('pce',  'Pièce',            0, 4),
 ('m',    'Mètre',            2, 10),
 ('ml',   'Mètre linéaire',   2, 11),
 ('m2',   'Mètre carré',      2, 12),
 ('m3',   'Mètre cube',       3, 13),
 ('cm',   'Centimètre',       1, 14),
 ('mm',   'Millimètre',       0, 15),
 ('km',   'Kilomètre',        3, 16),
 ('kg',   'Kilogramme',       2, 20),
 ('t',    'Tonne',            3, 21),
 ('l',    'Litre',            2, 22),
 ('h',    'Heure',            2, 30),
 ('j',    'Jour',             2, 31),
 ('sem',  'Semaine',          2, 32),
 ('mois', 'Mois',             2, 33),
 ('sac',  'Sac',              0, 40),
 ('pal',  'Palette',          0, 41),
 ('rl',   'Rouleau',          0, 42),
 ('bte',  'Boîte',            0, 43),
 ('lot',  'Lot',              0, 44)
ON CONFLICT (unt_code) DO NOTHING;
