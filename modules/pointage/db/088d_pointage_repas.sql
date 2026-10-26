-- =============================================================================
-- Module Pointage – repas au restaurant (analyse des demandes du 25/10/2026, lot 10, A29). Rejouable.
--   poi_repas : un repas par salarié et par jour, saisi au bureau ou à la borne ; restaurant = identifiant fourni par
--   l'application (cœur : tiers de l'annuaire de relation RESTAURANT, clé étrangère posée par db/239), libellé recopié ;
--   chantier du jour (proposition des restaurants proches). Lu par la règle de paie REPAS (avantage en nature par agence).
-- =============================================================================

CREATE TABLE IF NOT EXISTS poi_repas (
    prp_id                 BIGSERIAL     PRIMARY KEY,
    prp_sal_id             INTEGER       NOT NULL,
    prp_date               DATE          NOT NULL,
    prp_restaurant_id      BIGINT,
    prp_restaurant_libelle VARCHAR(150)  NOT NULL,
    prp_cha_id             INTEGER,
    prp_commentaire        VARCHAR(300),
    prp_appareil           VARCHAR(100),
    prp_par                VARCHAR(50)   NOT NULL,
    prp_le                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uq_prp_salarie_jour UNIQUE (prp_sal_id, prp_date)
);
CREATE INDEX IF NOT EXISTS ix_prp_restaurant ON poi_repas (prp_restaurant_id);
COMMENT ON TABLE poi_repas IS 'Repas au restaurant d''un salarié (un par jour) : règle de paie REPAS';

-- Règle de paie REPAS (avantage en nature par agence) acceptée par la contrainte des types de règles.
ALTER TABLE poi_regle DROP CONSTRAINT IF EXISTS poi_regle_prg_type_check;
ALTER TABLE poi_regle ADD CONSTRAINT poi_regle_prg_type_check
    CHECK (prg_type IN ('CUMUL_HEURES', 'SEUIL_JOUR', 'TRANCHES_SEMAINE', 'ZONE', 'PLAFOND', 'REPAS'));
