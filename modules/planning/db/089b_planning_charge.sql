-- =============================================================================
-- Module Planning, lot 4 : paramètres (seuil de sous-occupation en % de la capacité, P14), acquittement des
-- notifications calculées (une clé par notification : vue ou traitée, pour ne pas réapparaître). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pla_parametre (
    ppl_id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (ppl_id = 1),
    ppl_sous_occupation   SMALLINT NOT NULL DEFAULT 40 CHECK (ppl_sous_occupation BETWEEN 0 AND 100),
    ppl_horizon_creneau   SMALLINT NOT NULL DEFAULT 60 CHECK (ppl_horizon_creneau BETWEEN 1 AND 365)
);
COMMENT ON COLUMN pla_parametre.ppl_sous_occupation IS 'Sous-occupation signalée quand le disponible d''un service dépasse ce pourcentage de sa capacité (jour ouvré)';
INSERT INTO pla_parametre (ppl_id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS pla_notification (
    pno_cle   VARCHAR(200) PRIMARY KEY,
    pno_etat  VARCHAR(7)   NOT NULL CHECK (pno_etat IN ('VUE', 'TRAITEE')),
    pno_par   VARCHAR(50)  NOT NULL,
    pno_le    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE pla_notification IS 'États des notifications calculées du planning (sur-occupation, matériel, habilitation, équipe…) ; les notifications elles-mêmes ne sont pas stockées';
