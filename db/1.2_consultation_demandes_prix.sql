-- =============================================================================
-- Cœur – lot de consultation des demandes de prix fournisseur (20/11/2026).
--   Le module Document (019i, 019m) donne le lot de consultation à A_DEVIS et le statut NON_RETENU aux types à lot, mais
--   ses scripts passent avant db/110 qui crée A_DEVIS : sur une base neuve, la demande de prix n'avait ni l'action
--   « Lot de consultation », ni le champ du lot dans l'entête, ni le statut « Non retenue ». Reprise ici, après le socle.
-- =============================================================================

UPDATE type_document SET tyd_consultation = TRUE WHERE tyd_code = 'A_DEVIS' AND NOT tyd_consultation;

INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, 'NON_RETENU', 'Non retenue', FALSE, TRUE, 13 FROM type_document t
WHERE t.tyd_consultation AND NOT EXISTS (SELECT 1 FROM statut_document s WHERE s.std_tyd_id = t.tyd_id AND s.std_code = 'NON_RETENU');
