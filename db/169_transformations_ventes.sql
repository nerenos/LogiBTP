-- =============================================================================
-- Cœur LogiBTP – devis facturé directement (CONCEPTION-ACHATS-MARCHES.md, Q15 et 13.1) : la transformation devis →
-- facture passe par une commande, créée et validée automatiquement (budget du chantier), marquée intermédiaire
-- (ent_intermediaire : pas de marché obligatoire). Les achats (demande de prix → facture) restent directs.
-- Rejouable.
-- =============================================================================

UPDATE transformation_autorisee t
SET tra_intermediaire_tyd_id = (SELECT tyd_id FROM type_document WHERE tyd_code = 'V_COMMANDE')
FROM type_document s, type_document c
WHERE s.tyd_id = t.tra_source_tyd_id AND c.tyd_id = t.tra_cible_tyd_id
  AND s.tyd_code = 'V_DEVIS' AND c.tyd_code = 'V_FACTURE';
