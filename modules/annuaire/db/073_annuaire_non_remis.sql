-- Marque « non remise » d'une coordonnée EMAIL (posée par la messagerie de l'hôte, affichée et effacée par la fiche) ; rejouable.
ALTER TABLE coordonnee ADD COLUMN IF NOT EXISTS coo_non_remis_le    TIMESTAMPTZ;
ALTER TABLE coordonnee ADD COLUMN IF NOT EXISTS coo_non_remis_motif VARCHAR(300);
