-- =============================================================================
-- Module Pointage, lot 1 : paramètres de la société, sous-types de main-d'œuvre (le type est une nature du
-- regroupement main-d'œuvre, fournie par l'application), pointages saisis (couche SAISIE ; la couche VALIDE du lot 2
-- copie une ligne saisie : poi_origine_id). Salariés, chantiers, ordres et natures désignés par leur identifiant ;
-- clés étrangères posées par l'application. Durées en minutes, heures de début et de fin en minutes depuis minuit.
-- Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS poi_parametre (
    ppa_id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (ppa_id = 1),
    ppa_ordre_nom         VARCHAR(2)  NOT NULL DEFAULT 'NP' CHECK (ppa_ordre_nom IN ('NP', 'PN')),
    ppa_pas_minutes       SMALLINT    NOT NULL DEFAULT 15 CHECK (ppa_pas_minutes BETWEEN 0 AND 60),
    ppa_amplitude_jour    SMALLINT    NOT NULL DEFAULT 600 CHECK (ppa_amplitude_jour BETWEEN 0 AND 1440),
    ppa_amplitude_semaine SMALLINT    NOT NULL DEFAULT 2880 CHECK (ppa_amplitude_semaine BETWEEN 0 AND 10080),
    ppa_validation        VARCHAR(6)  NOT NULL DEFAULT 'SIMPLE' CHECK (ppa_validation IN ('SIMPLE', 'DOUBLE')),
    ppa_blocage           VARCHAR(7)  NOT NULL DEFAULT 'SEMAINE' CHECK (ppa_blocage IN ('JOUR', 'SEMAINE')),
    ppa_interim_imputes   BOOLEAN     NOT NULL DEFAULT FALSE,
    ppa_maj_par           VARCHAR(50),
    ppa_maj_le            TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN poi_parametre.ppa_interim_imputes IS 'Pointages des intérimaires imputés aux chantiers avec un coût (sinon : contrôle des factures d''intérim seulement)';
INSERT INTO poi_parametre (ppa_id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS poi_sous_type (
    pst_code           VARCHAR(20) PRIMARY KEY,
    pst_libelle        VARCHAR(80) NOT NULL,
    pst_productif      BOOLEAN     NOT NULL DEFAULT TRUE,
    pst_non_conformite BOOLEAN     NOT NULL DEFAULT FALSE,
    pst_ordre          INT         NOT NULL DEFAULT 0,
    pst_actif          BOOLEAN     NOT NULL DEFAULT TRUE
);
COMMENT ON COLUMN poi_sous_type.pst_non_conformite IS 'Non-conformité : motif obligatoire sur le pointage';
INSERT INTO poi_sous_type (pst_code, pst_libelle, pst_productif, pst_non_conformite, pst_ordre) VALUES
 ('PRODUCTION', 'Production', TRUE, FALSE, 10),
 ('PREPARATION', 'Préparation', TRUE, FALSE, 20),
 ('TRAJET', 'Trajet', FALSE, FALSE, 30),
 ('ATTENTE', 'Attente', FALSE, FALSE, 40),
 ('NETTOYAGE', 'Nettoyage, rangement', FALSE, FALSE, 50),
 ('NON_CONFORMITE', 'Non-conformité', FALSE, TRUE, 60)
ON CONFLICT (pst_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS poi_pointage (
    poi_id          BIGSERIAL PRIMARY KEY,
    poi_couche      VARCHAR(6)  NOT NULL DEFAULT 'SAISIE' CHECK (poi_couche IN ('SAISIE', 'VALIDE')),
    poi_origine_id  BIGINT REFERENCES poi_pointage (poi_id) ON DELETE SET NULL,
    poi_sal_id      INT         NOT NULL,
    poi_date        DATE        NOT NULL,
    poi_cha_id      INT         NOT NULL,
    poi_ent_id      BIGINT,
    poi_lig_id      BIGINT,
    poi_type_mo     INT         NOT NULL,
    poi_sous_type   VARCHAR(20) REFERENCES poi_sous_type (pst_code),
    poi_debut       SMALLINT CHECK (poi_debut BETWEEN 0 AND 1440),
    poi_fin         SMALLINT CHECK (poi_fin BETWEEN 0 AND 1440),
    poi_minutes     SMALLINT    NOT NULL CHECK (poi_minutes BETWEEN 1 AND 1440),
    poi_motif       VARCHAR(200),
    poi_commentaire TEXT,
    poi_groupe      UUID,
    poi_tac_id      BIGINT,
    poi_saisi_par   VARCHAR(50) NOT NULL,
    poi_saisi_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
    poi_appareil    VARCHAR(80),
    poi_version     INT         NOT NULL DEFAULT 1
);
COMMENT ON COLUMN poi_pointage.poi_type_mo IS 'Type de main-d''œuvre = nature du regroupement main-d''œuvre (identifiant de l''application)';
COMMENT ON COLUMN poi_pointage.poi_groupe IS 'Saisie d''équipe : pointages créés ensemble (lot 4)';
COMMENT ON COLUMN poi_pointage.poi_tac_id IS 'Tâche du planning d''origine (lot 5)';
CREATE INDEX IF NOT EXISTS ix_poi_sal_date ON poi_pointage (poi_sal_id, poi_date);
CREATE INDEX IF NOT EXISTS ix_poi_cha ON poi_pointage (poi_cha_id, poi_date);
CREATE INDEX IF NOT EXISTS ix_poi_ent ON poi_pointage (poi_ent_id) WHERE poi_ent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_poi_origine ON poi_pointage (poi_origine_id) WHERE poi_origine_id IS NOT NULL;
