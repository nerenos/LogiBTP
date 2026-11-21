-- requiert: document 1.3
-- =============================================================================
-- Cœur – zones d'entête des documents dans les listes (plan fiches-lignes-documents, lot 12).
-- Les colonnes « x_ » de document (module Document 1.2) sont exposées à la source de liste « documents » par la vue
-- v_liste_documents_zones : v_liste_documents (colonnes inchangées) suivie d'une colonne par zone du registre, jointe à
-- document ; sans zone, la vue est v_liste_documents seule (aucune jointure). La vue est reconstruite par
-- document_zone_vue_liste(exclue), appelée par les fonctions de création et de retrait des zones (module Document 1.3) :
-- après une création (argument nul), avant un retrait (argument : la colonne à exclure, une vue qui la cite bloquerait
-- le DROP COLUMN). Fonction SECURITY DEFINER (l'API n'est pas propriétaire du schéma), les droits de lecture viennent des
-- privilèges par défaut du propriétaire.
-- À RAPPELER après toute reprise de v_liste_documents qui ajoute des colonnes : SELECT document_zone_vue_liste(NULL);
-- (la vue figerait sinon la liste des colonnes de la reprise précédente).
-- =============================================================================

CREATE OR REPLACE FUNCTION document_zone_vue_liste(p_exclue text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_colonnes text;
BEGIN
    SELECT string_agg(format('d.%I', z.zed_colonne), ', ' ORDER BY z.zed_colonne) INTO v_colonnes
      FROM public.document_zone_entete z
     WHERE z.zed_colonne IS DISTINCT FROM p_exclue AND z.zed_colonne ~ '^x_[a-z][a-z0-9_]{0,40}$';
    DROP VIEW IF EXISTS public.v_liste_documents_zones;
    IF v_colonnes IS NULL THEN
        CREATE VIEW public.v_liste_documents_zones AS SELECT v.* FROM public.v_liste_documents v;
    ELSE
        EXECUTE 'CREATE VIEW public.v_liste_documents_zones AS SELECT v.*, ' || v_colonnes
             || ' FROM public.v_liste_documents v JOIN public.document d ON d.ent_id = v.id';
    END IF;
END $$;

REVOKE ALL ON FUNCTION document_zone_vue_liste(text) FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logibtp_app') THEN
        GRANT EXECUTE ON FUNCTION document_zone_vue_liste(text) TO logibtp_app;
    END IF;
END $$;

SELECT document_zone_vue_liste(NULL);
