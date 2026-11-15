-- =============================================================================
-- Module Fiche 1.1 – champs supplémentaires des fiches en colonnes « x_ » (versionnement du schéma, lot 7 ;
-- ANALYSE-VERSIONNEMENT-SCHEMA.md § 7.9 a, P21–P26).
-- Un champ supplémentaire créé depuis l'interface est une vraie colonne nullable « x_… » de la table principale d'une
-- fiche. L'API (rôle logibtp_app, non propriétaire) n'émet jamais le DDL : elle appelle les fonctions SECURITY DEFINER
-- ci-dessous, qui n'acceptent que :
--   - une table déclarée par un type de fiche actif (type_fiche.tyf_table, déclaré par le cœur : tables des fiches seulement) ;
--   - un nom « x_ » + minuscules, chiffres, « _ » (41 caractères au plus après « x_ » compris) ;
--   - un type permis (texte, nombre, montant, date, booleen, liste), donc un type SQL fixé ici ;
--   - une colonne nullable, sans défaut ni contrainte ; un retrait seulement d'une colonne inscrite au registre.
-- Les droits d'administration sont contrôlés par l'API (u.ExigerAdmin()). Les colonnes « x_ » sont ignorées par la dérive
-- et jamais touchées par les mises à jour. Registre et colonnes suivent la sauvegarde de la base.
-- =============================================================================

CREATE TABLE fiche_champ_supplementaire (
    fcs_table       VARCHAR(63)  NOT NULL,                       -- table d'une fiche (type_fiche.tyf_table)
    fcs_colonne     VARCHAR(63)  NOT NULL CHECK (fcs_colonne ~ '^x_[a-z][a-z0-9_]{0,40}$'),
    fcs_type        VARCHAR(20)  NOT NULL CHECK (fcs_type IN ('texte', 'nombre', 'montant', 'date', 'booleen', 'liste')),
    fcs_libelle     VARCHAR(100) NOT NULL,
    fcs_ordre       INTEGER      NOT NULL DEFAULT 0,
    fcs_valeurs     JSONB,                                       -- liste : [{ "valeur": …, "libelle": … }]
    fcs_actif       BOOLEAN      NOT NULL DEFAULT TRUE,
    fcs_cree_le     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    fcs_modifie_le  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (fcs_table, fcs_colonne)
);
COMMENT ON TABLE fiche_champ_supplementaire IS 'Registre des champs supplémentaires des fiches (colonnes x_ ajoutées par fiche_champ_creer)';

-- Journal des mises à jour : une ligne « zone » d'origine société par champ créé, si la table du journal existe
-- (elle est créée par l'installeur ; absente d'une base de développement construite par les scripts seuls).
CREATE FUNCTION fiche_champ_journaliser(p_table text, p_colonne text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF to_regclass('public.installation_script') IS NULL THEN RETURN; END IF;
    EXECUTE 'INSERT INTO public.installation_script (isc_chemin, isc_empreinte, isc_module, isc_version, isc_type, isc_origine)
             VALUES ($1, md5($1), $2, NULL, $3, $4)
             ON CONFLICT (isc_chemin) DO UPDATE SET isc_applique_le = now()'
        USING 'zone:fiche/' || p_table || '.' || p_colonne, 'fiche', 'zone', 'societe';
END $$;

-- Ajoute la colonne et son inscription au registre (une transaction : celle de l'appelant).
CREATE FUNCTION fiche_champ_creer(p_table text, p_colonne text, p_type text, p_libelle text, p_ordre integer, p_valeurs jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_sql text;
BEGIN
    IF p_colonne IS NULL OR p_colonne !~ '^x_[a-z][a-z0-9_]{0,40}$' THEN
        RAISE EXCEPTION 'CHAMP_NOM_INVALIDE : nom de colonne invalide (%)', p_colonne USING ERRCODE = '22023';
    END IF;
    v_sql := CASE p_type
        WHEN 'texte' THEN 'text' WHEN 'nombre' THEN 'numeric' WHEN 'montant' THEN 'numeric(18,2)'
        WHEN 'date' THEN 'date' WHEN 'booleen' THEN 'boolean' WHEN 'liste' THEN 'text' END;
    IF v_sql IS NULL THEN
        RAISE EXCEPTION 'CHAMP_TYPE_INVALIDE : type de champ invalide (%)', p_type USING ERRCODE = '22023';
    END IF;
    IF p_libelle IS NULL OR btrim(p_libelle) = '' THEN
        RAISE EXCEPTION 'CHAMP_LIBELLE_OBLIGATOIRE : libellé obligatoire' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.type_fiche WHERE tyf_table = p_table AND tyf_actif)
       OR to_regclass(format('public.%I', p_table)) IS NULL THEN
        RAISE EXCEPTION 'CHAMP_TABLE_FERMEE : table non ouverte aux champs supplémentaires (%)', p_table USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_colonne) THEN
        RAISE EXCEPTION 'CHAMP_EXISTE : la colonne % existe déjà dans %', p_colonne, p_table USING ERRCODE = '42701';
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s', p_table, p_colonne, v_sql);
    INSERT INTO public.fiche_champ_supplementaire (fcs_table, fcs_colonne, fcs_type, fcs_libelle, fcs_ordre, fcs_valeurs)
    VALUES (p_table, p_colonne, p_type, btrim(p_libelle), coalesce(p_ordre, 0), CASE WHEN p_type = 'liste' THEN p_valeurs END);
    PERFORM public.fiche_champ_journaliser(p_table, p_colonne);
END $$;

-- Retire la colonne et son inscription ; refus d'une colonne absente du registre (jamais une colonne de LogiBTP).
CREATE FUNCTION fiche_champ_retirer(p_table text, p_colonne text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_colonne IS NULL OR p_colonne !~ '^x_[a-z][a-z0-9_]{0,40}$' THEN
        RAISE EXCEPTION 'CHAMP_NOM_INVALIDE : nom de colonne invalide (%)', p_colonne USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fiche_champ_supplementaire WHERE fcs_table = p_table AND fcs_colonne = p_colonne) THEN
        RAISE EXCEPTION 'CHAMP_INCONNU : champ supplémentaire inconnu (%.%)', p_table, p_colonne USING ERRCODE = '22023';
    END IF;
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS %I', p_table, p_colonne);
    DELETE FROM public.fiche_champ_supplementaire WHERE fcs_table = p_table AND fcs_colonne = p_colonne;
END $$;

-- Exécution réservée à l'application : ni PUBLIC ni le rôle de lecture (db/installation/roles.sql le retire aussi après
-- son GRANT sur toutes les fonctions).
REVOKE ALL ON FUNCTION fiche_champ_journaliser(text, text), fiche_champ_creer(text, text, text, text, integer, jsonb),
    fiche_champ_retirer(text, text) FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logibtp_app') THEN
        GRANT EXECUTE ON FUNCTION fiche_champ_creer(text, text, text, text, integer, jsonb), fiche_champ_retirer(text, text) TO logibtp_app;
    END IF;
END $$;
