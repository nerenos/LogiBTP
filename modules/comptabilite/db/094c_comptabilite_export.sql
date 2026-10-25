-- =============================================================================
-- Module Comptabilité (base, lot 3 ; ANALYSE-MODULE-COMPTABILITE.md § 4.6, § 6) : lots d'export des écritures (période,
-- types comptables, modèle de fichier, fichier produit, annulation) et pièces de chaque lot avec l'empreinte de leur
-- écriture (pièce modifiée depuis l'export : M12). Pièces désignées par leur identifiant dans l'application. Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS comptabilite_export (
    cex_id           BIGSERIAL     PRIMARY KEY,
    cex_le           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    cex_par          VARCHAR(100)  NOT NULL,
    cex_du           DATE,
    cex_au           DATE,
    cex_types        TEXT[]        NOT NULL DEFAULT '{}',
    cex_modele       JSONB         NOT NULL,
    cex_nb_pieces    INT           NOT NULL DEFAULT 0,
    cex_nb_lignes    INT           NOT NULL DEFAULT 0,
    cex_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
    cex_nom_fichier  VARCHAR(120)  NOT NULL,
    cex_contenu      BYTEA         NOT NULL,
    cex_annule_le    TIMESTAMPTZ,
    cex_annule_par   VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS comptabilite_export_piece (
    cep_cex_id       BIGINT        NOT NULL REFERENCES comptabilite_export(cex_id) ON DELETE CASCADE,
    cep_piece_id     BIGINT        NOT NULL,
    cep_numero       VARCHAR(40),
    cep_empreinte    VARCHAR(64)   NOT NULL,
    PRIMARY KEY (cep_cex_id, cep_piece_id)
);
CREATE INDEX IF NOT EXISTS ix_cep_piece ON comptabilite_export_piece (cep_piece_id);

-- Modèle de fichier retenu (Sage 100 par défaut, C13) : stocké dans les paramètres.
INSERT INTO parametre_comptabilite (pcp_cle, pcp_valeur) VALUES ('modele_export', '"SAGE100"') ON CONFLICT (pcp_cle) DO NOTHING;
