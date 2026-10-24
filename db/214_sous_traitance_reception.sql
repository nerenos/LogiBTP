-- Sous-traitance, lot 4 (ANALYSE-MODULE-SOUS-TRAITANCE.md ST23) : réception des travaux d'un marché, réserves et leur
-- levée, libération de la retenue de garantie (échéances RETENUE des pièces du marché datées à la libération).
-- Rejouable.

ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_reserves BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_reserves_levees_le DATE;
ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_retenue_liberee_le DATE;
