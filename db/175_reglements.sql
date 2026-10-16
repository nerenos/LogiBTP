-- =============================================================================
-- Module Règlements branché sur les échéances du module Document (CONCEPTION-MARCHES-REGLEMENTS.md, Q14 à Q18, 11.5) :
-- un pointage désigne une échéance (document_echeance) ; une échéance pointée ne se supprime pas (l'échéancier d'une
-- pièce pointée ne se modifie plus).
-- Rejouable.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pointage_echeance') THEN
    ALTER TABLE pointage ADD CONSTRAINT fk_pointage_echeance FOREIGN KEY (poi_echeance_id) REFERENCES document_echeance (ech_id);
  END IF;
END $$;
