-- =============================================================================
-- Cœur – facturation électronique, lot 25 (plans/facturation-electronique.md, Q14) : rejet et refus d'une facture
-- émise → avoir interne d'annulation. Rejouable.
--
-- - document_fe_annulation : une ligne par facture émise rejetée (213) ou refusée (210) annulée, à la demande de
--   l'utilisateur, par un avoir interne (AnnulerParAvoirDans du module Document : lien ANNULATION, avoir daté du jour,
--   les deux pièces au statut Annulé) : avoir, transmission choisie (ARCHIVAGE_SEUL : déposé pour archivage seul, note
--   BAR ARCHIVEONLY et règle ArchiveOnly ; AUCUNE : non déposé, document_fe_emission HORS_FLUX motif AVOIR_INTERNE),
--   nouvelle facture copiée (brouillon) ou situation remise en cours (pièce d'avancement), auteur et date.
-- - V_FACTURE reçoit son type d'avoir (V_AVOIR) s'il n'en a pas.
-- - La suspension de relance d'une facture émise En litige (207, Q17) s'écrit dans relance_suspension (module Relances,
--   099t ; motif LITIGE, rsu_cree_par = facture_electronique), levée à Approuvée (205) : aucune table propre.
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_fe_annulation (
    dfa_ent_id        BIGINT       PRIMARY KEY REFERENCES document (ent_id) ON DELETE CASCADE,
    dfa_avoir_ent_id  BIGINT       NOT NULL UNIQUE REFERENCES document (ent_id) ON DELETE CASCADE,
    dfa_copie_ent_id  BIGINT       REFERENCES document (ent_id) ON DELETE SET NULL,
    dfa_statut        VARCHAR(10)  NOT NULL,
    dfa_transmission  VARCHAR(20)  NOT NULL,
    dfa_par           VARCHAR(50)  NOT NULL DEFAULT '',
    dfa_le            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
ALTER TABLE document_fe_annulation DROP CONSTRAINT IF EXISTS document_fe_annulation_transmission_check;
ALTER TABLE document_fe_annulation ADD CONSTRAINT document_fe_annulation_transmission_check
    CHECK (dfa_transmission IN ('ARCHIVAGE_SEUL', 'AUCUNE'));
ALTER TABLE document_fe_annulation DROP CONSTRAINT IF EXISTS document_fe_annulation_statut_check;
ALTER TABLE document_fe_annulation ADD CONSTRAINT document_fe_annulation_statut_check CHECK (dfa_statut IN ('210', '213'));
COMMENT ON TABLE document_fe_annulation IS 'Facture émise rejetée ou refusée annulée par un avoir interne (lot 25, Q14)';
COMMENT ON COLUMN document_fe_annulation.dfa_transmission IS 'ARCHIVAGE_SEUL : avoir déposé pour archivage seul (ARCHIVEONLY) ; AUCUNE : non déposé';
COMMENT ON COLUMN document_fe_annulation.dfa_copie_ent_id IS 'Nouvelle facture (copie en brouillon) ou situation remise en cours';

-- Facture simple : annulée par un avoir de vente (AnnulerParAvoirDans exige le type d'avoir du type de la pièce ; les
-- factures d'acompte et d'avancement ont le leur depuis 172 / 174).
UPDATE type_document t SET tyd_avoir_tyd_id = a.tyd_id
FROM type_document a
WHERE t.tyd_code = 'V_FACTURE' AND a.tyd_code = 'V_AVOIR' AND t.tyd_avoir_tyd_id IS NULL;
