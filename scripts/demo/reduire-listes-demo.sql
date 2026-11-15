-- =============================================================================
-- Démonstration : réduit une base déjà créée aux 80 salariés et 50 matériels que db/120 crée désormais (au lieu de
-- 5 000 et 3 000 ; les listes longues sont éprouvées par les tests). Hors manifeste, à appliquer à la main aux bases
-- de démonstration seulement : JAMAIS à une base de production (suppressions définitives).
-- Ne retire que les fiches générées par db/120 (salariés au-delà du 80e dont db/142 a créé l'individu « Salarié S… »,
-- matériels au-delà du 50e de code M00000) ; une fiche encore utilisée ailleurs (clé
-- étrangère sans suppression en cascade : document, compte…) est gardée. Les données qui en dépendent en cascade
-- (pointages, missions, compositions d'équipe, compteurs, affectations…) partent avec elle. Les individus de
-- l'annuaire créés pour ces salariés par db/142 (1000 + identifiant, « Salarié S… ») sont retirés de la même façon.
-- Rejouable.
-- =============================================================================

DO $$
DECLARE
    r RECORD;
    sal_retires INT := 0; sal_gardes INT := 0; mat_retires INT := 0; mat_gardes INT := 0; ind_retires INT := 0;
BEGIN
    FOR r IN SELECT s.sal_id FROM salarie s
             WHERE s.sal_id > 80
               AND EXISTS (SELECT 1 FROM individu i WHERE i.ind_id = 1000 + s.sal_id AND i.ind_commentaire = 'Salarié S' || lpad(s.sal_id::text, 5, '0'))
             ORDER BY s.sal_id LOOP
        BEGIN
            DELETE FROM salarie WHERE sal_id = r.sal_id;
            sal_retires := sal_retires + 1;
        EXCEPTION WHEN foreign_key_violation THEN
            sal_gardes := sal_gardes + 1;
        END;
    END LOOP;

    -- Individus de démonstration des salariés retirés : plus rattachés à aucune fiche salarié.
    FOR r IN SELECT i.ind_id FROM individu i
             WHERE i.ind_id > 1080 AND i.ind_commentaire ~ '^Salarié S[0-9]{5}$'
               AND NOT EXISTS (SELECT 1 FROM salarie s WHERE s.sal_ind_id = i.ind_id OR s.sal_id + 1000 = i.ind_id) LOOP
        BEGIN
            CREATE TEMP TABLE IF NOT EXISTS coo_a_retirer (coo_id BIGINT) ON COMMIT DROP;
            TRUNCATE coo_a_retirer;
            INSERT INTO coo_a_retirer SELECT u.uco_coo_id FROM usage_coordonnee u
             WHERE u.uco_rat_id IN (SELECT rat_id FROM rattachement WHERE rat_ind_id = r.ind_id);
            DELETE FROM usage_coordonnee WHERE uco_rat_id IN (SELECT rat_id FROM rattachement WHERE rat_ind_id = r.ind_id);
            DELETE FROM coordonnee c WHERE c.coo_id IN (SELECT coo_id FROM coo_a_retirer)
               AND NOT EXISTS (SELECT 1 FROM usage_coordonnee u WHERE u.uco_coo_id = c.coo_id);
            DELETE FROM rattachement WHERE rat_ind_id = r.ind_id;
            DELETE FROM individu WHERE ind_id = r.ind_id;
            ind_retires := ind_retires + 1;
        EXCEPTION WHEN foreign_key_violation THEN
            NULL;
        END;
    END LOOP;

    FOR r IN SELECT mat_id FROM materiel WHERE mat_id > 50 AND mat_code ~ '^M[0-9]{5}$' ORDER BY mat_id LOOP
        BEGIN
            DELETE FROM materiel WHERE mat_id = r.mat_id;
            mat_retires := mat_retires + 1;
        EXCEPTION WHEN foreign_key_violation THEN
            mat_gardes := mat_gardes + 1;
        END;
    END LOOP;

    RAISE NOTICE 'Salariés retirés : %, gardés (encore utilisés) : % ; individus retirés : % ; matériels retirés : %, gardés : %',
        sal_retires, sal_gardes, ind_retires, mat_retires, mat_gardes;
END $$;
