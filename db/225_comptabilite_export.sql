-- =============================================================================
-- Cœur LogiBTP – module Comptabilité, base, lot 3 (module `094c` ; ANALYSE-MODULE-COMPTABILITE.md § 4.6, M6) : compte du
-- compte prorata (part des dépenses communes du chantier retenue sur nos factures, ou refacturée sur les achats) proposé
-- aux types comptables qui n'en ont pas ; clé étrangère des pièces exportées vers les documents. Rejouable.
-- =============================================================================

INSERT INTO compte_comptable (cpt_code, cpt_libelle, cpt_type, cpt_sens) VALUES
 ('628100', 'Compte prorata (dépenses communes de chantier)', 'GENERAL', 'LES_DEUX')
ON CONFLICT (cpt_code) DO NOTHING;

UPDATE type_comptable SET tco_cpt_prorata = '628100' WHERE tco_code IN ('VENTE', 'ACHAT') AND tco_cpt_prorata IS NULL;

ALTER TABLE comptabilite_export_piece DROP CONSTRAINT IF EXISTS fk_cep_document;
ALTER TABLE comptabilite_export_piece ADD CONSTRAINT fk_cep_document FOREIGN KEY (cep_piece_id) REFERENCES document(ent_id) ON DELETE CASCADE;
