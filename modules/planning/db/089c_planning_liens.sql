-- =============================================================================
-- Module Planning, lot 5 : dépendances entre tâches (fin → début ou début → début, décalage en jours calendaires ou
-- ouvrés, fixe ou alerte, P9), série des tâches répétitives, jalons saisis (les jalons calculés — fins de chantier,
-- d'ordre… — viennent de l'application). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pla_dependance (
    dep_id       BIGSERIAL PRIMARY KEY,
    dep_de       BIGINT      NOT NULL REFERENCES pla_tache (tac_id) ON DELETE CASCADE,
    dep_vers     BIGINT      NOT NULL REFERENCES pla_tache (tac_id) ON DELETE CASCADE,
    dep_type     VARCHAR(2)  NOT NULL CHECK (dep_type IN ('FD', 'DD')),
    dep_decalage SMALLINT    NOT NULL DEFAULT 0,
    dep_unite    VARCHAR(3)  NOT NULL DEFAULT 'CAL' CHECK (dep_unite IN ('CAL', 'OUV')),
    dep_mode     VARCHAR(6)  NOT NULL DEFAULT 'FIXE' CHECK (dep_mode IN ('FIXE', 'ALERTE')),
    UNIQUE (dep_de, dep_vers),
    CHECK (dep_de <> dep_vers)
);
CREATE INDEX IF NOT EXISTS ix_dep_vers ON pla_dependance (dep_vers);

ALTER TABLE pla_tache ADD COLUMN IF NOT EXISTS tac_serie UUID;
COMMENT ON COLUMN pla_tache.tac_serie IS 'Série des tâches répétitives (absences, réunions) créées ensemble';
CREATE INDEX IF NOT EXISTS ix_tac_serie ON pla_tache (tac_serie) WHERE tac_serie IS NOT NULL;

CREATE TABLE IF NOT EXISTS pla_jalon (
    jal_id           BIGSERIAL PRIMARY KEY,
    jal_quand        TIMESTAMP(0) NOT NULL,
    jal_type         VARCHAR(20)  NOT NULL DEFAULT 'AUTRE' CHECK (jal_type IN ('LIVRAISON', 'FIN_CHANTIER', 'FIN_ORDRE', 'ALERTE', 'INTERVENTION', 'AUTRE')),
    jal_libelle      VARCHAR(200) NOT NULL,
    jal_type_element VARCHAR(30),
    jal_id_element   VARCHAR(40),
    jal_srv_id       INT,
    jal_cree_par     VARCHAR(50)  NOT NULL,
    jal_cree_le      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_jal_quand ON pla_jalon (jal_quand);
