-- =============================================================================
-- Cœur LogiBTP – application de terrain, lot 2 (ANALYSE-TERRAIN.md, T4, T22) : saisie libre du terrain (nœud
-- « pointage/saisie_libre », portée SOI : seul, EQUIPE : le chef compose l'équipe de la tâche) ; profil système
-- CHEF_EQUIPE (ses pointages et ceux de ses équipes du jour, saisie libre en équipe, terrain). Rejouable.
-- =============================================================================

INSERT INTO profil (pro_code, pro_libelle, pro_description, pro_systeme, pro_total) VALUES
 ('CHEF_EQUIPE', 'Chef d''équipe', 'Pointage de ses heures et de celles de ses équipes du jour, saisie libre en équipe sur le terrain', TRUE, FALSE)
ON CONFLICT (pro_code) DO NOTHING;

INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT p.pro_id, n.noeud, n.actions::jsonb FROM profil p
CROSS JOIN (VALUES
    ('pointage', '{"CONSULTER":"EQUIPE","MODIFIER":"EQUIPE","CREER":"EQUIPE","SUPPRIMER":"EQUIPE"}'),
    ('pointage/saisie_libre', '{"CREER":"EQUIPE"}'),
    ('terrain', '{"CONSULTER":"TOUT"}')) n(noeud, actions)
WHERE p.pro_code = 'CHEF_EQUIPE'
ON CONFLICT DO NOTHING;

-- Saisie mobile : saisie libre pour soi seul.
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT pro_id, 'pointage/saisie_libre', '{"CREER":"SOI"}'::jsonb FROM profil WHERE pro_code = 'MOBILE'
ON CONFLICT DO NOTHING;
