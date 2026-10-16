-- =============================================================================
-- Module Document – options et variantes à la transformation (CONCEPTION-ACHATS-MARCHES.md, Q11 à Q15, 13.1).
-- - lie_choix : choix faits à la transformation (option ou variante retenue en prix vendu, ou non retenue ; ligne de
--   base d'une variante gardée ou non) : [{ "lig_id": …, "retenue": true|false }].
-- - tra_intermediaire_tyd_id : une transformation directe passe par un document intermédiaire validé
--   automatiquement (devis → facture : commande entre les deux) ; ent_intermediaire marque ce document.
-- Rejouable (IF NOT EXISTS).
-- =============================================================================

ALTER TABLE document_lien ADD COLUMN IF NOT EXISTS lie_choix JSONB;

ALTER TABLE transformation_autorisee ADD COLUMN IF NOT EXISTS tra_intermediaire_tyd_id INT REFERENCES type_document(tyd_id);

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_intermediaire BOOLEAN NOT NULL DEFAULT FALSE;
