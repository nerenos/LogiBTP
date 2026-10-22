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
-- Affichage (paramètre global) : heures travaillées par l'entreprise (heures masquées à l'échelle de l'heure, en
-- minutes, heures entières) et jours masqués (le vendredi est travaillé par défaut ; un service qui ne travaille qu'un
-- vendredi sur deux l'a en absence dans son calendrier).
ALTER TABLE pla_parametre ADD COLUMN IF NOT EXISTS ppl_heure_debut SMALLINT NOT NULL DEFAULT 420;
ALTER TABLE pla_parametre ADD COLUMN IF NOT EXISTS ppl_heure_fin SMALLINT NOT NULL DEFAULT 1080;
ALTER TABLE pla_parametre ADD COLUMN IF NOT EXISTS ppl_masquer_vendredi BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pla_parametre ADD COLUMN IF NOT EXISTS ppl_masquer_samedi BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE pla_parametre ADD COLUMN IF NOT EXISTS ppl_masquer_dimanche BOOLEAN NOT NULL DEFAULT TRUE;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ppl_heures') THEN
        ALTER TABLE pla_parametre ADD CONSTRAINT ck_ppl_heures CHECK (ppl_heure_debut >= 0 AND ppl_heure_fin <= 1440 AND ppl_heure_debut < ppl_heure_fin
            AND ppl_heure_debut % 60 = 0 AND ppl_heure_fin % 60 = 0);
    END IF;
END $$;
COMMENT ON COLUMN pla_parametre.ppl_heure_debut IS 'Début des heures travaillées par l''entreprise (minutes depuis minuit) : avant, masqué à l''échelle de l''heure';
COMMENT ON COLUMN pla_parametre.ppl_heure_fin IS 'Fin des heures travaillées par l''entreprise (minutes depuis minuit) : après, masqué à l''échelle de l''heure';

INSERT INTO pla_parametre (ppl_id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS pla_notification (
    pno_cle   VARCHAR(200) PRIMARY KEY,
    pno_etat  VARCHAR(7)   NOT NULL CHECK (pno_etat IN ('VUE', 'TRAITEE')),
    pno_par   VARCHAR(50)  NOT NULL,
    pno_le    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE pla_notification IS 'États des notifications calculées du planning (sur-occupation, matériel, habilitation, équipe…) ; les notifications elles-mêmes ne sont pas stockées';
