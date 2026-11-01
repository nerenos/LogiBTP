-- =============================================================================
-- Cœur LogiBTP – application de terrain (évolutions du 01/11/2026) : nœuds de droits des actions d'une tâche
-- « terrain/demande » (Consulter : onglet Mes demandes ; Créer : demande d'approvisionnement E_DAP),
-- « terrain/avancement » et « terrain/materiel » (Créer). Repris pour chaque profil qui a déjà le nœud « terrain »
-- (ces actions n'étaient soumises qu'à lui). « terrain/livraison » existe depuis db/246. Rejouable.
-- =============================================================================

INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT d.dpr_pro_id, n.noeud, n.actions::jsonb FROM droit_profil d
CROSS JOIN (VALUES
    ('terrain/demande', '{"CONSULTER":"TOUT","CREER":"TOUT"}'),
    ('terrain/avancement', '{"CREER":"TOUT"}'),
    ('terrain/materiel', '{"CREER":"TOUT"}')) n(noeud, actions)
WHERE d.dpr_noeud = 'terrain'
ON CONFLICT DO NOTHING;
