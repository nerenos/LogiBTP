-- =============================================================================
-- Module Pointage, lot 3 : profils de paie (rubriques, règles typées : modules/pointage/js/src/paie.js ↔
-- ReglesPaie.cs), saisies des rubriques par jour, zones de déplacement par chantier et agence (validées), exports des
-- variables de paie (CSV), valorisation des heures (taux et coût gardés sur le pointage, avec leur source).
-- LogiBTP calcule des variables de paie, jamais un salaire (M1). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS poi_profil_paie (
    ppf_id      SERIAL PRIMARY KEY,
    ppf_code    VARCHAR(20) NOT NULL UNIQUE,
    ppf_libelle VARCHAR(80) NOT NULL,
    ppf_export  BOOLEAN     NOT NULL DEFAULT TRUE,
    ppf_ordre   INT         NOT NULL DEFAULT 0,
    ppf_actif   BOOLEAN     NOT NULL DEFAULT TRUE
);
COMMENT ON COLUMN poi_profil_paie.ppf_export IS 'Variables exportées vers la paie (intérim : non, contrôle des factures seulement)';

CREATE TABLE IF NOT EXISTS poi_rubrique (
    rub_id        SERIAL PRIMARY KEY,
    rub_ppf_id    INT         NOT NULL REFERENCES poi_profil_paie (ppf_id) ON DELETE CASCADE,
    rub_code      VARCHAR(20) NOT NULL,
    rub_libelle   VARCHAR(80) NOT NULL,
    rub_unite     VARCHAR(4)  NOT NULL DEFAULT 'H' CHECK (rub_unite IN ('H', 'NB', 'ZONE')),
    rub_saisie    VARCHAR(2)  NOT NULL DEFAULT 'C' CHECK (rub_saisie IN ('C', 'S', 'SC')),
    rub_code_paie VARCHAR(20),
    rub_ordre     INT         NOT NULL DEFAULT 0,
    UNIQUE (rub_ppf_id, rub_code)
);

CREATE TABLE IF NOT EXISTS poi_regle (
    prg_id         SERIAL PRIMARY KEY,
    prg_ppf_id     INT         NOT NULL REFERENCES poi_profil_paie (ppf_id) ON DELETE CASCADE,
    prg_type       VARCHAR(20) NOT NULL CHECK (prg_type IN ('CUMUL_HEURES', 'SEUIL_JOUR', 'TRANCHES_SEMAINE', 'ZONE', 'PLAFOND')),
    prg_rubrique   VARCHAR(20),
    prg_parametres JSONB       NOT NULL DEFAULT '{}',
    prg_ordre      INT         NOT NULL DEFAULT 0,
    prg_actif      BOOLEAN     NOT NULL DEFAULT TRUE
);

-- Saisies des rubriques S et SC (grand déplacement, intempéries, panier imposé…) par salarié et par jour.
CREATE TABLE IF NOT EXISTS poi_valeur (
    pva_sal_id    INT         NOT NULL,
    pva_date      DATE        NOT NULL,
    pva_rubrique  VARCHAR(20) NOT NULL,
    pva_valeur    INT         NOT NULL,
    pva_par       VARCHAR(50) NOT NULL,
    pva_le        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (pva_sal_id, pva_date, pva_rubrique)
);

-- Zone de déplacement d'un chantier pour une agence (M4, M16) : saisie d'avance ou validée depuis la synthèse.
CREATE TABLE IF NOT EXISTS poi_zone_chantier (
    pzc_cha_id     INT         NOT NULL,
    pzc_agence     VARCHAR(60) NOT NULL,
    pzc_zone       SMALLINT    NOT NULL CHECK (pzc_zone BETWEEN 0 AND 9),
    pzc_valide_par VARCHAR(50) NOT NULL,
    pzc_valide_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (pzc_cha_id, pzc_agence)
);
COMMENT ON COLUMN poi_zone_chantier.pzc_zone IS '0 = hors zone (pas d''indemnité)';

CREATE TABLE IF NOT EXISTS poi_export (
    pex_id       BIGSERIAL PRIMARY KEY,
    pex_du       DATE        NOT NULL,
    pex_au       DATE        NOT NULL,
    pex_service  INT,
    pex_salaries INT[]       NOT NULL DEFAULT '{}',
    pex_lignes   INT         NOT NULL,
    pex_contenu  TEXT        NOT NULL,
    pex_par      VARCHAR(50) NOT NULL,
    pex_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE poi_pointage ADD COLUMN IF NOT EXISTS poi_taux NUMERIC(12, 4);
ALTER TABLE poi_pointage ADD COLUMN IF NOT EXISTS poi_cout NUMERIC(14, 2);
ALTER TABLE poi_pointage ADD COLUMN IF NOT EXISTS poi_valorisation VARCHAR(20);
ALTER TABLE poi_pointage ADD COLUMN IF NOT EXISTS poi_valorise_le TIMESTAMPTZ;
COMMENT ON COLUMN poi_pointage.poi_valorisation IS 'Source du taux : SALARIE (coût horaire de la fiche), INTERIM (taux de la mission), IMPORT (coût réel après la paie)';

-- Profils fournis : ouvriers (heures, trajet, panier, heures supplémentaires, zones), ETAM, intérim (sans export).
INSERT INTO poi_profil_paie (ppf_code, ppf_libelle, ppf_export, ppf_ordre) VALUES
 ('OUVRIER', 'Ouvriers du bâtiment', TRUE, 10),
 ('ETAM', 'Employés, techniciens, agents de maîtrise', TRUE, 20),
 ('INTERIM', 'Intérimaires (contrôle des factures)', FALSE, 30)
ON CONFLICT (ppf_code) DO NOTHING;

INSERT INTO poi_rubrique (rub_ppf_id, rub_code, rub_libelle, rub_unite, rub_saisie, rub_code_paie, rub_ordre)
SELECT p.ppf_id, r.code, r.libelle, r.unite, r.saisie, r.paie, r.ordre
FROM poi_profil_paie p
JOIN (VALUES
    ('OUVRIER', 'HN', 'Heures normales', 'H', 'C', '1000', 10),
    ('OUVRIER', 'TRAJET', 'Heures de trajet', 'H', 'C', '1100', 20),
    ('OUVRIER', 'HS25', 'Heures supplémentaires à 25 %', 'H', 'C', '1225', 30),
    ('OUVRIER', 'HS50', 'Heures supplémentaires à 50 %', 'H', 'C', '1250', 40),
    ('OUVRIER', 'PANIER', 'Indemnité de repas (panier)', 'NB', 'SC', '3000', 50),
    ('OUVRIER', 'GD', 'Grand déplacement', 'NB', 'S', '3100', 60),
    ('OUVRIER', 'ZONE', 'Zone de déplacement', 'ZONE', 'C', '32', 70),
    ('OUVRIER', 'INTEMP', 'Heures d''intempéries', 'H', 'S', '1500', 80),
    ('OUVRIER', 'ABS', 'Heures d''absence', 'H', 'S', '1600', 90),
    ('ETAM', 'HN', 'Heures normales', 'H', 'C', '1000', 10),
    ('ETAM', 'HS25', 'Heures supplémentaires à 25 %', 'H', 'C', '1225', 30),
    ('ETAM', 'HS50', 'Heures supplémentaires à 50 %', 'H', 'C', '1250', 40),
    ('ETAM', 'PANIER', 'Indemnité de repas', 'NB', 'SC', '3000', 50),
    ('ETAM', 'ABS', 'Heures d''absence', 'H', 'S', '1600', 90),
    ('INTERIM', 'HN', 'Heures', 'H', 'C', NULL, 10)
) AS r(profil, code, libelle, unite, saisie, paie, ordre) ON r.profil = p.ppf_code
WHERE NOT EXISTS (SELECT 1 FROM poi_rubrique x WHERE x.rub_ppf_id = p.ppf_id);

INSERT INTO poi_regle (prg_ppf_id, prg_type, prg_rubrique, prg_parametres, prg_ordre)
SELECT p.ppf_id, r.type, r.rubrique, r.parametres::jsonb, r.ordre
FROM poi_profil_paie p
JOIN (VALUES
    ('OUVRIER', 'CUMUL_HEURES', 'HN', '{"exclure": ["TRAJET"]}', 10),
    ('OUVRIER', 'CUMUL_HEURES', 'TRAJET', '{"sous_types": ["TRAJET"]}', 20),
    ('OUVRIER', 'SEUIL_JOUR', 'PANIER', '{"base": "HN", "seuil": 360, "valeur": 1, "exclu_si": ["GD"]}', 30),
    ('OUVRIER', 'TRANCHES_SEMAINE', NULL, '{"base": "HN", "seuil": 2100, "deduire": true, "tranches": [{"rubrique": "HS25", "jusqu_a": 480}, {"rubrique": "HS50"}]}', 40),
    ('OUVRIER', 'ZONE', 'ZONE', '{"exclu_si": ["GD"]}', 50),
    ('ETAM', 'CUMUL_HEURES', 'HN', '{}', 10),
    ('ETAM', 'SEUIL_JOUR', 'PANIER', '{"base": "HN", "seuil": 360, "valeur": 1}', 20),
    ('ETAM', 'TRANCHES_SEMAINE', NULL, '{"base": "HN", "seuil": 2100, "deduire": true, "tranches": [{"rubrique": "HS25", "jusqu_a": 480}, {"rubrique": "HS50"}]}', 30),
    ('INTERIM', 'CUMUL_HEURES', 'HN', '{}', 10)
) AS r(profil, type, rubrique, parametres, ordre) ON r.profil = p.ppf_code
WHERE NOT EXISTS (SELECT 1 FROM poi_regle x WHERE x.prg_ppf_id = p.ppf_id);
