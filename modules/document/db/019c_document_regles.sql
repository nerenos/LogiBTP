-- =============================================================================
-- Module Document – règles des documents paramétrées à trois niveaux (CONCEPTION-REGLES-DOCUMENTS.md, § 6) :
-- global (famille et type nuls), famille (V, A, S) ou type de document ; le plus précis l'emporte, sinon la valeur par
-- défaut du catalogue (déclaré dans le code : module et spécialisation).
-- Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS regle_document (
    rdo_id       SERIAL       PRIMARY KEY,
    rdo_code     VARCHAR(40)  NOT NULL,
    rdo_famille  CHAR(1)      CHECK (rdo_famille IN ('V','A','S')),
    rdo_tyd_id   INT          REFERENCES type_document (tyd_id) ON DELETE CASCADE,
    rdo_valeur   JSONB        NOT NULL,
    rdo_actif    BOOLEAN      NOT NULL DEFAULT true,
    CONSTRAINT regle_document_niveau CHECK (rdo_tyd_id IS NULL OR rdo_famille IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_regle_document ON regle_document (rdo_code, coalesce(rdo_famille, ''), coalesce(rdo_tyd_id, 0));
