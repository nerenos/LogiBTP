-- =============================================================================
-- Cœur LogiBTP – spécialisation BTP des modules Document et Métré.
-- Colonnes BTP du document et des lignes (DocumentBtp, DocumentLigneBtp, colonnes-btp.js),
-- règles propres au devis BTP et clés étrangères du module Métré vers le document.
-- =============================================================================

-- Entête : mode de calcul des ouvrages, coefficient de frais annexes.
ALTER TABLE document ADD COLUMN ent_mode_calcul_ouvrage CHAR(1)      NOT NULL DEFAULT 'V'
                            CHECK (ent_mode_calcul_ouvrage IN ('D','V'));
ALTER TABLE document ADD COLUMN ent_coef_fa             NUMERIC(18,6) NOT NULL DEFAULT 1;

-- Lignes : nature, poste, métré, perte, déboursé (PA, FG, PR, bénéfice), frais annexes, blocages de prix.
ALTER TABLE document_ligne ADD COLUMN lig_nat_id             INT;
ALTER TABLE document_ligne ADD COLUMN lig_ptv_id             INT;
ALTER TABLE document_ligne ADD COLUMN lig_mtr_id             BIGINT;
ALTER TABLE document_ligne ADD COLUMN lig_qte_source         CHAR(1)      NOT NULL DEFAULT 'S' CHECK (lig_qte_source IN ('S','M'));
ALTER TABLE document_ligne ADD COLUMN lig_qte_base           NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN lig_coef_perte         NUMERIC(18,6) NOT NULL DEFAULT 1;
ALTER TABLE document_ligne ADD COLUMN lig_pa                 NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN lig_coef_fg            NUMERIC(18,6) NOT NULL DEFAULT 1;
ALTER TABLE document_ligne ADD COLUMN lig_pr                 NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN lig_coef_benef         NUMERIC(18,6) NOT NULL DEFAULT 1;
ALTER TABLE document_ligne ADD COLUMN lig_coef_fa            NUMERIC(18,6) NOT NULL DEFAULT 1;
ALTER TABLE document_ligne ADD COLUMN lig_pv_affiche         NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN lig_pv_fixe            BOOLEAN      NOT NULL DEFAULT FALSE; -- PV avant frais annexes et remise
ALTER TABLE document_ligne ADD COLUMN lig_pv_affiche_fixe    BOOLEAN      NOT NULL DEFAULT FALSE; -- PV avec frais annexes
ALTER TABLE document_ligne ADD COLUMN lig_is_ecart_arrondi   BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE document_ligne ADD COLUMN lig_montant_pa         NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN lig_montant_pr         NUMERIC(18,6);
ALTER TABLE document_ligne ADD COLUMN lig_pied_is_fa         BOOLEAN      NOT NULL DEFAULT FALSE;

ALTER TABLE document_ligne ADD CONSTRAINT ck_lig_un_seul_blocage CHECK (NOT (lig_pv_fixe AND lig_pv_affiche_fixe));
CREATE UNIQUE INDEX ux_lig_ecart_arrondi ON document_ligne (lig_parent_id) WHERE lig_is_ecart_arrondi;

-- Module Métré branché sur le document.
ALTER TABLE metre ADD CONSTRAINT fk_mtr_ligne FOREIGN KEY (mtr_lig_id) REFERENCES document_ligne(lig_id) ON DELETE CASCADE;
ALTER TABLE variable_definition ADD CONSTRAINT fk_var_document FOREIGN KEY (var_ent_id) REFERENCES document(ent_id) ON DELETE CASCADE;
ALTER TABLE variable_definition ADD CONSTRAINT fk_var_ligne FOREIGN KEY (var_lig_id) REFERENCES document_ligne(lig_id) ON DELETE CASCADE;
