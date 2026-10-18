-- =============================================================================
-- Cœur LogiBTP – adresse des travaux (ventes) ou de livraison (achats) des documents (CONCEPTION-DOCUMENTS-EVOLUTIONS.md,
-- lot F) : instantané dans document.ent_adresse_livraison (colonne du module Document) ; contact sur place du chantier
-- (le client ou un salarié, pour les livraisons), repris dans l'adresse des travaux. Rejouable.
-- =============================================================================

ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_contact_ind_id BIGINT REFERENCES individu(ind_id) ON DELETE SET NULL;
