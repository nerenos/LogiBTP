-- =============================================================================
-- Cœur – restaurants et géocodage (lot 10 des demandes du 25/10/2026, A29). Rejouable.
--   Relation RESTAURANT de l'annuaire ; coordonnées géographiques des adresses (coordonnee) et des chantiers, obtenues
--   par le géocodage (API Adresse, section Geocodage) : latitude, longitude, score, adresse géocodée (un changement
--   d'adresse relance le géocodage, un échec n'est pas retenté pour la même adresse) ; clés étrangères des repas.
-- =============================================================================

INSERT INTO casquette (cas_code, cas_libelle, cas_icone, cas_groupes, cas_ordre, cas_actif)
SELECT 'RESTAURANT', 'Restaurant', '🍽', '[]'::jsonb, 90, TRUE
WHERE NOT EXISTS (SELECT 1 FROM casquette WHERE cas_code = 'RESTAURANT');

ALTER TABLE coordonnee ADD COLUMN IF NOT EXISTS coo_latitude NUMERIC(9,6);
ALTER TABLE coordonnee ADD COLUMN IF NOT EXISTS coo_longitude NUMERIC(9,6);
ALTER TABLE coordonnee ADD COLUMN IF NOT EXISTS coo_geocode_score NUMERIC(4,3);
ALTER TABLE coordonnee ADD COLUMN IF NOT EXISTS coo_geocode_adresse VARCHAR(400);
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_latitude NUMERIC(9,6);
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_longitude NUMERIC(9,6);
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_geocode_score NUMERIC(4,3);
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_geocode_adresse VARCHAR(400);
COMMENT ON COLUMN coordonnee.coo_geocode_adresse IS 'Adresse géocodée (texte envoyé au géocodage) : différente de l''adresse actuelle = à géocoder';
COMMENT ON COLUMN chantier.cha_geocode_adresse IS 'Adresse géocodée (texte envoyé au géocodage) : différente de l''adresse actuelle = à géocoder';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_prp_salarie') THEN
        ALTER TABLE poi_repas ADD CONSTRAINT fk_prp_salarie FOREIGN KEY (prp_sal_id) REFERENCES salarie (sal_id) ON DELETE CASCADE;
        ALTER TABLE poi_repas ADD CONSTRAINT fk_prp_restaurant FOREIGN KEY (prp_restaurant_id) REFERENCES personne (per_id) ON DELETE SET NULL;
        ALTER TABLE poi_repas ADD CONSTRAINT fk_prp_chantier FOREIGN KEY (prp_cha_id) REFERENCES chantier (cha_id) ON DELETE SET NULL;
    END IF;
END $$;
