-- Module GED LogiBTP – validité d'un document (attestation, assurance, Kbis…) : début et fin de validité, saisies ou
-- déduites par l'application (pièces exigées de la sous-traitance). Rejouable.

ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_valide_du DATE;
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_valide_au DATE;
CREATE INDEX IF NOT EXISTS ix_dge_valide_au ON document_ged (dge_valide_au) WHERE dge_valide_au IS NOT NULL AND NOT dge_supprime;
