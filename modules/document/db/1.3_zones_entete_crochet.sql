-- =============================================================================
-- Module Document 1.3 – crochet des zones d'entête (plan fiches-lignes-documents, lot 12).
-- Un hôte peut exposer les colonnes « x_ » de document dans une vue (listes) : une vue qui cite une colonne empêche de la
-- retirer. Les fonctions de création et de retrait appellent donc, si l'hôte l'a définie, la fonction
-- public.document_zone_vue_liste(text) : après l'inscription d'une zone (argument nul : toutes les zones du registre) et avant
-- le retrait de la colonne (argument : la colonne à exclure). Sans cette fonction, rien ne change : le module ne connaît
-- aucune vue du cœur. Les droits d'exécution des deux fonctions sont conservés (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION document_zone_creer(p_colonne text, p_type text, p_libelle text, p_groupe text, p_ordre integer,
    p_obligatoire boolean, p_valeurs jsonb, p_famille text, p_tyd_id integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_sql text;
BEGIN
    IF p_colonne IS NULL OR p_colonne !~ '^x_[a-z][a-z0-9_]{0,40}$' THEN
        RAISE EXCEPTION 'ZONE_NOM_INVALIDE : nom de colonne invalide (%)', p_colonne USING ERRCODE = '22023';
    END IF;
    v_sql := CASE p_type
        WHEN 'texte' THEN 'text' WHEN 'nombre' THEN 'numeric' WHEN 'montant' THEN 'numeric(18,2)'
        WHEN 'date' THEN 'date' WHEN 'booleen' THEN 'boolean' WHEN 'liste' THEN 'text' END;
    IF v_sql IS NULL THEN
        RAISE EXCEPTION 'ZONE_TYPE_INVALIDE : type de zone invalide (%)', p_type USING ERRCODE = '22023';
    END IF;
    IF p_libelle IS NULL OR btrim(p_libelle) = '' THEN
        RAISE EXCEPTION 'ZONE_LIBELLE_OBLIGATOIRE : libellé obligatoire' USING ERRCODE = '22023';
    END IF;
    IF p_type = 'liste' AND (p_valeurs IS NULL OR jsonb_typeof(p_valeurs) <> 'array' OR jsonb_array_length(p_valeurs) = 0) THEN
        RAISE EXCEPTION 'ZONE_VALEURS : une liste demande au moins une valeur' USING ERRCODE = '22023';
    END IF;
    IF p_famille IS NOT NULL AND p_tyd_id IS NOT NULL THEN
        RAISE EXCEPTION 'ZONE_PORTEE_INVALIDE : une famille ou un type de document, pas les deux' USING ERRCODE = '22023';
    END IF;
    IF p_famille IS NOT NULL AND p_famille NOT IN ('V', 'A', 'S', 'E', 'T') THEN
        RAISE EXCEPTION 'ZONE_PORTEE_INVALIDE : famille inconnue (%)', p_famille USING ERRCODE = '22023';
    END IF;
    IF p_tyd_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.type_document WHERE tyd_id = p_tyd_id) THEN
        RAISE EXCEPTION 'ZONE_PORTEE_INVALIDE : type de document inconnu (%)', p_tyd_id USING ERRCODE = '22023';
    END IF;
    IF to_regclass('public.document') IS NULL THEN
        RAISE EXCEPTION 'ZONE_TABLE_ABSENTE : table document absente' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'document' AND column_name = p_colonne) THEN
        RAISE EXCEPTION 'ZONE_EXISTE : la colonne % existe déjà dans document', p_colonne USING ERRCODE = '42701';
    END IF;
    EXECUTE format('ALTER TABLE public.document ADD COLUMN %I %s', p_colonne, v_sql);
    INSERT INTO public.document_zone_entete (zed_colonne, zed_type, zed_libelle, zed_groupe, zed_ordre, zed_obligatoire, zed_valeurs, zed_famille, zed_tyd_id)
    VALUES (p_colonne, p_type, btrim(p_libelle), nullif(btrim(coalesce(p_groupe, '')), ''), coalesce(p_ordre, 0),
            coalesce(p_obligatoire, FALSE) AND p_type <> 'booleen', CASE WHEN p_type = 'liste' THEN p_valeurs END, p_famille, p_tyd_id);
    PERFORM public.document_zone_journaliser(p_colonne);
    IF to_regprocedure('public.document_zone_vue_liste(text)') IS NOT NULL THEN
        EXECUTE 'SELECT public.document_zone_vue_liste(NULL)';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION document_zone_retirer(p_colonne text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_colonne IS NULL OR p_colonne !~ '^x_[a-z][a-z0-9_]{0,40}$' THEN
        RAISE EXCEPTION 'ZONE_NOM_INVALIDE : nom de colonne invalide (%)', p_colonne USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.document_zone_entete WHERE zed_colonne = p_colonne) THEN
        RAISE EXCEPTION 'ZONE_INCONNUE : zone d''entête inconnue (%)', p_colonne USING ERRCODE = '22023';
    END IF;
    IF to_regprocedure('public.document_zone_vue_liste(text)') IS NOT NULL THEN
        EXECUTE format('SELECT public.document_zone_vue_liste(%L)', p_colonne);
    END IF;
    EXECUTE format('ALTER TABLE public.document DROP COLUMN IF EXISTS %I', p_colonne);
    DELETE FROM public.document_zone_entete WHERE zed_colonne = p_colonne;
END $$;
