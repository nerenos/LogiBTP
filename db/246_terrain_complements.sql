-- =============================================================================
-- Cœur LogiBTP – application de terrain, lot 7 (ANALYSE-TERRAIN.md T7, T12, T18, T19) : pointage des matériels depuis
-- une tâche (heures d'engin ; relevés de source TERRAIN), réception de livraison simplifiée (nœud terrain/livraison,
-- profils du terrain ; bon de livraison créé en brouillon par le serveur au profil système BORNE). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pointage_materiel (
    pma_id          BIGSERIAL    PRIMARY KEY,
    pma_mat_id      INT          NOT NULL REFERENCES materiel (mat_id) ON DELETE CASCADE,
    pma_cha_id      INT          REFERENCES chantier (cha_id) ON DELETE SET NULL,
    pma_tac_id      BIGINT,
    pma_sal_id      INT,
    pma_date        DATE         NOT NULL,
    pma_minutes     INT          NOT NULL CHECK (pma_minutes > 0),
    pma_commentaire VARCHAR(200),
    pma_par         VARCHAR(50)  NOT NULL,
    pma_le          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE pointage_materiel IS 'Heures d''utilisation d''un matériel pointées sur le terrain, avec la tâche et le conducteur';
CREATE INDEX IF NOT EXISTS ix_pma_materiel ON pointage_materiel (pma_mat_id, pma_date);

ALTER TABLE materiel_releve DROP CONSTRAINT IF EXISTS materiel_releve_mre_source_check;
ALTER TABLE materiel_releve ADD CONSTRAINT materiel_releve_mre_source_check CHECK (mre_source IN ('SAISIE', 'CARBURANT', 'ORDRE', 'BORNE', 'REPRISE', 'TERRAIN'));

INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT pro_id, 'terrain/livraison', '{"CREER":"TOUT"}'::jsonb FROM profil WHERE pro_code IN ('MOBILE', 'CHEF_EQUIPE')
ON CONFLICT DO NOTHING;

-- Bon de livraison du terrain : créé par le serveur depuis la commande (transformer = consulter pour les droits), validé au bureau.
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT p.pro_id, n.noeud, n.actions::jsonb FROM profil p
CROSS JOIN (VALUES ('documents/A/A_COMMANDE', '{"CONSULTER":"TOUT"}'), ('documents/A/A_RECEPTION', '{"CREER":"TOUT","MODIFIER":"TOUT"}')) n(noeud, actions)
WHERE p.pro_code = 'BORNE'
ON CONFLICT (dpr_pro_id, dpr_noeud) DO UPDATE SET dpr_actions = droit_profil.dpr_actions || EXCLUDED.dpr_actions;
