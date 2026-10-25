-- =============================================================================
-- Cœur – compléments de l'annuaire (analyse des demandes du 25/10/2026, lot 4 : A13 à A17). Rejouable.
--
-- personne : per_image_ged (logo, document de la GED), per_assujetti_tva, per_fe_type (type de tiers pour la facture
--   électronique : B2B, B2C, B2G, INTERNATIONAL), per_cli_charge_ind_id (chargé d'affaires du client, individu de notre
--   société), règlement propre au client et au fournisseur (per_cli_mode_reglement, per_cli_delai_paiement,
--   per_fou_mode_reglement, per_fou_delai_paiement ; reprise du couple commun per_mode_reglement / per_delai_paiement,
--   gardé en repli), per_fou_tva_intracom (fournisseur intracommunautaire : autoliquidation de la TVA sur ses
--   factures), per_activites (codes de la liste ACTIVITE, db/227, plusieurs) ;
-- individu : ind_image_ged (photo, document de la GED ; reprise par la fiche salarié et Mon compte).
-- =============================================================================

ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_image_ged BIGINT;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_assujetti_tva BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_fe_type VARCHAR(15);
ALTER TABLE personne DROP CONSTRAINT IF EXISTS ck_per_fe_type;
ALTER TABLE personne ADD CONSTRAINT ck_per_fe_type CHECK (per_fe_type IS NULL OR per_fe_type IN ('B2B', 'B2C', 'B2G', 'INTERNATIONAL'));
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_cli_charge_ind_id BIGINT REFERENCES individu(ind_id) ON DELETE SET NULL;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_cli_mode_reglement VARCHAR(20);
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_cli_delai_paiement VARCHAR(20);
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_fou_mode_reglement VARCHAR(20);
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_fou_delai_paiement VARCHAR(20);
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_fou_tva_intracom BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_activites JSONB NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS ix_per_activites ON personne USING gin (per_activites);
ALTER TABLE individu ADD COLUMN IF NOT EXISTS ind_image_ged BIGINT;

-- Reprise du règlement commun, une fois (seulement là où rien n'est saisi dans les nouveaux champs).
UPDATE personne SET per_cli_mode_reglement = per_mode_reglement, per_cli_delai_paiement = per_delai_paiement
WHERE per_casquettes ? 'CLIENT' AND per_cli_mode_reglement IS NULL AND per_cli_delai_paiement IS NULL
  AND (per_mode_reglement IS NOT NULL OR per_delai_paiement IS NOT NULL);
UPDATE personne SET per_fou_mode_reglement = per_mode_reglement, per_fou_delai_paiement = per_delai_paiement
WHERE (per_casquettes ? 'FOURNISSEUR' OR per_casquettes ? 'SOUS_TRAITANT' OR per_casquettes ? 'LOUEUR')
  AND per_fou_mode_reglement IS NULL AND per_fou_delai_paiement IS NULL
  AND (per_mode_reglement IS NOT NULL OR per_delai_paiement IS NOT NULL);
-- Particuliers : B2C et non assujettis (sans n° de TVA) ; administrations (Chorus Pro) : B2G ; étrangers : INTERNATIONAL ;
-- sinon B2B. Une seule fois : tant qu'aucun type n'est saisi (première application du script).
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM personne WHERE per_fe_type IS NOT NULL) THEN
        UPDATE personne p SET per_fe_type = CASE WHEN p.per_service_public THEN 'B2G' WHEN p.per_pays <> 'FR' THEN 'INTERNATIONAL'
                                                 WHEN n.niv_morale = FALSE THEN 'B2C' ELSE 'B2B' END,
                              per_assujetti_tva = NOT (n.niv_morale = FALSE AND p.per_tva_intra IS NULL)
        FROM niveau_personne n
        WHERE n.niv_code = p.per_niv_code;
    END IF;
END $do$;

-- Liste des personnes : activités (tableau de codes, segments et filtres « parmi ») et chargé d'affaires.
CREATE OR REPLACE VIEW v_liste_personnes AS
SELECT per_id AS id, 'personne'::text AS type_element, per_code AS code, per_raison_sociale AS raison_sociale, per_nom_commercial AS nom_commercial,
       per_niv_code AS niveau, ARRAY(SELECT jsonb_array_elements_text(v.per_casquettes)) AS casquettes, parent, chemin,
       per_siren AS siren, per_siret AS siret, per_tva_intra AS tva_intra, per_pays AS pays, adresse, code_postal, ville, telephone, email, contact,
       per_societe_base AS societe_base, per_actif AS actif, per_modifie_le AS modifie_le, per_provisoire AS provisoire,
       (SELECT p.per_usage FROM personne p WHERE p.per_id = v.per_id) AS usage,
       ARRAY(SELECT jsonb_array_elements_text(p.per_activites) FROM personne p WHERE p.per_id = v.per_id) AS activites,
       (SELECT concat_ws(' ', i.ind_prenom, i.ind_nom) FROM personne p JOIN individu i ON i.ind_id = p.per_cli_charge_ind_id WHERE p.per_id = v.per_id) AS charge_affaires
FROM v_annuaire_personnes v;
