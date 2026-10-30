-- =============================================================================
-- Cœur LogiBTP – application de terrain, lot 6 (ANALYSE-TERRAIN.md T20 ; Exécution E12, E20, E22) : compte rendu des
-- interventions SAV signé sur le terrain, affaire de gestion SAV (chantier « Entretien et dépannage » d'un client créé
-- depuis le terrain), droits des pièces créées par le serveur au profil système BORNE (le droit de la personne est
-- contrôlé par le nœud execution/sav, refusé par défaut : aucun profil ne le reçoit ici). Rejouable.
-- =============================================================================

INSERT INTO affaire (aff_code, aff_libelle, aff_nature, aff_commentaire)
VALUES ('SAV', 'Entretien et dépannage', 'G', 'Affaire de gestion du SAV : un chantier « Entretien et dépannage » par client sans chantier')
ON CONFLICT (aff_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS intervention_sav (
    isv_id          BIGSERIAL    PRIMARY KEY,
    isv_ent_id      BIGINT       NOT NULL REFERENCES document (ent_id) ON DELETE CASCADE,
    isv_le          DATE         NOT NULL DEFAULT current_date,
    isv_constat     TEXT         NOT NULL,
    isv_travaux     TEXT         NOT NULL,
    isv_fournitures JSONB        NOT NULL DEFAULT '[]',
    isv_terminee    BOOLEAN      NOT NULL DEFAULT TRUE,
    isv_absent      BOOLEAN      NOT NULL DEFAULT FALSE,
    isv_sig_id      BIGINT       REFERENCES signature (sig_id) ON DELETE SET NULL,
    isv_dge_id      BIGINT,
    isv_courriel    VARCHAR(200),
    isv_cree_par    VARCHAR(50)  NOT NULL,
    isv_cree_le     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE intervention_sav IS 'Compte rendu d''une intervention SAV sur le terrain (bon édité, signé et rangé dans la GED de l''ordre)';
CREATE INDEX IF NOT EXISTS ix_isv_ent ON intervention_sav (isv_ent_id);

-- Catégories GED du bon d'intervention et du PV de réception (lot 5) : proposées dans les listes.
UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"bon_sav","libelle":"Bon d''intervention SAV"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"bon_sav"}]'::jsonb;
UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"pv_reception","libelle":"PV de réception"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"pv_reception"}]'::jsonb;

INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT pro_id, 'documents/E/E_SAV', '{"CREER":"TOUT","MODIFIER":"TOUT","VALIDER":"TOUT"}'::jsonb FROM profil WHERE pro_code = 'BORNE'
ON CONFLICT DO NOTHING;
