-- =============================================================================
-- Cœur – éléments auxquels un document de la GED peut être lié (point d'accroche f_ged_element_existe du module GED,
-- vérifié par le déclencheur tr_ged_element_existe) :
--   documents : code du type (V_DEVIS…) + identifiant du groupe d'indices (ent_groupe_id, ou ent_id) ;
--   fiches : salarie / interim, materiel, element, personne, individu, projet, affaire, chantier, marche.
-- Réponse NULL : type inconnu ; FALSE : élément inexistant (les deux sont refusés).
-- =============================================================================

CREATE OR REPLACE FUNCTION f_ged_element_existe(p_type TEXT, p_id TEXT) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
    n BIGINT;
    tyd INT;
BEGIN
    IF p_type IS NULL OR p_id IS NULL THEN RETURN NULL; END IF;
    IF p_id !~ '^[0-9]{1,18}$' THEN RETURN FALSE; END IF;
    n := p_id::BIGINT;
    SELECT tyd_id INTO tyd FROM type_document WHERE tyd_code = p_type;
    IF FOUND THEN
        RETURN EXISTS (SELECT 1 FROM document WHERE ent_tyd_id = tyd AND coalesce(ent_groupe_id, ent_id) = n);
    END IF;
    RETURN CASE p_type
        WHEN 'salarie'  THEN EXISTS (SELECT 1 FROM demo_salarie WHERE sal_id = n)
        WHEN 'interim'  THEN EXISTS (SELECT 1 FROM demo_salarie WHERE sal_id = n)
        WHEN 'materiel' THEN EXISTS (SELECT 1 FROM demo_materiel WHERE mat_id = n)
        WHEN 'element'  THEN EXISTS (SELECT 1 FROM element WHERE ele_id = n)
        WHEN 'personne' THEN EXISTS (SELECT 1 FROM personne WHERE per_id = n)
        WHEN 'individu' THEN EXISTS (SELECT 1 FROM individu WHERE ind_id = n)
        WHEN 'projet'   THEN EXISTS (SELECT 1 FROM projet WHERE prj_id = n)
        WHEN 'affaire'  THEN EXISTS (SELECT 1 FROM affaire WHERE aff_id = n)
        WHEN 'chantier' THEN EXISTS (SELECT 1 FROM chantier WHERE cha_id = n)
        WHEN 'marche'   THEN EXISTS (SELECT 1 FROM marche WHERE mar_id = n)
        ELSE NULL
    END;
END $$;
