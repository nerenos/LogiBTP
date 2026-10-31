-- =============================================================================
-- Module Bibliothèque – genre des postes de pied (décision du 31/10/2026) : nature du poste (remise, compte prorata,
-- acompte, paiement direct, retenue de garantie, autre) portée par l'élément POSTE_PIED et recopiée sur la ligne de
-- pied du document (`lig_proprietes.genre_poste`), lue par l'application (écritures comptables) au lieu du libellé.
-- Rejouable.
-- =============================================================================

ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_pied_genre VARCHAR(20)
    CHECK (ele_pied_genre IN ('REMISE','PRORATA','ACOMPTE','PAIEMENT_DIRECT','RETENUE','AUTRE'));

-- Postes existants : une retenue de garantie est du genre RETENUE.
UPDATE element SET ele_pied_genre = 'RETENUE' WHERE ele_type = 'POSTE_PIED' AND ele_pied_genre IS NULL AND ele_pied_retenue;
