-- =============================================================================
-- Cœur – numéro de carte carburant du matériel (plan materiel-suites, lot 10, MO6). Rejouable.
-- Rapproche un plein du fichier du fournisseur de cartes d'un matériel (sinon par l'immatriculation).
-- =============================================================================

ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_numero_carte VARCHAR(40);
CREATE INDEX IF NOT EXISTS ix_mat_numero_carte ON materiel (upper(mat_numero_carte)) WHERE mat_numero_carte IS NOT NULL;
