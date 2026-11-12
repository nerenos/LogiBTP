-- =============================================================================
-- Cœur – facturation électronique, lot 29 (plans/facturation-electronique.md, Q21) : archivage des flux. Rejouable.
--
-- - règle de rétention de la GED (regle_retention_ged, module GED db/051) pour la catégorie « facture_electronique »
--   (db/295) : fichiers des flux émis et reçus (original, lisible, CDAR) et transmissions d'e-reporting, conservés
--   10 ans à compter de la date du document (archivés après 2 ans, revus à la fin : jamais détruits, les originaux sont
--   au coffre). Posée une seule fois : une règle de cette catégorie déjà présente (réglée ou désactivée par la société)
--   n'est jamais remplacée.
-- - élément « EREPORTING » de la GED (TypesElementFe.PeriodeEreporting) : période d'e-reporting (ereporting_periode,
--   db/304) ; les transmissions envoyées y sont rangées à l'étape ENVOI et au coffre (Btp/FactureElectroniqueBtp.cs).
--   f_ged_element_existe : reprise de 272 avec ce type.
-- =============================================================================

INSERT INTO regle_retention_ged (rrg_libelle, rrg_categorie, rrg_type_element, rrg_duree_active_mois, rrg_duree_conservation_mois, rrg_action_fin, rrg_priorite)
SELECT 'Flux de facturation électronique', 'facture_electronique', NULL, 24, 120, 'REVOIR', 10
WHERE NOT EXISTS (SELECT 1 FROM regle_retention_ged WHERE rrg_categorie = 'facture_electronique');

-- Éléments de la GED : reprise de 272 avec la période d'e-reporting.
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
        WHEN 'salarie'  THEN EXISTS (SELECT 1 FROM salarie WHERE sal_id = n)
        WHEN 'interim'  THEN EXISTS (SELECT 1 FROM salarie WHERE sal_id = n)
        WHEN 'materiel' THEN EXISTS (SELECT 1 FROM materiel WHERE mat_id = n)
        WHEN 'element'  THEN EXISTS (SELECT 1 FROM element WHERE ele_id = n)
        WHEN 'personne' THEN EXISTS (SELECT 1 FROM personne WHERE per_id = n)
        WHEN 'individu' THEN EXISTS (SELECT 1 FROM individu WHERE ind_id = n)
        WHEN 'projet'   THEN EXISTS (SELECT 1 FROM projet WHERE prj_id = n)
        WHEN 'affaire'  THEN EXISTS (SELECT 1 FROM affaire WHERE aff_id = n)
        WHEN 'chantier' THEN EXISTS (SELECT 1 FROM chantier WHERE cha_id = n)
        WHEN 'marche'   THEN EXISTS (SELECT 1 FROM marche WHERE mar_id = n)
        WHEN 'equipe'   THEN EXISTS (SELECT 1 FROM equipe WHERE equ_id = n)
        WHEN 'mail_compte' THEN EXISTS (SELECT 1 FROM mail_compte WHERE mco_id = n)
        WHEN 'stk_lot'  THEN EXISTS (SELECT 1 FROM stk_lot WHERE lot_id = n)
        WHEN 'EREPORTING' THEN EXISTS (SELECT 1 FROM ereporting_periode WHERE erp_id = n)
        ELSE CASE WHEN p_type LIKE 'crm\_%' THEN f_crm_element_existe(p_type, n) END
    END;
END $$;
