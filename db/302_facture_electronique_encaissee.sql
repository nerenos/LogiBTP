-- =============================================================================
-- Cœur – facturation électronique, lot 26 (plans/facturation-electronique.md, Q15 ; XP Z12-014 cas 26 et 34) : statut
-- Encaissée (212) d'une facture émise de services ou mixte sans TVA sur les débits. Rejouable.
--
-- - document_fe_encaissement : journal des encaissements déclarés, une ligne par écart d'un pointage (règlement reçu ×
--   échéance de la facture) traité depuis la liste à valider : montant pointé déclaré (signé : négatif = annulation
--   d'encaissement), montants encaissés par taux envoyés (ventilation JSON [{ taux, montant }]), état ENVOYE (statut 212
--   posé, CDAR en file : fe_statut et flux du CDAR) ou ECARTE (écarté par l'utilisateur, rien d'envoyé). Les propositions
--   ne sont pas stockées : pointages des règlements reçus (hors imputation) − encaissements déclarés, à chaque lecture ;
--   règlement et échéance sans clé étrangère (un règlement supprimé après l'envoi donne une annulation).
-- - document_fe_emission : données de la facture émise lues une fois dans son original (cadre BT-23, BT-8, devise, TTC
--   par taux) pour le flux dfe_lu_flux_id ; relues si le flux change.
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_fe_encaissement (
    dfn_id           BIGSERIAL     PRIMARY KEY,
    dfn_ent_id       BIGINT        NOT NULL REFERENCES document (ent_id) ON DELETE CASCADE,
    dfn_reg_id       BIGINT        NOT NULL,
    dfn_ech_id       BIGINT        NOT NULL,
    dfn_montant      NUMERIC(18,6) NOT NULL,
    dfn_ventilation  JSONB         NOT NULL DEFAULT '[]'::jsonb,
    dfn_etat         VARCHAR(10)   NOT NULL,
    dfn_fst_id       BIGINT        REFERENCES fe_statut (fst_id) ON DELETE SET NULL,
    dfn_flux_id      BIGINT        REFERENCES fe_flux (ffl_id) ON DELETE SET NULL,
    dfn_cree_par     VARCHAR(50)   NOT NULL DEFAULT '',
    dfn_cree_le      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
ALTER TABLE document_fe_encaissement DROP CONSTRAINT IF EXISTS document_fe_encaissement_etat_check;
ALTER TABLE document_fe_encaissement ADD CONSTRAINT document_fe_encaissement_etat_check CHECK (dfn_etat IN ('ENVOYE', 'ECARTE'));
CREATE INDEX IF NOT EXISTS ix_dfn_ent ON document_fe_encaissement (dfn_ent_id, dfn_reg_id, dfn_ech_id);
COMMENT ON TABLE document_fe_encaissement IS 'Encaissements déclarés d''une facture émise : statut Encaissée (212) envoyé ou écarté (lot 26, Q15)';
COMMENT ON COLUMN document_fe_encaissement.dfn_montant IS 'Écart pointé déclaré (règlement × échéance) ; négatif : annulation d''encaissement (cas 34)';
COMMENT ON COLUMN document_fe_encaissement.dfn_ventilation IS 'Montants encaissés par taux envoyés (MDT-215 / MDT-224) : [{ taux, montant }]';

ALTER TABLE document_fe_emission ADD COLUMN IF NOT EXISTS dfe_lu_flux_id  BIGINT;
ALTER TABLE document_fe_emission ADD COLUMN IF NOT EXISTS dfe_cadre       VARCHAR(3);
ALTER TABLE document_fe_emission ADD COLUMN IF NOT EXISTS dfe_exigibilite VARCHAR(3);
ALTER TABLE document_fe_emission ADD COLUMN IF NOT EXISTS dfe_devise      VARCHAR(3);
ALTER TABLE document_fe_emission ADD COLUMN IF NOT EXISTS dfe_ventilation JSONB;
COMMENT ON COLUMN document_fe_emission.dfe_lu_flux_id IS 'Flux dont l''original a donné dfe_cadre, dfe_exigibilite, dfe_devise, dfe_ventilation (lot 26)';
COMMENT ON COLUMN document_fe_emission.dfe_ventilation IS 'TTC par taux de la facture émise, du signe de ses échéances : [{ taux, montant }]';
