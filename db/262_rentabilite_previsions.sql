-- =============================================================================
-- Cœur – saisies prévisionnelles de la rentabilité (ANALYSE-MODULE-ANALYSE.md § 10.1 ; module Rentabilité, lot 6).
-- Rejouable.
--
-- Clés étrangères de rentabilite_prevision (module 099r) : chantier, ordre d'exécution, nature, tiers, pièce qui solde
-- la saisie. Les faits PREVU_* sont écrits par le module au recalcul du chantier (aucun trigger : le service recalcule
-- le chantier à chaque écriture d'une saisie) ; les règles du cœur ne changent pas (version 5).
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rpr_chantier') THEN
        ALTER TABLE rentabilite_prevision ADD CONSTRAINT fk_rpr_chantier FOREIGN KEY (rpr_cha_id) REFERENCES chantier (cha_id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rpr_ordre') THEN
        ALTER TABLE rentabilite_prevision ADD CONSTRAINT fk_rpr_ordre FOREIGN KEY (rpr_ordre_id) REFERENCES document (ent_id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rpr_nature') THEN
        ALTER TABLE rentabilite_prevision ADD CONSTRAINT fk_rpr_nature FOREIGN KEY (rpr_nat_id) REFERENCES nature_element (nat_id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rpr_tiers') THEN
        ALTER TABLE rentabilite_prevision ADD CONSTRAINT fk_rpr_tiers FOREIGN KEY (rpr_tiers_id) REFERENCES personne (per_id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rpr_solde_piece') THEN
        ALTER TABLE rentabilite_prevision ADD CONSTRAINT fk_rpr_solde_piece FOREIGN KEY (rpr_solde_ent_id) REFERENCES document (ent_id) ON DELETE SET NULL;
    END IF;
END $$;

