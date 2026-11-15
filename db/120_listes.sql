-- =============================================================================
-- Cœur LogiBTP – sources de listes (vues SQL), tables des salariés, matériels, équipes et sous-traitants de
-- démonstration (vides : leurs données sont dans 120b_listes_demo.sql, script de démonstration).
-- Les sources sont déclarées dans source_liste et les vues par défaut dans vue_liste par
-- 121_listes_parametrage.sql (généré depuis client/src/app/vues-liste.js).
-- =============================================================================

-- Documents : une ligne par document ; type_element = code du type (V_DEVIS, V_FACTURE…) pour ouvrir la fiche.
CREATE VIEW v_liste_documents AS
SELECT d.ent_id                                   AS id,
       t.tyd_code                                 AS type_element,
       t.tyd_libelle                              AS type_document,
       t.tyd_famille                              AS famille,
       d.ent_numero                               AS numero,
       d.ent_indice                               AS indice,
       d.ent_date                                 AS date_document,
       d.ent_objet                                AS objet,
       d.ent_proprietes ->> 'chantier'            AS chantier,
       s.std_libelle                              AS statut,
       d.ent_tiers_id                             AS tiers,
       d.ent_total_ht                             AS total_ht,
       d.ent_total_ttc                            AS total_ttc,
       d.ent_net_a_payer                          AS net_a_payer,
       d.ent_is_reference                         AS reference,
       d.ent_verrouille                           AS verrouille,
       coalesce(d.ent_modifie_le, d.ent_cree_le)  AS modifie_le
FROM document d
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
JOIN statut_document s ON s.std_id = d.ent_std_id;

-- Salariés et matériels (tables du cœur en attendant les modules RH et Matériel ; données de démonstration : 120b).
CREATE TABLE salarie (
    sal_id          SERIAL        PRIMARY KEY,
    sal_matricule   VARCHAR(10)   NOT NULL UNIQUE,
    sal_nom         VARCHAR(60)   NOT NULL,
    sal_prenom      VARCHAR(60)   NOT NULL,
    sal_service     VARCHAR(30)   NOT NULL,
    sal_poste       VARCHAR(60)   NOT NULL,
    sal_statut      VARCHAR(10)   NOT NULL CHECK (sal_statut IN ('CDI','CDD','INTERIM')),
    sal_date_entree DATE          NOT NULL,
    sal_salaire     NUMERIC(18,2) NOT NULL,
    sal_heures_mois NUMERIC(8,2)  NOT NULL DEFAULT 151.67,
    sal_actif       BOOLEAN       NOT NULL DEFAULT TRUE,
    sal_commentaire TEXT
);

CREATE TABLE materiel (
    mat_id              SERIAL        PRIMARY KEY,
    mat_code            VARCHAR(10)   NOT NULL,
    mat_designation     VARCHAR(100)  NOT NULL,
    mat_famille         VARCHAR(30)   NOT NULL,
    mat_etat            VARCHAR(10)   NOT NULL CHECK (mat_etat IN ('DISPO','CHANTIER','PANNE','REBUT')),
    mat_chantier        VARCHAR(100),
    mat_valeur_achat    NUMERIC(18,2) NOT NULL,
    mat_date_achat      DATE          NOT NULL,
    mat_heures          INT           NOT NULL,
    mat_heures_revision INT           NOT NULL,
    mat_controle_ok     BOOLEAN       NOT NULL,
    mat_observations    TEXT
);

CREATE VIEW v_liste_salaries AS
SELECT sal_id AS id, CASE WHEN sal_statut = 'INTERIM' THEN 'interim' ELSE 'salarie' END AS type_element, sal_matricule AS matricule, sal_nom AS nom, sal_prenom AS prenom, sal_service AS service, sal_poste AS poste,
       sal_statut AS statut, sal_date_entree AS date_entree, sal_salaire AS salaire_brut, sal_heures_mois AS heures_mois,
       sal_actif AS actif, sal_commentaire AS commentaire
FROM salarie;

CREATE VIEW v_liste_materiels AS
SELECT mat_id AS id, mat_code AS code, mat_designation AS designation, mat_famille AS famille, mat_etat AS etat,
       mat_chantier AS chantier, mat_valeur_achat AS valeur_achat, mat_date_achat AS date_achat,
       mat_heures AS heures_utilisation, mat_heures_revision AS heures_revision, mat_controle_ok AS controle_ok,
       mat_observations AS observations
FROM materiel;

-- Équipes et sous-traitants (démonstration du thème Ressources, à plusieurs types d'élément).
CREATE TABLE equipe (
    equ_id        SERIAL        PRIMARY KEY,
    equ_code      VARCHAR(10)   NOT NULL,
    equ_libelle   VARCHAR(100)  NOT NULL,
    equ_categorie VARCHAR(30)   NOT NULL,
    equ_chef      VARCHAR(100)  NOT NULL,
    equ_effectif  INT           NOT NULL,
    equ_chantier  VARCHAR(100),
    equ_active    BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE TABLE demo_sous_traitant (
    sst_id           SERIAL        PRIMARY KEY,
    sst_code         VARCHAR(10)   NOT NULL,
    sst_raison       VARCHAR(100)  NOT NULL,
    sst_metier       VARCHAR(30)   NOT NULL,
    sst_taux_horaire NUMERIC(18,2) NOT NULL,
    sst_agree        BOOLEAN       NOT NULL,
    sst_observations TEXT
);

-- Ressources : union de types d'élément ; l'identifiant est préfixé par le type pour rester unique.
CREATE VIEW v_liste_ressources AS
SELECT 'EQU-' || equ_id AS id, 'equipe' AS type_element, equ_code AS code, equ_libelle AS libelle, equ_categorie AS categorie,
       'Chef : ' || equ_chef AS statut, equ_active AS disponible, (equ_effectif * 42)::numeric AS cout_horaire,
       equ_chantier AS chantier, 'Effectif ' || equ_effectif AS observations
FROM equipe
UNION ALL
SELECT 'SAL-' || id, type_element, matricule, prenom || ' ' || nom, service, poste, actif,
       round(salaire_brut * 1.45 / 151.67, 2), NULL, commentaire
FROM v_liste_salaries
UNION ALL
SELECT 'MAT-' || id, 'materiel', code, designation, famille, etat, etat = 'DISPO', round(valeur_achat / 2000, 2), chantier, observations
FROM v_liste_materiels
UNION ALL
SELECT 'SST-' || sst_id, 'sous_traitant', sst_code, sst_raison, sst_metier,
       CASE WHEN sst_agree THEN 'Agréé' ELSE 'Agrément en cours' END, sst_agree, sst_taux_horaire, NULL, sst_observations
FROM demo_sous_traitant;

-- Index d'aide aux tris par défaut des vues de démonstration.
CREATE INDEX ix_sal_nom ON salarie (sal_nom, sal_id);
CREATE INDEX ix_mat_code ON materiel (mat_code, mat_id);
