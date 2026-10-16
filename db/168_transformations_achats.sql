-- =============================================================================
-- Cœur LogiBTP – chaîne des achats (CONCEPTION-ACHATS-MARCHES.md, Q1) : une demande de prix se transforme aussi
-- directement en facture fournisseur (vaut commande et réception), comme un devis client en facture.
-- Rejouable (ON CONFLICT DO NOTHING).
-- =============================================================================

INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape, tra_vaut_etapes)
SELECT s.tyd_id, c.tyd_id, 'FACTURATION', ARRAY['COMMANDE','RECEPTION']::VARCHAR(20)[]
FROM type_document s, type_document c
WHERE s.tyd_code = 'A_DEVIS' AND c.tyd_code = 'A_FACTURE'
ON CONFLICT DO NOTHING;
