-- =============================================================================
-- Module Édition – file des productions du serveur (Q15) : PDF produits en tâche de fond (moteur JS dans Jint) puis
-- remis à l'application (dépôt en GED, coffre-fort des pièces comptables). Rejouable.
--   ett_motif : VALIDATION (pièce validée), ENVOI, DEMANDE (bouton « Ranger en GED »), LOT.
--   ett_etat  : A_FAIRE, EN_COURS, FAIT, ECHEC (ett_erreur ; trois essais au plus).
-- Une tâche s'insère dans la transaction de l'événement (validation) : rien n'est produit si celle-ci échoue.
-- =============================================================================
CREATE TABLE IF NOT EXISTS edition_tache (
    ett_id            BIGSERIAL     PRIMARY KEY,
    ett_source        VARCHAR(50)   NOT NULL,
    ett_id_element    VARCHAR(100)  NOT NULL,
    ett_modele        VARCHAR(80),
    ett_presentation  VARCHAR(80),
    ett_motif         VARCHAR(20)   NOT NULL DEFAULT 'DEMANDE' CHECK (ett_motif IN ('VALIDATION', 'ENVOI', 'DEMANDE', 'LOT')),
    ett_coffre        BOOLEAN       NOT NULL DEFAULT FALSE,
    ett_etat          VARCHAR(10)   NOT NULL DEFAULT 'A_FAIRE' CHECK (ett_etat IN ('A_FAIRE', 'EN_COURS', 'FAIT', 'ECHEC')),
    ett_essais        SMALLINT      NOT NULL DEFAULT 0,
    ett_erreur        TEXT,
    ett_ged_id        BIGINT,
    ett_pages         INTEGER,
    ett_demande_par   VARCHAR(50)   NOT NULL DEFAULT '',
    ett_cree_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ett_traite_le     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_ett_a_faire ON edition_tache (ett_cree_le) WHERE ett_etat IN ('A_FAIRE', 'EN_COURS');
CREATE INDEX IF NOT EXISTS ix_ett_element ON edition_tache (ett_source, ett_id_element);
