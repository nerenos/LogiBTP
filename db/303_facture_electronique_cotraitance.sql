-- =============================================================================
-- Cœur – facturation électronique, lot 27 (plans/facturation-electronique.md, Q19, Q22 ; XP Z12-014 cas 13 et 14) :
-- sous-traitance et cotraitance émises. Rejouable.
--
-- - marche.mar_fe_role : notre place dans un marché de vente (sens V) pour le cadre de facturation BT-23 des pièces
--   émises : vide = titulaire ou entreprise générale (cadres 1, 2, 4), SOUS_TRAITANT (cadre S5 ; payeur EXT-FR-FE-BG-02
--   = intervenant PAYEUR de la pièce ou du marché en paiement direct, profil EXTENDED-CTC-FR), COTRAITANT (cadre S6,
--   récapitulatif de cotraitance joint). Valeurs de SITUATION_CADRE_FE (client/src/app/codes.js ↔ SituationsCadreFe).
-- - Catégorie GED recapitulatif_cotraitance : fichier joint (BT-123 RECAPITULATIF_COTRAITANCE, BR-FR-17) à la facture
--   émise d'un cotraitant, cherché dans la GED de la pièce puis dans celle du marché.
-- B2G (Q19 (a), par la plateforme) : code service (per_fe_code_service → BT-10) et numéro d'engagement (référence
-- externe de la pièce → BT-13, exigé si per_fe_engagement) déjà sur la fiche et la pièce ; aucune colonne ajoutée.
-- =============================================================================

ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_fe_role VARCHAR(20);
ALTER TABLE marche DROP CONSTRAINT IF EXISTS marche_fe_role_check;
ALTER TABLE marche ADD CONSTRAINT marche_fe_role_check CHECK (mar_fe_role IS NULL OR mar_fe_role IN ('SOUS_TRAITANT', 'COTRAITANT'));
COMMENT ON COLUMN marche.mar_fe_role IS 'Facture électronique : notre place dans le marché de vente (vide titulaire, SOUS_TRAITANT cadre S5, COTRAITANT cadre S6)';

UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"recapitulatif_cotraitance","libelle":"Récapitulatif de cotraitance"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"recapitulatif_cotraitance"}]'::jsonb;
