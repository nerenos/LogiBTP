-- =============================================================================
-- Module Liste – vues de liste paramétrables et sources de données déclarées.
-- Le module ne connaît pas les données de l'hôte : l'application déclare ses sources (vues SQL)
-- dans source_liste ; une vue de liste peut aussi reposer sur une requête SELECT saisie par un ADMIN.
-- =============================================================================

-- Recherche « contient » sans casse ni accents : exactement normaliser() côté JS (ligatures développées, décomposition
-- NFD, marques diacritiques retirées, minuscules). Pas d'unaccent : son dictionnaire transforme aussi la ponctuation
-- (« – » → « - », « … » → « ... »), ce que le JS ne fait pas. IMMUTABLE pour servir dans un index d'expression.
CREATE OR REPLACE FUNCTION f_sans_accent(texte TEXT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$ SELECT lower(regexp_replace(normalize(
        replace(replace(replace(replace(replace(translate(texte, 'øØđĐłŁ', 'oOdDlL'), 'œ', 'oe'), 'Œ', 'oe'), 'æ', 'ae'), 'Æ', 'ae'), 'ß', 'ss'),
        NFD), '[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]', '', 'g')) $$;

-- Sources déclarées par l'application : une vue SQL par type de liste, avec la colonne
-- identifiant et le type d'élément (colonne ou constante) qui permettent d'ouvrir la fiche.
CREATE TABLE source_liste (
    sli_code           VARCHAR(50)   PRIMARY KEY,
    sli_libelle        VARCHAR(100)  NOT NULL,
    sli_vue            VARCHAR(100)  NOT NULL,                     -- nom de la vue SQL (schéma public)
    sli_colonne_id     VARCHAR(63)   NOT NULL,
    sli_colonne_type   VARCHAR(63),                                -- colonne portant le type d'élément…
    sli_type_element   VARCHAR(50),                                -- …ou type constant
    sli_actif          BOOLEAN       NOT NULL DEFAULT TRUE,
    CONSTRAINT ck_sli_type CHECK (sli_colonne_type IS NOT NULL OR sli_type_element IS NOT NULL)
);

-- Vues de liste : définition complète (source, colonnes, mise en forme, segments, tri) en JSONB.
CREATE TABLE vue_liste (
    vli_id             BIGSERIAL     PRIMARY KEY,
    vli_nom            VARCHAR(100)  NOT NULL,
    vli_contexte       VARCHAR(50),                                -- écran où la vue est proposée (documents…)
    vli_partage        CHAR(1)       NOT NULL DEFAULT 'P'
                       CHECK (vli_partage IN ('P','G','T')),       -- Personnelle, Groupe, Tous
    vli_proprietaire   VARCHAR(50)   NOT NULL,
    vli_groupe         VARCHAR(50),
    vli_definition     JSONB         NOT NULL,
    vli_version        INT           NOT NULL DEFAULT 1,           -- verrouillage optimiste
    vli_cree_le        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    vli_modifie_le     TIMESTAMPTZ
);
CREATE INDEX ix_vli_contexte ON vue_liste (vli_contexte, vli_partage);
CREATE INDEX ix_vli_proprietaire ON vue_liste (vli_proprietaire);
