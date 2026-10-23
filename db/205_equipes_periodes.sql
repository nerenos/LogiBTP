-- =============================================================================
-- Cœur – compositions des équipes datées par leur seul début (db/204) : chaque composition vaut jusqu'à la veille de
-- la suivante (ni trou ni chevauchement), commentaire d'aide-mémoire (contraintes des membres, binômes à éviter…) ;
-- commentaire et version de l'équipe (contrôle des modifications concurrentes ; verrou de modification dans
-- verrou_fiche, type « equipe »). Reprise : un début par borne des lignes existantes (entrée, lendemain de sortie).
-- Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS equipe_periode (
    eqp_id           SERIAL   PRIMARY KEY,
    eqp_equ_id       INT      NOT NULL REFERENCES equipe(equ_id) ON DELETE CASCADE,
    eqp_du           DATE     NOT NULL,
    eqp_commentaire  TEXT,
    CONSTRAINT ux_eqp_debut UNIQUE (eqp_equ_id, eqp_du)
);
COMMENT ON TABLE equipe_periode IS 'Compositions d''une équipe : début (la fin est la veille du début de la suivante) et commentaire ; membres dans equipe_composition';

ALTER TABLE equipe ADD COLUMN IF NOT EXISTS equ_commentaire TEXT;
ALTER TABLE equipe ADD COLUMN IF NOT EXISTS equ_version INT NOT NULL DEFAULT 1;
COMMENT ON COLUMN equipe.equ_commentaire IS 'Aide-mémoire de l''équipe (compétences, contraintes, binômes…)';
COMMENT ON COLUMN equipe.equ_version IS 'Version de l''équipe et de ses compositions, augmentée à chaque enregistrement (modifications concurrentes)';

INSERT INTO equipe_periode (eqp_equ_id, eqp_du)
SELECT DISTINCT c.eqc_equ_id, b.du
FROM equipe_composition c
CROSS JOIN LATERAL (VALUES (c.eqc_du), (c.eqc_au + 1)) AS b(du)
WHERE b.du IS NOT NULL
ON CONFLICT (eqp_equ_id, eqp_du) DO NOTHING;
