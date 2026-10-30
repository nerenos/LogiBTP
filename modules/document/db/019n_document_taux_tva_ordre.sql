-- =============================================================================
-- Module Document – taux de TVA : ordre d'affichage et taux par défaut (paramétrés dans la comptabilité). Rejouable.
--   * ttv_ordre : ordre des taux dans les listes de choix (grille, détail, paramétrage) ;
--   * ttv_defaut : taux d'une nouvelle ligne de prix sans titre porteur d'un taux (un seul, actif) ; sans taux par
--     défaut, le premier taux actif dans l'ordre.
-- Départ : taux normaux d'abord, du plus fort au plus faible, puis les autres ; défaut = le taux normal le plus fort.
-- =============================================================================

ALTER TABLE taux_tva ADD COLUMN IF NOT EXISTS ttv_ordre INT NOT NULL DEFAULT 0;
ALTER TABLE taux_tva ADD COLUMN IF NOT EXISTS ttv_defaut BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS ux_taux_tva_defaut ON taux_tva (ttv_defaut) WHERE ttv_defaut;

UPDATE taux_tva t SET ttv_ordre = x.rang * 10
FROM (SELECT ttv_id, row_number() OVER (ORDER BY ttv_categorie <> 'N', ttv_taux DESC, ttv_code) AS rang FROM taux_tva) x
WHERE t.ttv_id = x.ttv_id AND NOT EXISTS (SELECT 1 FROM taux_tva WHERE ttv_ordre <> 0);

UPDATE taux_tva SET ttv_defaut = TRUE
WHERE ttv_id = (SELECT ttv_id FROM taux_tva WHERE ttv_actif AND ttv_categorie = 'N' ORDER BY ttv_taux DESC, ttv_code LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM taux_tva WHERE ttv_defaut);
