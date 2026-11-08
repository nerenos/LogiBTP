-- =============================================================================
-- Module Relances, lot 2 (plans/relances.md, ANALYSE-RELANCES.md) : règle par nature, lots de préparation, journal des
-- relances, suspensions. Rejouable.
--
-- Sans métier : le module ne connaît ni les pièces, ni les tiers, ni les personnes ; rel_ent_id, rel_ent_groupe_id
-- (groupe d'indices), rel_tiers_id, rel_charge_id, rel_ged_id, rel_courriel_id, rsu_ent_id et rsu_tiers_id sont des
-- identifiants de l'application, sans clé étrangère (le module ne dépend pas du module Document).
-- Le journal est la seule source des niveaux faits (Q14, Q22) : une relance ENVOYEE ou ATTENTE_NUMERO compte.
-- =============================================================================

-- Règle d'une nature (DEVIS, FACTURE) : niveaux [{ rang, delai, mode, modele_courriel, modele_edition }], répétition du
-- dernier niveau (Q4, Q5).
CREATE TABLE IF NOT EXISTS relance_regle (
    rrg_nature      VARCHAR(20)  PRIMARY KEY,
    rrg_niveaux     JSONB        NOT NULL,
    rrg_repeter     BOOLEAN      NOT NULL DEFAULT FALSE,
    rrg_intervalle  INT,
    rrg_modifie_le  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    rrg_modifie_par VARCHAR(50)  NOT NULL DEFAULT ''
);
ALTER TABLE relance_regle DROP CONSTRAINT IF EXISTS relance_regle_nature_check;
ALTER TABLE relance_regle ADD CONSTRAINT relance_regle_nature_check CHECK (rrg_nature IN ('DEVIS','FACTURE'));

-- Règle par défaut (Q4 : 15, 30, 60 jours ; dernier niveau d'une facture en recommandé, Q13) : ReglesRelance.RegleParDefaut.
INSERT INTO relance_regle (rrg_nature, rrg_niveaux) VALUES
    ('DEVIS',   '[{"rang":1,"delai":15,"mode":"COURRIEL"},{"rang":2,"delai":30,"mode":"COURRIEL"},{"rang":3,"delai":60,"mode":"COURRIEL"}]'),
    ('FACTURE', '[{"rang":1,"delai":15,"mode":"COURRIEL"},{"rang":2,"delai":30,"mode":"COURRIEL"},{"rang":3,"delai":60,"mode":"RECOMMANDE"}]')
ON CONFLICT (rrg_nature) DO NOTHING;

-- Lot de relances préparées puis validées (PREPARE : rien d'envoyé ; PARTIEL : une partie envoyée ; ENVOYE : clos).
CREATE TABLE IF NOT EXISTS relance_lot (
    rlo_id          BIGSERIAL    PRIMARY KEY,
    rlo_date        DATE         NOT NULL,
    rlo_cree_le     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    rlo_auteur      VARCHAR(50)  NOT NULL DEFAULT '',
    rlo_nombre      INT          NOT NULL DEFAULT 0,
    rlo_etat        VARCHAR(20)  NOT NULL DEFAULT 'PREPARE'
);
ALTER TABLE relance_lot DROP CONSTRAINT IF EXISTS relance_lot_etat_check;
ALTER TABLE relance_lot ADD CONSTRAINT relance_lot_etat_check CHECK (rlo_etat IN ('PREPARE','ENVOYE','PARTIEL'));
CREATE INDEX IF NOT EXISTS ix_relance_lot_etat ON relance_lot (rlo_etat);

-- Journal : une ligne par pièce relancée ; les pièces d'un même envoi (tiers, chargé, nature, mode) partagent rel_groupe
-- dans leur lot. Niveau propre de la pièce (Q10), répétition du dernier niveau, montant relancé (reste échu).
CREATE TABLE IF NOT EXISTS relance (
    rel_id            BIGSERIAL     PRIMARY KEY,
    rel_rlo_id        BIGINT        REFERENCES relance_lot (rlo_id) ON DELETE CASCADE,
    rel_groupe        INT           NOT NULL DEFAULT 0,
    rel_ent_id        BIGINT        NOT NULL,
    rel_ent_groupe_id BIGINT,
    rel_nature        VARCHAR(20)   NOT NULL,
    rel_tiers_id      BIGINT        NOT NULL,
    rel_charge_id     BIGINT,
    rel_niveau        INT           NOT NULL,
    rel_repetition    INT           NOT NULL DEFAULT 0,
    rel_mode          VARCHAR(20)   NOT NULL,
    rel_etat          VARCHAR(20)   NOT NULL DEFAULT 'PROPOSEE',
    rel_date          DATE          NOT NULL,
    rel_auteur        VARCHAR(50)   NOT NULL DEFAULT '',
    rel_montant       NUMERIC(18,6) NOT NULL DEFAULT 0,
    rel_jours         INT           NOT NULL DEFAULT 0,
    rel_courriel_id   BIGINT,
    rel_ged_id        BIGINT,
    rel_recommande    VARCHAR(50),
    rel_commentaire   TEXT,
    rel_cree_le       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
ALTER TABLE relance DROP CONSTRAINT IF EXISTS relance_nature_check;
ALTER TABLE relance ADD CONSTRAINT relance_nature_check CHECK (rel_nature IN ('DEVIS','FACTURE'));
ALTER TABLE relance DROP CONSTRAINT IF EXISTS relance_mode_check;
ALTER TABLE relance ADD CONSTRAINT relance_mode_check CHECK (rel_mode IN ('COURRIEL','COURRIER','RECOMMANDE','TACHE'));
ALTER TABLE relance DROP CONSTRAINT IF EXISTS relance_etat_check;
ALTER TABLE relance ADD CONSTRAINT relance_etat_check CHECK (rel_etat IN ('PROPOSEE','ENVOYEE','ATTENTE_NUMERO','ANNULEE'));
ALTER TABLE relance DROP CONSTRAINT IF EXISTS relance_niveau_check;
ALTER TABLE relance ADD CONSTRAINT relance_niveau_check CHECK (rel_niveau BETWEEN 1 AND 5);
CREATE INDEX IF NOT EXISTS ix_relance_piece ON relance (rel_ent_id);
CREATE INDEX IF NOT EXISTS ix_relance_groupe_indices ON relance (rel_ent_groupe_id);
CREATE INDEX IF NOT EXISTS ix_relance_tiers ON relance (rel_tiers_id, rel_date);
CREATE INDEX IF NOT EXISTS ix_relance_lot ON relance (rel_rlo_id, rel_groupe);

-- Suspension datée d'une pièce ou d'un tiers (Q7) : jusqu'au (compris), motif (LITIGE, PROMESSE, ECHELONNEMENT, AUTRE).
CREATE TABLE IF NOT EXISTS relance_suspension (
    rsu_id          BIGSERIAL    PRIMARY KEY,
    rsu_ent_id      BIGINT,
    rsu_tiers_id    BIGINT,
    rsu_jusqu_au    DATE         NOT NULL,
    rsu_motif       VARCHAR(20)  NOT NULL,
    rsu_commentaire TEXT,
    rsu_cree_le     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    rsu_cree_par    VARCHAR(50)  NOT NULL DEFAULT ''
);
ALTER TABLE relance_suspension DROP CONSTRAINT IF EXISTS relance_suspension_cible_check;
ALTER TABLE relance_suspension ADD CONSTRAINT relance_suspension_cible_check CHECK ((rsu_ent_id IS NULL) <> (rsu_tiers_id IS NULL));
ALTER TABLE relance_suspension DROP CONSTRAINT IF EXISTS relance_suspension_motif_check;
ALTER TABLE relance_suspension ADD CONSTRAINT relance_suspension_motif_check
    CHECK (rsu_motif IN ('LITIGE','PROMESSE','ECHELONNEMENT','AUTRE'));
CREATE INDEX IF NOT EXISTS ix_relance_suspension_piece ON relance_suspension (rsu_ent_id) WHERE rsu_ent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_relance_suspension_tiers ON relance_suspension (rsu_tiers_id) WHERE rsu_tiers_id IS NOT NULL;
