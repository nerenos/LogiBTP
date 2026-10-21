-- Module Calendrier LogiBTP – calendriers de travail (plages par jour, cycle de N semaines depuis une date de référence,
-- plages datées), jours fermés par règles (fériés, fermetures) de la société ou d'une portée (calendrier, ou élément de
-- l'application : un service…). ANALYSE-MODULE-PLANNING.md P12, P13, P22 ; ANALYSE-MODULES-TRANSVERSE.md § 4.3.
-- Sans clé étrangère vers l'application. Rejouable.

CREATE TABLE IF NOT EXISTS calendrier (
    cal_id              SERIAL        PRIMARY KEY,
    cal_code            VARCHAR(20)   NOT NULL UNIQUE,
    cal_libelle         VARCHAR(80)   NOT NULL,
    cal_cycle_semaines  INT           NOT NULL DEFAULT 1 CHECK (cal_cycle_semaines BETWEEN 1 AND 8),
    cal_reference       DATE,                                         -- semaine 1 du cycle : celle de cette date
    cal_defaut          BOOLEAN       NOT NULL DEFAULT FALSE,
    cal_actif           BOOLEAN       NOT NULL DEFAULT TRUE,
    cal_maj_par         VARCHAR(50),
    cal_maj_le          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_cal_reference CHECK (cal_cycle_semaines = 1 OR cal_reference IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cal_defaut ON calendrier ((TRUE)) WHERE cal_defaut;

-- Plages : semaine du cycle, jour ISO (1 lundi … 7 dimanche), minutes depuis minuit ; datées (du, au), elles remplacent
-- les plages permanentes du même jour pendant leur période (horaires d'été…).
CREATE TABLE IF NOT EXISTS calendrier_plage (
    plg_id       SERIAL        PRIMARY KEY,
    plg_cal_id   INT           NOT NULL REFERENCES calendrier(cal_id) ON DELETE CASCADE,
    plg_semaine  INT           NOT NULL DEFAULT 1 CHECK (plg_semaine BETWEEN 1 AND 8),
    plg_jour     INT           NOT NULL CHECK (plg_jour BETWEEN 1 AND 7),
    plg_debut    INT           NOT NULL CHECK (plg_debut BETWEEN 0 AND 1440),
    plg_fin      INT           NOT NULL CHECK (plg_fin BETWEEN 0 AND 1440),
    plg_du       DATE,
    plg_au       DATE,
    CONSTRAINT ck_plg_heures CHECK (plg_debut < plg_fin)
);
CREATE INDEX IF NOT EXISTS ix_plg_calendrier ON calendrier_plage (plg_cal_id);

-- Jours fermés : règle (DATE, ANNUEL, NIEME, DERNIER, PAQUES, PERIODE) ; portée : société (type nul), un calendrier
-- (type 'calendrier') ou un élément de l'application ('service'…) ; zone du catalogue proposé (NATIONAL, ALSACE_MOSELLE,
-- outre-mer) ou nulle pour une règle saisie.
CREATE TABLE IF NOT EXISTS jour_ferme (
    jfe_id            SERIAL        PRIMARY KEY,
    jfe_code          VARCHAR(30),
    jfe_libelle       VARCHAR(100)  NOT NULL,
    jfe_regle         VARCHAR(10)   NOT NULL CHECK (jfe_regle IN ('DATE', 'ANNUEL', 'NIEME', 'DERNIER', 'PAQUES', 'PERIODE')),
    jfe_date          DATE,
    jfe_mois          INT,
    jfe_jour          INT,
    jfe_rang          INT,
    jfe_decalage      INT,
    jfe_du            DATE,
    jfe_au            DATE,
    jfe_zone          VARCHAR(20),
    jfe_type_element  VARCHAR(30),
    jfe_id_element    VARCHAR(50),
    jfe_actif         BOOLEAN       NOT NULL DEFAULT TRUE,
    jfe_maj_par       VARCHAR(50),
    jfe_maj_le        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_jfe_portee ON jour_ferme (jfe_type_element, jfe_id_element);
CREATE UNIQUE INDEX IF NOT EXISTS ux_jfe_code ON jour_ferme (jfe_code) WHERE jfe_code IS NOT NULL AND jfe_type_element IS NULL;

-- Catalogue des jours fériés français (P22) : nationaux actifs, Alsace-Moselle et outre-mer à cocher.
INSERT INTO jour_ferme (jfe_code, jfe_libelle, jfe_regle, jfe_mois, jfe_jour, jfe_decalage, jfe_zone, jfe_actif) VALUES
 ('JOUR_AN', 'Jour de l''an', 'ANNUEL', 1, 1, NULL, 'NATIONAL', TRUE),
 ('LUNDI_PAQUES', 'Lundi de Pâques', 'PAQUES', NULL, NULL, 1, 'NATIONAL', TRUE),
 ('FETE_TRAVAIL', 'Fête du travail', 'ANNUEL', 5, 1, NULL, 'NATIONAL', TRUE),
 ('VICTOIRE_1945', 'Victoire 1945', 'ANNUEL', 5, 8, NULL, 'NATIONAL', TRUE),
 ('ASCENSION', 'Ascension', 'PAQUES', NULL, NULL, 39, 'NATIONAL', TRUE),
 ('LUNDI_PENTECOTE', 'Lundi de Pentecôte', 'PAQUES', NULL, NULL, 50, 'NATIONAL', TRUE),
 ('FETE_NATIONALE', 'Fête nationale', 'ANNUEL', 7, 14, NULL, 'NATIONAL', TRUE),
 ('ASSOMPTION', 'Assomption', 'ANNUEL', 8, 15, NULL, 'NATIONAL', TRUE),
 ('TOUSSAINT', 'Toussaint', 'ANNUEL', 11, 1, NULL, 'NATIONAL', TRUE),
 ('ARMISTICE', 'Armistice 1918', 'ANNUEL', 11, 11, NULL, 'NATIONAL', TRUE),
 ('NOEL', 'Noël', 'ANNUEL', 12, 25, NULL, 'NATIONAL', TRUE),
 ('VENDREDI_SAINT', 'Vendredi saint', 'PAQUES', NULL, NULL, -2, 'ALSACE_MOSELLE', FALSE),
 ('SAINT_ETIENNE', 'Saint-Étienne', 'ANNUEL', 12, 26, NULL, 'ALSACE_MOSELLE', FALSE),
 ('ABOLITION_MAYOTTE', 'Abolition de l''esclavage (Mayotte)', 'ANNUEL', 4, 27, NULL, 'MAYOTTE', FALSE),
 ('ABOLITION_MARTINIQUE', 'Abolition de l''esclavage (Martinique)', 'ANNUEL', 5, 22, NULL, 'MARTINIQUE', FALSE),
 ('ABOLITION_GUADELOUPE', 'Abolition de l''esclavage (Guadeloupe)', 'ANNUEL', 5, 27, NULL, 'GUADELOUPE', FALSE),
 ('ABOLITION_ST_MARTIN', 'Abolition de l''esclavage (Saint-Martin)', 'ANNUEL', 5, 28, NULL, 'SAINT_MARTIN', FALSE),
 ('ABOLITION_GUYANE', 'Abolition de l''esclavage (Guyane)', 'ANNUEL', 6, 10, NULL, 'GUYANE', FALSE),
 ('ABOLITION_ST_BARTH', 'Abolition de l''esclavage (Saint-Barthélemy)', 'ANNUEL', 10, 9, NULL, 'SAINT_BARTHELEMY', FALSE),
 ('ABOLITION_REUNION', 'Abolition de l''esclavage (La Réunion)', 'ANNUEL', 12, 20, NULL, 'REUNION', FALSE)
ON CONFLICT DO NOTHING;

-- Calendriers proposés : 39 h (chantier, atelier), 35 h (bureau), cycle de 2 semaines en 4 × 10 h.
INSERT INTO calendrier (cal_code, cal_libelle, cal_cycle_semaines, cal_reference, cal_defaut) VALUES
 ('STANDARD', 'Standard 39 h (chantier, atelier)', 1, NULL, TRUE),
 ('BUREAU', 'Bureau 35 h', 1, NULL, FALSE),
 ('ALTERNE_4X10', 'Cycle de 2 semaines en 4 × 10 h', 2, DATE '2026-01-05', FALSE)
ON CONFLICT (cal_code) DO NOTHING;

INSERT INTO calendrier_plage (plg_cal_id, plg_semaine, plg_jour, plg_debut, plg_fin)
SELECT c.cal_id, p.semaine, p.jour, p.debut, p.fin
FROM calendrier c
JOIN (VALUES
    ('STANDARD', 1, 1, 480, 720), ('STANDARD', 1, 1, 780, 1020), ('STANDARD', 1, 2, 480, 720), ('STANDARD', 1, 2, 780, 1020),
    ('STANDARD', 1, 3, 480, 720), ('STANDARD', 1, 3, 780, 1020), ('STANDARD', 1, 4, 480, 720), ('STANDARD', 1, 4, 780, 1020),
    ('STANDARD', 1, 5, 480, 720), ('STANDARD', 1, 5, 780, 960),
    ('BUREAU', 1, 1, 540, 750), ('BUREAU', 1, 1, 840, 1050), ('BUREAU', 1, 2, 540, 750), ('BUREAU', 1, 2, 840, 1050),
    ('BUREAU', 1, 3, 540, 750), ('BUREAU', 1, 3, 840, 1050), ('BUREAU', 1, 4, 540, 750), ('BUREAU', 1, 4, 840, 1050),
    ('BUREAU', 1, 5, 540, 750), ('BUREAU', 1, 5, 840, 1050),
    ('ALTERNE_4X10', 1, 1, 420, 720), ('ALTERNE_4X10', 1, 1, 750, 1050), ('ALTERNE_4X10', 1, 2, 420, 720), ('ALTERNE_4X10', 1, 2, 750, 1050),
    ('ALTERNE_4X10', 1, 3, 420, 720), ('ALTERNE_4X10', 1, 3, 750, 1050), ('ALTERNE_4X10', 1, 4, 420, 720), ('ALTERNE_4X10', 1, 4, 750, 1050),
    ('ALTERNE_4X10', 2, 2, 420, 720), ('ALTERNE_4X10', 2, 2, 750, 1050), ('ALTERNE_4X10', 2, 3, 420, 720), ('ALTERNE_4X10', 2, 3, 750, 1050),
    ('ALTERNE_4X10', 2, 4, 420, 720), ('ALTERNE_4X10', 2, 4, 750, 1050), ('ALTERNE_4X10', 2, 5, 420, 720), ('ALTERNE_4X10', 2, 5, 750, 1050)
) AS p(code, semaine, jour, debut, fin) ON p.code = c.cal_code
WHERE NOT EXISTS (SELECT 1 FROM calendrier_plage x WHERE x.plg_cal_id = c.cal_id);
