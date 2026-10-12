-- =============================================================================
-- Module Bibliothèque – coefficients de frais généraux et de bénéfice par période (globaux ou propres à une nature),
-- types de nature, coefficients imposés par élément.
-- Un élément prend les coefficients de sa nature en vigueur, sinon les coefficients globaux, sinon les coefficients
-- par défaut des paramètres ; il peut imposer les siens (ele_coef_fg_impose, ele_coef_benef_impose). Une période ne
-- se modifie pas une fois commencée : on en crée une nouvelle (historique conservé).
-- =============================================================================

CREATE TABLE coefficient_periode (
    cop_id          SERIAL        PRIMARY KEY,
    cop_nat_id      INT           REFERENCES nature_element(nat_id) ON DELETE CASCADE,   -- null : coefficients globaux
    cop_debut       DATE          NOT NULL,
    cop_coef_fg     NUMERIC(12,6) CHECK (cop_coef_fg > 0),       -- null : repris de la portée supérieure
    cop_coef_benef  NUMERIC(12,6) CHECK (cop_coef_benef > 0),
    cop_commentaire TEXT,
    cop_cree_le     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    cop_cree_par    VARCHAR(50),
    CHECK (cop_coef_fg IS NOT NULL OR cop_coef_benef IS NOT NULL)
);
CREATE UNIQUE INDEX ux_cop_portee_debut ON coefficient_periode (coalesce(cop_nat_id, 0), cop_debut);

-- Types de nature (MO, ENGIN, MATERIAUX, SOUS_TRAITANCE, FRAIS, FACTURATION_INTERNE, AMORTISSEMENT, DIVERS), à cocher.
ALTER TABLE nature_element ADD COLUMN IF NOT EXISTS nat_types JSONB NOT NULL DEFAULT '[]';

ALTER TABLE element
    ADD COLUMN IF NOT EXISTS ele_coef_fg_impose    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ele_coef_benef_impose BOOLEAN NOT NULL DEFAULT FALSE;
