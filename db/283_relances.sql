-- =============================================================================
-- Cœur – module Relances, lot 4 (plans/relances.md, Q1, Q2). Rejouable.
--
-- - activation par société (module_societe « relance ») ;
-- - rôle de chaque type de pièce dans les relances (type_document.tyd_role_relance, codes RolesRelance de
--   Domaine/Codes.cs ↔ ROLE_RELANCE de codes.js, mêmes valeurs que NATURE_RELANCE du module) : DEVIS (devis envoyés),
--   FACTURE (factures à reste échu), NULL : jamais relancé (avoirs, reçus d'acompte, achats…). Un nouveau type se
--   déclare ici, sans code ; les pièces en attente sont lues par Btp/SpecialisationRelanceBtp.cs.
--   Valeurs posées à la création de la colonne seulement : un rôle retiré par la société n'est pas remis au rejeu.
-- =============================================================================

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_ordre) VALUES
 ('relance', 'Relances', 'Relances des devis envoyés et des factures à reste échu : niveaux, liste de travail, journal, suspensions', 95)
ON CONFLICT (mod_code) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'type_document' AND column_name = 'tyd_role_relance') THEN
        ALTER TABLE type_document ADD COLUMN tyd_role_relance VARCHAR(10);
        UPDATE type_document SET tyd_role_relance = 'DEVIS' WHERE tyd_code = 'V_DEVIS';
        UPDATE type_document SET tyd_role_relance = 'FACTURE' WHERE tyd_code IN ('V_FACTURE', 'V_FACTURE_AVT', 'V_FACTURE_ACOMPTE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tyd_role_relance') THEN
        ALTER TABLE type_document ADD CONSTRAINT ck_tyd_role_relance CHECK (tyd_role_relance IN ('DEVIS', 'FACTURE'));
    END IF;
END $$;

COMMENT ON COLUMN type_document.tyd_role_relance IS 'Rôle dans le module Relances : DEVIS, FACTURE ; NULL : type jamais relancé';
