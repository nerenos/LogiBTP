-- =============================================================================
-- Cœur – photos de l'état du matériel au départ et au retour d'une affectation (plan materiel-suites, lot 1, MO1). Rejouable.
--
-- materiel_affectation.maf_ged_depart / maf_ged_retour : identifiant du document de la GED (sans clé étrangère, comme
-- per_image_ged, db/229), classé dans la GED du matériel (type d'élément « materiel »). Le document supprimé de la GED
-- (suppression logique ou physique) remet l'identifiant à vide.
-- =============================================================================

ALTER TABLE materiel_affectation ADD COLUMN IF NOT EXISTS maf_ged_depart BIGINT;
ALTER TABLE materiel_affectation ADD COLUMN IF NOT EXISTS maf_ged_retour BIGINT;

CREATE OR REPLACE FUNCTION fn_maf_photo_supprimee() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    d BIGINT := OLD.dge_id;
BEGIN
    UPDATE materiel_affectation SET maf_ged_depart = NULL WHERE maf_ged_depart = d;
    UPDATE materiel_affectation SET maf_ged_retour = NULL WHERE maf_ged_retour = d;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tr_maf_photo_supprimee_maj ON document_ged;
CREATE TRIGGER tr_maf_photo_supprimee_maj AFTER UPDATE OF dge_supprime ON document_ged
    FOR EACH ROW WHEN (NEW.dge_supprime AND NOT OLD.dge_supprime) EXECUTE FUNCTION fn_maf_photo_supprimee();

DROP TRIGGER IF EXISTS tr_maf_photo_supprimee_sup ON document_ged;
CREATE TRIGGER tr_maf_photo_supprimee_sup AFTER DELETE ON document_ged
    FOR EACH ROW EXECUTE FUNCTION fn_maf_photo_supprimee();
