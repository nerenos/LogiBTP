-- =============================================================================
-- Module Document – avancement (CONCEPTION-ACHATS-MARCHES.md, Q24 à Q31) : situations (cumul, non comptables) et
-- factures d'avancement (période = cumul − précédent). Saisie par ligne en % (P), quantité (Q) ou montant (M) ;
-- montant et quantité de la ligne du marché ; précédent (dernier document d'avancement validé de la même ligne
-- du marché) ; cumul calculé par les moteurs. Rejouable (IF NOT EXISTS).
-- =============================================================================

-- Type : S situation (cumul), F facture d'avancement (période), R reprise d'avancement (cumul précédent, non comptable).
ALTER TABLE type_document ADD COLUMN IF NOT EXISTS tyd_avancement CHAR(1) CHECK (tyd_avancement IN ('S','F','R'));

-- Document : présentation (C cumul, P période) ; dépassement du montant du marché permis (option du marché).
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_avt_presentation CHAR(1) CHECK (ent_avt_presentation IN ('C','P'));
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_avt_depassement BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_mode CHAR(1) CHECK (lig_avt_mode IN ('P','Q','M'));
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_valeur NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_qte_marche NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_montant_marche NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_montant_precedent NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_qte_precedent NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_pct_precedent NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_montant_cumul NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_qte_cumul NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_pct NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_avt_source_lig_id BIGINT REFERENCES document_ligne(lig_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_lig_avt_source ON document_ligne (lig_avt_source_lig_id) WHERE lig_avt_source_lig_id IS NOT NULL;
