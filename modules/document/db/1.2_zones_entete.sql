-- =============================================================================
-- Module Document 1.2 – zones supplémentaires d'entête en colonnes « x_ » de la table document (plan
-- fiches-lignes-documents, lot 10 ; décisions Q20 a, Q21 a, Q22 a). Même mécanisme que les champs supplémentaires des
-- fiches (module Fiche 1.1) : une zone créée depuis l'interface est une vraie colonne nullable « x_… » de `document`.
-- L'API (rôle logibtp_app, non propriétaire) n'émet jamais le DDL : elle appelle les fonctions SECURITY DEFINER
-- ci-dessous, qui n'acceptent que :
--   - la seule table `document` (jamais une autre) ;
--   - un nom « x_ » + minuscules, chiffres, « _ » (41 caractères au plus après « x_ » compris) ;
--   - un type permis (texte, nombre, montant, date, booleen, liste), donc un type SQL fixé ici ;
--   - une portée : global (famille et type nuls), famille (V, A, S, E, T) ou type de document, jamais les deux ;
--   - une colonne nullable, sans défaut ni contrainte ; un retrait seulement d'une colonne inscrite au registre.
-- Les droits d'administration sont contrôlés par l'API (u.ExigerAdmin()). Les colonnes « x_ » sont ignorées par la dérive
-- (module Installation : tout objet dont un nom commence par x_) et jamais touchées par les mises à jour. Registre et
-- colonnes suivent la sauvegarde de la base. Le document ne lit ni n'écrit encore ces colonnes (lot 11).
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_zone_entete (
    zed_colonne     VARCHAR(63)  PRIMARY KEY CHECK (zed_colonne ~ '^x_[a-z][a-z0-9_]{0,40}$'),
    zed_type        VARCHAR(20)  NOT NULL CHECK (zed_type IN ('texte', 'nombre', 'montant', 'date', 'booleen', 'liste')),
    zed_libelle     VARCHAR(100) NOT NULL,
    zed_groupe      VARCHAR(100),                                -- groupe de l'onglet Entête (libre) ; nul : groupe par défaut
    zed_ordre       INTEGER      NOT NULL DEFAULT 0,
    zed_obligatoire BOOLEAN      NOT NULL DEFAULT FALSE,         -- contrôlé à la validation du document (lot 11) ; jamais pour un booléen
    zed_valeurs     JSONB,                                       -- liste : [{ "valeur": …, "libelle": … }]
    zed_famille     CHAR(1)      CHECK (zed_famille IN ('V', 'A', 'S', 'E', 'T')),
    zed_tyd_id      INTEGER      REFERENCES type_document (tyd_id),   -- sans cascade : un type qui porte des zones ne se supprime pas
    zed_actif       BOOLEAN      NOT NULL DEFAULT TRUE,
    zed_cree_le     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    zed_modifie_le  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT document_zone_entete_portee CHECK (zed_tyd_id IS NULL OR zed_famille IS NULL)
);
COMMENT ON TABLE document_zone_entete IS 'Registre des zones supplémentaires d''entête des documents (colonnes x_ ajoutées par document_zone_creer)';

-- Journal des mises à jour : une ligne « zone » d'origine société par zone créée, si la table du journal existe
-- (elle est créée par l'installeur ; absente d'une base de développement construite par les scripts seuls).
CREATE OR REPLACE FUNCTION document_zone_journaliser(p_colonne text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF to_regclass('public.installation_script') IS NULL THEN RETURN; END IF;
    EXECUTE 'INSERT INTO public.installation_script (isc_chemin, isc_empreinte, isc_module, isc_version, isc_type, isc_origine)
             VALUES ($1, md5($1), $2, NULL, $3, $4)
             ON CONFLICT (isc_chemin) DO UPDATE SET isc_applique_le = now()'
        USING 'zone:document/document.' || p_colonne, 'document', 'zone', 'societe';
END $$;

-- Ajoute la colonne et son inscription au registre (une transaction : celle de l'appelant).
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
END $$;

-- Retire la colonne et son inscription ; refus d'une colonne absente du registre (jamais une colonne de LogiBTP).
CREATE OR REPLACE FUNCTION document_zone_retirer(p_colonne text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_colonne IS NULL OR p_colonne !~ '^x_[a-z][a-z0-9_]{0,40}$' THEN
        RAISE EXCEPTION 'ZONE_NOM_INVALIDE : nom de colonne invalide (%)', p_colonne USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.document_zone_entete WHERE zed_colonne = p_colonne) THEN
        RAISE EXCEPTION 'ZONE_INCONNUE : zone d''entête inconnue (%)', p_colonne USING ERRCODE = '22023';
    END IF;
    EXECUTE format('ALTER TABLE public.document DROP COLUMN IF EXISTS %I', p_colonne);
    DELETE FROM public.document_zone_entete WHERE zed_colonne = p_colonne;
END $$;

-- Exécution réservée à l'application : ni PUBLIC ni le rôle de lecture.
REVOKE ALL ON FUNCTION document_zone_journaliser(text),
    document_zone_creer(text, text, text, text, integer, boolean, jsonb, text, integer), document_zone_retirer(text) FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logibtp_app') THEN
        GRANT EXECUTE ON FUNCTION document_zone_creer(text, text, text, text, integer, boolean, jsonb, text, integer),
            document_zone_retirer(text) TO logibtp_app;
    END IF;
END $$;
