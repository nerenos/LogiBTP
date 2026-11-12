-- =============================================================================
-- Cœur – facturation électronique, lot 21 (plans/facturation-electronique.md) : paramètres d'émission BTP. Rejouable.
--
-- - type_document.tyd_fe_type_facture : code BT-3 du type de pièce émis (BR-FR-04) ; NULL : type jamais émis.
--   V_FACTURE et V_FACTURE_AVT 380, V_FACTURE_ACOMPTE 386, V_AVOIR 381 (l'avoir d'une facture d'acompte devient 503 par la
--   règle client/src/calcul/emission-fe.js ↔ src/LogiBTP.Calcul/EmissionFeBtp.cs). Valeurs posées à la création de la
--   colonne seulement : un code retiré ou changé par la société n'est pas remis au rejeu ;
-- - nature_element.nat_fe_nature : nature biens (B) ou services (S) des lignes de cette nature (Q8 : travaux, main-d'œuvre,
--   location, prestations = services ; matériaux et fournitures vendus seuls = biens). Proposée à la création de la colonne :
--   regroupement MATERIAUX → B, autres → S ; NULL : nature de la ligne selon son type (ouvrage : services) ;
-- - document.ent_fe_nature : surcharge de la nature de la pièce (B, S, M) ; NULL : calculée sur les lignes vendues.
-- Option TVA sur les débits : mentions de la société (parametre_edition « mentions », tva_debits, db/190), déjà imprimée.
-- Notes PMT / PMD / AAB : mentions indemnite / penalites / escompte de la même clé.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'type_document' AND column_name = 'tyd_fe_type_facture') THEN
        ALTER TABLE type_document ADD COLUMN tyd_fe_type_facture VARCHAR(3);
        UPDATE type_document SET tyd_fe_type_facture = '380' WHERE tyd_code IN ('V_FACTURE', 'V_FACTURE_AVT');
        UPDATE type_document SET tyd_fe_type_facture = '386' WHERE tyd_code = 'V_FACTURE_ACOMPTE';
        UPDATE type_document SET tyd_fe_type_facture = '381' WHERE tyd_code = 'V_AVOIR';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tyd_fe_type_facture') THEN
        ALTER TABLE type_document ADD CONSTRAINT ck_tyd_fe_type_facture CHECK (tyd_fe_type_facture IN
            ('380', '389', '393', '501', '386', '500', '384', '471', '472', '473', '261', '262', '381', '396', '502', '503'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nature_element' AND column_name = 'nat_fe_nature') THEN
        ALTER TABLE nature_element ADD COLUMN nat_fe_nature CHAR(1) CHECK (nat_fe_nature IN ('B', 'S'));
        UPDATE nature_element SET nat_fe_nature = CASE WHEN nat_rgn_code = 'MATERIAUX' THEN 'B' ELSE 'S' END;
    END IF;
END $$;

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_fe_nature CHAR(1);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ent_fe_nature') THEN
        ALTER TABLE document ADD CONSTRAINT ck_ent_fe_nature CHECK (ent_fe_nature IN ('B', 'S', 'M'));
    END IF;
END $$;

COMMENT ON COLUMN type_document.tyd_fe_type_facture IS 'Facturation électronique : code BT-3 du type émis (380, 386, 381…) ; NULL : jamais émis';
COMMENT ON COLUMN nature_element.nat_fe_nature IS 'Facturation électronique : nature biens (B) ou services (S) des lignes de cette nature (cadre BT-23)';
COMMENT ON COLUMN document.ent_fe_nature IS 'Facturation électronique : nature de la pièce imposée (B, S, M) ; NULL : calculée sur les lignes vendues';
