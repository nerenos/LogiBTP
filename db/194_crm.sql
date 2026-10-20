-- =============================================================================
-- Cœur – module CRM (modules/crm/db/095, 097) : pièces jointes des éléments du CRM dans la GED (types crm_* acceptés par
-- f_ged_element_existe, qui reprend 164, en déléguant au module : f_crm_element_existe), catégorie GED « crm ». Rejouable.
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
        ELSE CASE WHEN p_type LIKE 'crm\_%' THEN f_crm_element_existe(p_type, n) END
    END;
END $$;

UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"crm","libelle":"Suivi (CRM : courriels, pièces des notes)"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"crm"}]'::jsonb;
