-- =============================================================================
-- Module Fiche – fiches d'éléments (salarié, matériel…) ouvertes à partir d'un type et d'un ID.
-- Le module ne connaît pas les tables de l'hôte : chaque type de fiche décrit sa table, sa clé, ses champs
-- (colonne, type, format, obligatoire, confidentiel) et la colonne JSONB des champs supplémentaires.
-- =============================================================================

-- Types de fiches déclarés par l'application.
CREATE TABLE type_fiche (
    tyf_code               VARCHAR(50)   PRIMARY KEY,               -- type d'élément (salarie, materiel…)
    tyf_libelle            VARCHAR(100)  NOT NULL,
    tyf_table              VARCHAR(100)  NOT NULL,                  -- table (schéma public) lue et écrite par la fiche
    tyf_cle                VARCHAR(63)   NOT NULL,                  -- colonne identifiant
    tyf_colonne_proprietes VARCHAR(63),                             -- colonne JSONB des champs supplémentaires
    tyf_definition         JSONB         NOT NULL,                  -- titre, sections, champs du programme
    tyf_actif              BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Droits par profil et par type : VOIR, MODIFIER (création, copie, modification), DEBLOQUER (reprendre la main
-- sur une fiche en cours de modification par un autre), CONFIDENTIEL (données RH, RGPD…).
CREATE TABLE droit_fiche (
    drf_profil   VARCHAR(50)  NOT NULL,
    drf_type     VARCHAR(50)  NOT NULL REFERENCES type_fiche(tyf_code) ON DELETE CASCADE,
    drf_action   VARCHAR(20)  NOT NULL CHECK (drf_action IN ('VOIR','MODIFIER','DEBLOQUER','CONFIDENTIEL','SUPPRIMER','MODIFIER_CODE')),
    PRIMARY KEY (drf_profil, drf_type, drf_action)
);

-- Paramétrage utilisateur des champs du programme : rendre obligatoire un champ facultatif, rendre confidentiel
-- (RGPD : masqué, révélé et journalisé) un champ du logiciel.
CREATE TABLE parametre_champ_fiche (
    pcf_type         VARCHAR(50)  NOT NULL REFERENCES type_fiche(tyf_code) ON DELETE CASCADE,
    pcf_champ        VARCHAR(63)  NOT NULL,
    pcf_obligatoire  BOOLEAN      NOT NULL DEFAULT FALSE,
    pcf_confidentiel BOOLEAN      NOT NULL DEFAULT FALSE,
    PRIMARY KEY (pcf_type, pcf_champ)
);

-- Champs supplémentaires paramétrés : valeurs stockées dans la colonne JSONB du type (tyf_colonne_proprietes).
CREATE TABLE champ_supplementaire (
    chs_type         VARCHAR(50)   NOT NULL REFERENCES type_fiche(tyf_code) ON DELETE CASCADE,
    chs_code         VARCHAR(63)   NOT NULL,
    chs_libelle      VARCHAR(100)  NOT NULL,
    chs_type_donnee  VARCHAR(20)   NOT NULL CHECK (chs_type_donnee IN ('texte','nombre','booleen','date','liste','motdepasse')),
    chs_format       VARCHAR(100),                                  -- email, telephone, code_postal, 999.99, regex:…
    chs_longueur     INT,
    chs_obligatoire  BOOLEAN       NOT NULL DEFAULT FALSE,
    chs_confidentiel BOOLEAN       NOT NULL DEFAULT FALSE,
    chs_options      JSONB,                                         -- liste : [{ "valeur": "A", "libelle": "…" }]
    chs_requete      TEXT,                                          -- liste : SELECT valeur, libelle … (lecture seule)
    chs_aide         VARCHAR(200),
    chs_section      VARCHAR(50),                                   -- onglet de la définition (sinon Informations complémentaires)
    chs_groupe       VARCHAR(100),                                  -- cadre titré qui regroupe les champs
    chs_ordre        INT           NOT NULL DEFAULT 0,
    chs_actif        BOOLEAN       NOT NULL DEFAULT TRUE,
    PRIMARY KEY (chs_type, chs_code)
);

-- Verrou de modification : une seule personne modifie une fiche. Renouvelé par le poste (battement) ; un verrou
-- non renouvelé expire. Un utilisateur ayant le droit DEBLOQUER peut reprendre la main.
CREATE TABLE verrou_fiche (
    vef_type        VARCHAR(50)   NOT NULL,
    vef_id          VARCHAR(100)  NOT NULL,
    vef_utilisateur VARCHAR(50)   NOT NULL,
    vef_jeton       UUID          NOT NULL,                         -- session de modification (un onglet, un poste)
    vef_depuis      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    vef_renouvele   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (vef_type, vef_id)
);

-- Journal des accès aux informations confidentielles (RGPD : qui a consulté quoi et quand).
CREATE TABLE journal_confidentiel (
    jcf_id          BIGSERIAL     PRIMARY KEY,
    jcf_type        VARCHAR(50)   NOT NULL,
    jcf_element     VARCHAR(100)  NOT NULL,
    jcf_utilisateur VARCHAR(50)   NOT NULL,
    jcf_champs      TEXT[]        NOT NULL,
    jcf_date        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_jcf_element ON journal_confidentiel (jcf_type, jcf_element, jcf_date);
