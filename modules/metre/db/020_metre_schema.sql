-- =============================================================================
-- Module Métré – métrés et variables de calcul (le script du métré : 021).
-- Le module ne connaît pas son hôte : mtr_lig_id, var_ent_id et var_lig_id désignent la ligne et
-- le document de l'application qui l'utilise ; les clés étrangères sont posées par celle-ci (db/100_btp.sql).
-- =============================================================================

CREATE TABLE metre (
    mtr_id           BIGSERIAL PRIMARY KEY,
    mtr_lig_id       BIGINT        NOT NULL,                       -- ligne de l’hôte
    mtr_libelle      VARCHAR(200),
    mtr_unt_code     VARCHAR(10),
    mtr_variable     VARCHAR(60),                                          -- affectation du résultat, ex. @surface
    mtr_resultat     NUMERIC(18,6)
);
CREATE INDEX ix_mtr_ligne ON metre (mtr_lig_id);

CREATE TABLE variable_definition (
    var_id           BIGSERIAL PRIMARY KEY,
    var_ent_id       BIGINT        NOT NULL,                       -- document de l’hôte
    var_lig_id       BIGINT,                                      -- ligne de l’hôte, NULL = document
    var_mtr_id       BIGINT        REFERENCES metre(mtr_id) ON DELETE CASCADE,   -- variable d'un script de métré
    var_portee       VARCHAR(2)    NOT NULL CHECK (var_portee IN ('$$','$','@@','@')),
    var_nom          VARCHAR(60)   NOT NULL,
    var_operation    VARCHAR(2)    NOT NULL CHECK (var_operation IN ('=','+=')),
    var_formule      TEXT          NOT NULL,
    var_ordre        INT           NOT NULL DEFAULT 0,
    var_valeur       NUMERIC(18,6)                                          -- dernière valeur calculée
);
CREATE INDEX ix_var_document ON variable_definition (var_ent_id);
