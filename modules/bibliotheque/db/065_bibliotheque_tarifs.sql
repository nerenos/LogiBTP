-- =============================================================================
-- Module Bibliothèque – tarifs fournisseurs (demandes du 25/10/2026, lot 8 : A10, A11, A12). Rejouable.
--
-- tarif_fournisseur : prix public et remises 1 et 2 (%) : le prix net (tfo_prix, PA du tarif) = prix public ×
--   (1 − remise 1) × (1 − remise 2), arrondi à 6 décimales (prixNetTarif ↔ CalculElement.PrixNetTarif, jeu
--   tests/cas/01_calcul.json), sinon le prix saisi ; délai de livraison du fournisseur (jours) ; code-barres du
--   fournisseur (cherché par l'import des tarifs). Unité d'achat, référence et libellé fournisseur : colonnes existantes.
-- tarif_import : journal des imports CSV de tarifs (fournisseur, fichier, lignes créées, mises à jour, en erreur).
-- =============================================================================

ALTER TABLE tarif_fournisseur ADD COLUMN IF NOT EXISTS tfo_prix_public NUMERIC(18,6);
ALTER TABLE tarif_fournisseur ADD COLUMN IF NOT EXISTS tfo_remise1 NUMERIC(7,4);
ALTER TABLE tarif_fournisseur ADD COLUMN IF NOT EXISTS tfo_remise2 NUMERIC(7,4);
ALTER TABLE tarif_fournisseur ADD COLUMN IF NOT EXISTS tfo_delai INT;
ALTER TABLE tarif_fournisseur ADD COLUMN IF NOT EXISTS tfo_code_barre VARCHAR(50);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tfo_remises') THEN
        ALTER TABLE tarif_fournisseur ADD CONSTRAINT ck_tfo_remises CHECK (
            (tfo_prix_public IS NULL OR tfo_prix_public >= 0)
            AND (tfo_remise1 IS NULL OR tfo_remise1 BETWEEN 0 AND 100) AND (tfo_remise2 IS NULL OR tfo_remise2 BETWEEN 0 AND 100)
            AND (tfo_delai IS NULL OR tfo_delai >= 0));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_tfo_tiers ON tarif_fournisseur (tfo_tiers_id) WHERE tfo_tiers_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_tfo_code_barre ON tarif_fournisseur (tfo_code_barre) WHERE tfo_code_barre IS NOT NULL;

CREATE TABLE IF NOT EXISTS tarif_import (
    tim_id          BIGSERIAL     PRIMARY KEY,
    tim_tiers_id    BIGINT,
    tim_fournisseur VARCHAR(100)  NOT NULL,
    tim_fichier     VARCHAR(255),
    tim_crees       INT           NOT NULL DEFAULT 0,
    tim_maj         INT           NOT NULL DEFAULT 0,
    tim_erreurs     INT           NOT NULL DEFAULT 0,
    tim_par         VARCHAR(50),
    tim_le          TIMESTAMPTZ   NOT NULL DEFAULT now()
);
