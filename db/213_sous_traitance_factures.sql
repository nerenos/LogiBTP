-- =============================================================================
-- Cœur – module Sous-traitance, lot 3 (ANALYSE-MODULE-SOUS-TRAITANCE.md § 5.4, ST7 à ST11, ST21 à ST27) : facture de
-- sous-traitance saisie à l'avancement ou reçue du sous-traitant (mode, montants de sa facture : contrôle de l'écart à
-- la validation) ; approbation du conducteur avant la validation (bon à payer) ; postes du marché au pied des factures
-- de sous-traitance (retenue de garantie, prorata, pénalités) ; vue des factures de sous-traitance. Rejouable.
-- =============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_st_saisie VARCHAR(10);
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_st_recu_ht NUMERIC(18,2);
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_st_recu_tva NUMERIC(18,2);
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_st_recu_ttc NUMERIC(18,2);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ent_st_saisie') THEN
        ALTER TABLE document ADD CONSTRAINT ck_ent_st_saisie CHECK (ent_st_saisie IS NULL OR ent_st_saisie IN ('AVANCEMENT', 'RECUE'));
    END IF;
END $$;

-- Bon à payer en deux temps (ST27) : approbation (conducteur : avancement constaté) puis validation (comptabilité) ;
-- postes du marché posés au pied des factures et des avoirs de sous-traitance.
INSERT INTO regle_document (rdo_code, rdo_tyd_id, rdo_valeur, rdo_actif)
SELECT x.code, t.tyd_id, x.valeur::jsonb, TRUE
FROM (VALUES ('APPROBATION', 'T_FACTURE_AVT', 'true'), ('POSTES_MARCHE', 'T_FACTURE_AVT', 'true'), ('POSTES_MARCHE', 'T_AVOIR', 'true'))
     AS x(code, type, valeur)
JOIN type_document t ON t.tyd_code = x.type
WHERE NOT EXISTS (SELECT 1 FROM regle_document r WHERE r.rdo_code = x.code AND r.rdo_tyd_id = t.tyd_id);
