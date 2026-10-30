-- =============================================================================
-- Cœur LogiBTP – application de terrain, lot 1 (ANALYSE-TERRAIN.md) : nœud de droits « terrain » (tâches du planning
-- de la personne connectée, partie mobile, pièces « Terrain » de la GED), consulté par le profil MOBILE. Rejouable.
-- =============================================================================

INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT pro_id, 'terrain', '{"CONSULTER":"TOUT"}'::jsonb FROM profil WHERE pro_code IN ('MOBILE', 'SAISIE')
ON CONFLICT DO NOTHING;
