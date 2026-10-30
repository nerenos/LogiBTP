-- =============================================================================
-- Cœur LogiBTP – application de terrain, lot 5 (ANALYSE-TERRAIN.md T14 à T16) : signatures simples (image tracée,
-- nom et qualité du signataire, horodatage du serveur, empreinte SHA-256 du PDF signé rangé en GED) et réceptions
-- de pose (état, réserves, motif d'un refus) ; motif de blocage d'un ordre dont la réception est refusée. Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS signature (
    sig_id            BIGSERIAL    PRIMARY KEY,
    sig_type_element  VARCHAR(30)  NOT NULL,
    sig_id_element    VARCHAR(40)  NOT NULL,
    sig_nom           VARCHAR(150) NOT NULL,
    sig_qualite       VARCHAR(100),
    sig_image         BYTEA,
    sig_le            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    sig_par           VARCHAR(50)  NOT NULL,
    sig_empreinte     CHAR(64),
    sig_dge_id        BIGINT
);
COMMENT ON TABLE signature IS 'Signature simple d''un élément : image PNG tracée sur l''écran, signataire, horodatage du serveur, empreinte du PDF signé (GED)';
CREATE INDEX IF NOT EXISTS ix_sig_element ON signature (sig_type_element, sig_id_element);

CREATE TABLE IF NOT EXISTS reception_pose (
    rec_id         BIGSERIAL    PRIMARY KEY,
    rec_ent_id     BIGINT       NOT NULL REFERENCES document (ent_id) ON DELETE CASCADE,
    rec_le         DATE         NOT NULL DEFAULT current_date,
    rec_etat       VARCHAR(15)  NOT NULL CHECK (rec_etat IN ('SANS_RESERVE', 'AVEC_RESERVES', 'REFUSEE')),
    rec_reserves   JSONB        NOT NULL DEFAULT '[]',
    rec_motif      TEXT,
    rec_sig_id     BIGINT       REFERENCES signature (sig_id) ON DELETE SET NULL,
    rec_dge_id     BIGINT,
    rec_courriel   VARCHAR(200),
    rec_cree_par   VARCHAR(50)  NOT NULL,
    rec_cree_le    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE reception_pose IS 'Réception d''un ordre de pose signée sur le terrain (PV édité et rangé dans la GED de l''ordre)';
CREATE INDEX IF NOT EXISTS ix_rec_ent ON reception_pose (rec_ent_id);

INSERT INTO motif (mot_domaine, mot_code, mot_libelle, mot_ordre)
VALUES ('BLOCAGE', 'RECEPTION_REFUSEE', 'Réception refusée par le client', 90)
ON CONFLICT (mot_domaine, mot_code) DO NOTHING;

-- Demande d'approvisionnement depuis le terrain (T18) : création et enregistrement d'un ordre E_DAP par les profils du
-- terrain (la consultation des documents reste refusée).
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT pro_id, 'documents/E/E_DAP', '{"CREER":"TOUT","MODIFIER":"TOUT"}'::jsonb FROM profil WHERE pro_code IN ('MOBILE', 'CHEF_EQUIPE')
ON CONFLICT DO NOTHING;
