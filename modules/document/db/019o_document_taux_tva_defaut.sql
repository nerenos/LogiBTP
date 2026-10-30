-- =============================================================================
-- Module Document – taux de TVA par défaut du document (entête). Rejouable.
--   ent_tva_id : taux d'une nouvelle ligne de prix hors d'un titre qui porte un taux (avant le taux par défaut du
--   paramétrage, ttv_defaut de 019n) ; vide = taux par défaut du paramétrage. Copié à la transformation avec l'entête.
-- =============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_tva_id INT REFERENCES taux_tva(ttv_id);
