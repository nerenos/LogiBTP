-- =============================================================================
-- Module Annuaire – personnes (morales : groupe, société, établissement… ; particuliers) et individus (êtres
-- humains), rattachements des individus aux personnes, liens entre personnes, casquettes, coordonnées partagées.
--
-- Une coordonnée (adresse, téléphone, e-mail, site…) est stockée une fois et utilisée par plusieurs fiches
-- (personne, individu, rattachement) : à l'enregistrement d'une coordonnée partagée modifiée, l'utilisateur indique
-- s'il s'agit d'une modification (toutes les fiches la voient) ou d'une autre information (propre à la fiche).
-- Les valeurs remplacées sont historisées (coordonnee_historique).
-- =============================================================================

-- Recherche sans accents ni casse (personnes, individus) : même règle que f_sans_accent du module Liste et que
-- sansAccent du fournisseur mémoire (ligatures développées, décomposition NFD, diacritiques retirés, minuscules).
-- Pas d'unaccent : son dictionnaire transforme aussi la ponctuation (« – » → « - »). Rejouable seule sur une base
-- existante (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION f_annuaire_normaliser(texte TEXT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$ SELECT lower(regexp_replace(normalize(
        replace(replace(replace(replace(replace(translate(texte, 'øØđĐłŁ', 'oOdDlL'), 'œ', 'oe'), 'Œ', 'oe'), 'æ', 'ae'), 'Æ', 'ae'), 'ß', 'ss'),
        NFD), '[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]', '', 'g')) $$;

-- Niveaux de personne : groupe, société, établissement, agence, dépôt… ; particulier (personne physique cliente).
CREATE TABLE niveau_personne (
    niv_code        VARCHAR(20)   PRIMARY KEY,
    niv_libelle     VARCHAR(60)   NOT NULL,
    niv_icone       VARCHAR(16),
    niv_morale      BOOLEAN       NOT NULL DEFAULT TRUE,             -- FALSE : particulier (pas de SIRET, titulaire individu)
    niv_ordre       INT           NOT NULL DEFAULT 0,
    niv_actif       BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Casquettes (client, fournisseur, sous-traitant, intérim, architecte, MOE, BE, BC…) : filtres, et groupes de champs de
-- la fiche déverrouillés (codes de groupes de la définition de la fiche personne).
CREATE TABLE casquette (
    cas_code        VARCHAR(30)   PRIMARY KEY,
    cas_libelle     VARCHAR(60)   NOT NULL,
    cas_icone       VARCHAR(16),
    cas_groupes     JSONB         NOT NULL DEFAULT '[]',
    cas_ordre       INT           NOT NULL DEFAULT 0,
    cas_actif       BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Types de lien entre personnes (facturer à, livrer à, factor, partenaire…), avec le libellé vu depuis la cible.
CREATE TABLE type_lien (
    tli_code            VARCHAR(30)   PRIMARY KEY,
    tli_libelle         VARCHAR(60)   NOT NULL,
    tli_libelle_inverse VARCHAR(60)   NOT NULL,
    tli_ordre           INT           NOT NULL DEFAULT 0,
    tli_actif           BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Rôles internes des individus (salarié, chargé d'affaires, chiffreur, intérimaire, utilisateur…) : repris par les
-- autres modules (affaires, planning, droits) pour éviter les doubles saisies.
CREATE TABLE role_individu (
    rol_code        VARCHAR(30)   PRIMARY KEY,
    rol_libelle     VARCHAR(60)   NOT NULL,
    rol_icone       VARCHAR(16),
    rol_ordre       INT           NOT NULL DEFAULT 0,
    rol_actif       BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Personnes : entités avec lesquelles on travaille (personne morale à un niveau de la hiérarchie, ou particulier).
-- Identifiants pour la facturation électronique : SIREN / SIRET (France, contrôlés), TVA intracommunautaire,
-- identifiant étranger, adresse de facturation électronique (plateforme agréée, code de routage).
CREATE TABLE personne (
    per_id                  BIGSERIAL     PRIMARY KEY,
    per_code                VARCHAR(20)   UNIQUE,                    -- code du tiers (T000123 par défaut)
    per_niv_code            VARCHAR(20)   NOT NULL REFERENCES niveau_personne(niv_code),
    per_raison_sociale      VARCHAR(150)  NOT NULL,                  -- ou nom du particulier
    per_nom_commercial      VARCHAR(150),                            -- enseigne
    per_sigle               VARCHAR(30),
    per_parent_id           BIGINT        REFERENCES personne(per_id),  -- niveau supérieur (société d'un établissement…)
    per_casquettes          JSONB         NOT NULL DEFAULT '[]',     -- codes de casquette
    per_pays                CHAR(2)       NOT NULL DEFAULT 'FR',     -- ISO 3166-1
    per_siren               CHAR(9),
    per_siret               CHAR(14),
    per_tva_intra           VARCHAR(20),
    per_identifiant_etranger VARCHAR(40),                            -- hors France : n° d'enregistrement national
    per_naf                 VARCHAR(6),
    per_forme_juridique     VARCHAR(10),                             -- code de catégorie juridique INSEE
    per_forme_libelle       VARCHAR(100),
    per_capital             NUMERIC(18,2),
    per_rcs                 VARCHAR(60),
    per_date_creation       DATE,
    per_effectif            VARCHAR(40),
    per_etat_administratif  CHAR(1),                                 -- A actif, F fermé (annuaire des entreprises)
    per_siege               BOOLEAN,
    per_service_public      BOOLEAN       NOT NULL DEFAULT FALSE,    -- facturation via Chorus Pro
    -- facturation électronique
    per_fe_plateforme       VARCHAR(100),                            -- plateforme agréée (PA) de réception
    per_fe_adresse          VARCHAR(150),                            -- identifiant / adresse de facturation électronique
    per_fe_code_routage     VARCHAR(100),
    per_fe_format           VARCHAR(20),                             -- FACTURX, UBL, CII
    per_fe_code_service     VARCHAR(100),                            -- Chorus Pro : code service
    per_fe_engagement       BOOLEAN       NOT NULL DEFAULT FALSE,    -- Chorus Pro : n° d'engagement obligatoire
    -- règlement
    per_mode_reglement      VARCHAR(20),
    per_delai_paiement      VARCHAR(20),
    per_iban                VARCHAR(34),
    per_bic                 VARCHAR(11),
    per_devise              CHAR(3)       NOT NULL DEFAULT 'EUR',
    per_societe_base        BOOLEAN       NOT NULL DEFAULT FALSE,    -- la société de la base (une seule)
    per_actif               BOOLEAN       NOT NULL DEFAULT TRUE,
    per_commentaire         TEXT,
    per_proprietes          JSONB         NOT NULL DEFAULT '{}',     -- champs supplémentaires (module Fiche)
    per_cree_le             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    per_modifie_le          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CHECK (per_parent_id IS NULL OR per_parent_id <> per_id),
    CHECK (per_siren IS NULL OR per_siren ~ '^[0-9]{9}$'),
    CHECK (per_siret IS NULL OR per_siret ~ '^[0-9]{14}$')
);
CREATE UNIQUE INDEX ux_per_siret ON personne (per_siret) WHERE per_siret IS NOT NULL;
CREATE UNIQUE INDEX ux_per_societe_base ON personne (per_societe_base) WHERE per_societe_base;
CREATE INDEX ix_per_parent ON personne (per_parent_id);
CREATE INDEX ix_per_siren ON personne (per_siren);
CREATE INDEX ix_per_casquettes ON personne USING gin (per_casquettes);

-- Individus : êtres humains (contacts, dirigeants, salariés, particuliers…).
CREATE TABLE individu (
    ind_id              BIGSERIAL     PRIMARY KEY,
    ind_civilite        VARCHAR(10),                                 -- M., Mme
    ind_nom             VARCHAR(80)   NOT NULL,
    ind_prenom          VARCHAR(80),
    ind_date_naissance  DATE,
    ind_pays            CHAR(2)       NOT NULL DEFAULT 'FR',
    ind_roles           JSONB         NOT NULL DEFAULT '[]',         -- codes de rôle interne
    ind_utilisateur     VARCHAR(50)   UNIQUE,                        -- identifiant de connexion (module de droits)
    ind_actif           BOOLEAN       NOT NULL DEFAULT TRUE,
    ind_commentaire     TEXT,
    ind_proprietes      JSONB         NOT NULL DEFAULT '{}',
    ind_cree_le         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ind_modifie_le      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_ind_nom ON individu (lower(ind_nom), lower(ind_prenom));

-- Rattachement d'un individu à une personne (salarié, dirigeant, contact, titulaire d'un compte particulier…) :
-- ses coordonnées propres (portable, e-mail professionnels) sont des usages du rattachement.
CREATE TABLE rattachement (
    rat_id          BIGSERIAL     PRIMARY KEY,
    rat_ind_id      BIGINT        NOT NULL REFERENCES individu(ind_id) ON DELETE CASCADE,
    rat_per_id      BIGINT        NOT NULL REFERENCES personne(per_id) ON DELETE CASCADE,
    rat_fonction    VARCHAR(100),
    rat_service     VARCHAR(100),
    rat_principal   BOOLEAN       NOT NULL DEFAULT FALSE,            -- contact principal de la personne
    rat_titulaire   BOOLEAN       NOT NULL DEFAULT FALSE,            -- titulaire du compte particulier
    rat_debut       DATE,
    rat_fin         DATE,
    rat_actif       BOOLEAN       NOT NULL DEFAULT TRUE,
    rat_commentaire VARCHAR(500),
    rat_modifie_le  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (rat_ind_id, rat_per_id)
);
CREATE INDEX ix_rat_per ON rattachement (rat_per_id);

-- Liens entre personnes (en plus de la hiérarchie per_parent_id).
CREATE TABLE lien_personne (
    lpe_id          BIGSERIAL     PRIMARY KEY,
    lpe_per_id      BIGINT        NOT NULL REFERENCES personne(per_id) ON DELETE CASCADE,
    lpe_cible_id    BIGINT        NOT NULL REFERENCES personne(per_id) ON DELETE CASCADE,
    lpe_tli_code    VARCHAR(30)   NOT NULL REFERENCES type_lien(tli_code),
    lpe_commentaire VARCHAR(500),
    lpe_debut       DATE,
    lpe_fin         DATE,
    CHECK (lpe_per_id <> lpe_cible_id),
    UNIQUE (lpe_per_id, lpe_cible_id, lpe_tli_code)
);
CREATE INDEX ix_lpe_cible ON lien_personne (lpe_cible_id);

-- Coordonnée : valeur partagée par ses usages. Nature : ADRESSE, TELEPHONE, EMAIL, WEB (site, page, réseau social,
-- pseudo). Adresse : lignes, code postal, ville, pays ; sinon valeur (numéro, e-mail, URL, pseudo).
CREATE TABLE coordonnee (
    coo_id          BIGSERIAL     PRIMARY KEY,
    coo_nature      VARCHAR(10)   NOT NULL CHECK (coo_nature IN ('ADRESSE','TELEPHONE','EMAIL','WEB')),
    coo_valeur      VARCHAR(300),
    coo_ligne1      VARCHAR(150),
    coo_ligne2      VARCHAR(150),
    coo_ligne3      VARCHAR(150),
    coo_code_postal VARCHAR(20),
    coo_ville       VARCHAR(100),
    coo_pays        CHAR(2),
    coo_reseau      VARCHAR(30),                                      -- WEB : SITE, LINKEDIN, FACEBOOK, INSTAGRAM, X, PSEUDO…
    coo_modifie_le  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    coo_modifie_par VARCHAR(50)
);

-- Usage d'une coordonnée par une fiche (une seule : personne, individu ou rattachement), qualifié : adresse de
-- facturation, de commande, de livraison… ; téléphone fixe, portable, professionnel, personnel… ; principal.
CREATE TABLE usage_coordonnee (
    uco_id          BIGSERIAL     PRIMARY KEY,
    uco_coo_id      BIGINT        NOT NULL REFERENCES coordonnee(coo_id),
    uco_per_id      BIGINT        REFERENCES personne(per_id) ON DELETE CASCADE,
    uco_ind_id      BIGINT        REFERENCES individu(ind_id) ON DELETE CASCADE,
    uco_rat_id      BIGINT        REFERENCES rattachement(rat_id) ON DELETE CASCADE,
    uco_usage       VARCHAR(20),
    uco_libelle     VARCHAR(100),
    uco_principal   BOOLEAN       NOT NULL DEFAULT FALSE,
    uco_ordre       INT           NOT NULL DEFAULT 0,
    CHECK (num_nonnulls(uco_per_id, uco_ind_id, uco_rat_id) = 1)
);
CREATE INDEX ix_uco_coo ON usage_coordonnee (uco_coo_id);
CREATE INDEX ix_uco_per ON usage_coordonnee (uco_per_id);
CREATE INDEX ix_uco_ind ON usage_coordonnee (uco_ind_id);
CREATE INDEX ix_uco_rat ON usage_coordonnee (uco_rat_id);

-- Historique des valeurs d'une coordonnée (modification : correction, déménagement…).
CREATE TABLE coordonnee_historique (
    coh_id          BIGSERIAL     PRIMARY KEY,
    coh_coo_id      BIGINT        NOT NULL REFERENCES coordonnee(coo_id) ON DELETE CASCADE,
    coh_avant       JSONB         NOT NULL,
    coh_le          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    coh_par         VARCHAR(50)
);

CREATE FUNCTION f_coordonnee_historique() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.coo_valeur, OLD.coo_ligne1, OLD.coo_ligne2, OLD.coo_ligne3, OLD.coo_code_postal, OLD.coo_ville, OLD.coo_pays, OLD.coo_reseau)
       IS DISTINCT FROM (NEW.coo_valeur, NEW.coo_ligne1, NEW.coo_ligne2, NEW.coo_ligne3, NEW.coo_code_postal, NEW.coo_ville, NEW.coo_pays, NEW.coo_reseau) THEN
        INSERT INTO coordonnee_historique (coh_coo_id, coh_avant, coh_par)
        VALUES (OLD.coo_id, to_jsonb(OLD) - 'coo_id' - 'coo_modifie_le' - 'coo_modifie_par', NEW.coo_modifie_par);
        NEW.coo_modifie_le := now();
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_coordonnee_historique BEFORE UPDATE ON coordonnee FOR EACH ROW EXECUTE FUNCTION f_coordonnee_historique();

-- Code du tiers par défaut et date de modification.
CREATE FUNCTION f_personne_avant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.per_code IS NULL OR btrim(NEW.per_code) = '' THEN
        NEW.per_code := 'T' || lpad(NEW.per_id::text, 6, '0');
    END IF;
    NEW.per_modifie_le := now();
    RETURN NEW;
END $$;
CREATE TRIGGER tg_personne_avant BEFORE INSERT OR UPDATE ON personne FOR EACH ROW EXECUTE FUNCTION f_personne_avant();

CREATE FUNCTION f_individu_avant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.ind_modifie_le := now();
    RETURN NEW;
END $$;
CREATE TRIGGER tg_individu_avant BEFORE UPDATE ON individu FOR EACH ROW EXECUTE FUNCTION f_individu_avant();

-- Coordonnée principale d'une nature pour une fiche (texte affichable : adresse sur une ligne ou valeur).
CREATE FUNCTION f_texte_coordonnee(c coordonnee) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN c.coo_nature = 'ADRESSE'
        THEN nullif(concat_ws(', ', nullif(c.coo_ligne1, ''), nullif(c.coo_ligne2, ''), nullif(c.coo_ligne3, ''),
                    nullif(concat_ws(' ', nullif(c.coo_code_postal, ''), nullif(c.coo_ville, '')), ''),
                    CASE WHEN c.coo_pays IS NOT NULL AND c.coo_pays <> 'FR' THEN c.coo_pays END), '')
        ELSE c.coo_valeur END
$$;

-- Hiérarchie des personnes : chemin depuis la racine (Groupe › Société › Établissement).
CREATE VIEW v_personne_chemin AS
WITH RECURSIVE h AS (
    SELECT per_id, per_parent_id, per_raison_sociale::text AS chemin, 1 AS profondeur, ARRAY[per_id] AS ids
    FROM personne WHERE per_parent_id IS NULL
    UNION ALL
    SELECT p.per_id, p.per_parent_id, h.chemin || ' › ' || p.per_raison_sociale, h.profondeur + 1, h.ids || p.per_id
    FROM personne p JOIN h ON p.per_parent_id = h.per_id
    WHERE NOT p.per_id = ANY(h.ids)
)
SELECT per_id, chemin, profondeur FROM h;

-- Usages de coordonnées par fiche, avec la coordonnée : personne, individu (coordonnées personnelles) ou individu par
-- ses rattachements actifs (coordonnées professionnelles). Ordre d'une coordonnée principale : principal, rang, usage.
CREATE VIEW v_annuaire_usages AS
SELECT u.uco_per_id AS per_id, coalesce(u.uco_ind_id, r.rat_ind_id) AS ind_id, (u.uco_rat_id IS NOT NULL) AS pro,
       u.uco_id, u.uco_usage, u.uco_principal, u.uco_ordre, c.coo_nature, c.coo_ville, c.coo_code_postal, f_texte_coordonnee(c) AS texte
FROM usage_coordonnee u
JOIN coordonnee c ON c.coo_id = u.uco_coo_id
LEFT JOIN rattachement r ON r.rat_id = u.uco_rat_id
WHERE u.uco_rat_id IS NULL OR r.rat_actif;

-- Personnes avec niveau, parent, chemin, ville, coordonnées principales et contact principal (listes, recherches).
CREATE VIEW v_annuaire_personnes AS
WITH adr AS (SELECT DISTINCT ON (per_id) per_id, coo_ville, coo_code_postal, texte FROM v_annuaire_usages
             WHERE per_id IS NOT NULL AND coo_nature = 'ADRESSE' ORDER BY per_id, uco_principal DESC, uco_ordre, uco_id),
     tel AS (SELECT DISTINCT ON (per_id) per_id, texte FROM v_annuaire_usages
             WHERE per_id IS NOT NULL AND coo_nature = 'TELEPHONE' ORDER BY per_id, uco_principal DESC, uco_ordre, uco_id),
     mel AS (SELECT DISTINCT ON (per_id) per_id, texte FROM v_annuaire_usages
             WHERE per_id IS NOT NULL AND coo_nature = 'EMAIL' ORDER BY per_id, uco_principal DESC, uco_ordre, uco_id),
     contact AS (SELECT DISTINCT ON (r.rat_per_id) r.rat_per_id AS per_id, concat_ws(' ', i.ind_civilite, i.ind_prenom, i.ind_nom) AS libelle
                 FROM rattachement r JOIN individu i ON i.ind_id = r.rat_ind_id WHERE r.rat_actif
                 ORDER BY r.rat_per_id, r.rat_principal DESC, r.rat_id)
SELECT p.per_id, p.per_code, p.per_niv_code, n.niv_libelle, n.niv_icone, n.niv_morale, p.per_raison_sociale, p.per_nom_commercial,
       p.per_parent_id, par.per_raison_sociale AS parent, h.chemin, p.per_casquettes, p.per_pays, p.per_siren, p.per_siret,
       p.per_tva_intra, p.per_societe_base, p.per_actif, p.per_modifie_le,
       adr.coo_ville AS ville, adr.coo_code_postal AS code_postal, adr.texte AS adresse, tel.texte AS telephone, mel.texte AS email, contact.libelle AS contact
FROM personne p
JOIN niveau_personne n ON n.niv_code = p.per_niv_code
LEFT JOIN personne par ON par.per_id = p.per_parent_id
LEFT JOIN v_personne_chemin h ON h.per_id = p.per_id
LEFT JOIN adr ON adr.per_id = p.per_id
LEFT JOIN tel ON tel.per_id = p.per_id
LEFT JOIN mel ON mel.per_id = p.per_id
LEFT JOIN contact ON contact.per_id = p.per_id;

-- Individus avec personnes rattachées, fonction, téléphone et e-mail (professionnels d'abord), portable, ville.
CREATE VIEW v_annuaire_individus AS
WITH tel AS (SELECT DISTINCT ON (ind_id) ind_id, texte FROM v_annuaire_usages
             WHERE ind_id IS NOT NULL AND coo_nature = 'TELEPHONE' AND uco_usage IS DISTINCT FROM 'PORTABLE'
             ORDER BY ind_id, pro DESC, uco_principal DESC, uco_ordre, uco_id),
     portable AS (SELECT DISTINCT ON (ind_id) ind_id, texte FROM v_annuaire_usages
                  WHERE ind_id IS NOT NULL AND coo_nature = 'TELEPHONE' AND uco_usage = 'PORTABLE'
                  ORDER BY ind_id, pro DESC, uco_principal DESC, uco_ordre, uco_id),
     mel AS (SELECT DISTINCT ON (ind_id) ind_id, texte FROM v_annuaire_usages
             WHERE ind_id IS NOT NULL AND coo_nature = 'EMAIL' ORDER BY ind_id, pro DESC, uco_principal DESC, uco_ordre, uco_id),
     adr AS (SELECT DISTINCT ON (ind_id) ind_id, coo_ville FROM v_annuaire_usages
             WHERE ind_id IS NOT NULL AND NOT pro AND coo_nature = 'ADRESSE' ORDER BY ind_id, uco_principal DESC, uco_ordre, uco_id),
     rats AS (SELECT r.rat_ind_id AS ind_id, string_agg(p.per_raison_sociale, ', ' ORDER BY r.rat_id) AS personnes,
                     (array_agg(r.rat_fonction ORDER BY r.rat_id) FILTER (WHERE r.rat_fonction IS NOT NULL))[1] AS fonction
              FROM rattachement r JOIN personne p ON p.per_id = r.rat_per_id WHERE r.rat_actif GROUP BY r.rat_ind_id)
SELECT i.ind_id, i.ind_civilite, i.ind_nom, i.ind_prenom, concat_ws(' ', upper(i.ind_nom), i.ind_prenom) AS nom_complet,
       concat_ws(' ', i.ind_civilite, i.ind_prenom, i.ind_nom) AS libelle, i.ind_roles, i.ind_utilisateur, i.ind_actif, i.ind_modifie_le,
       rats.personnes, rats.fonction, tel.texte AS telephone, portable.texte AS portable, mel.texte AS email, adr.coo_ville AS ville
FROM individu i
LEFT JOIN rats ON rats.ind_id = i.ind_id
LEFT JOIN tel ON tel.ind_id = i.ind_id
LEFT JOIN portable ON portable.ind_id = i.ind_id
LEFT JOIN mel ON mel.ind_id = i.ind_id
LEFT JOIN adr ON adr.ind_id = i.ind_id;
