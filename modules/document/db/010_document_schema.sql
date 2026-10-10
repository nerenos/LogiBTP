-- =============================================================================
-- Module Document – schéma générique (entête, lignes, paramétrage, liens, historique).
-- Les colonnes propres à un métier sont ajoutées par le cœur qui spécialise le module (db/100_btp.sql).
-- Convention : snake_case sans accents, préfixe de table sur chaque colonne.
-- Une base par société, même schéma. PostgreSQL 14 ou plus (compression lz4).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS ltree;

-- Paramétrage -----------------------------------------------------------------

CREATE TABLE type_document (
    tyd_id                    SERIAL PRIMARY KEY,
    tyd_code                  VARCHAR(20)  NOT NULL UNIQUE,
    tyd_libelle               VARCHAR(100) NOT NULL,
    tyd_famille               CHAR(1)      NOT NULL DEFAULT 'V'
                              CHECK (tyd_famille IN ('V','A','S')),       -- Vente, Achat, Stock
    tyd_sens                  SMALLINT     NOT NULL,                      -- 1 vente, 2 achat, 3 stock
    tyd_prefixe_numero        VARCHAR(10),
    tyd_numerotation_continue BOOLEAN      NOT NULL DEFAULT FALSE,        -- factures, avoirs
    tyd_mouvemente_stock      BOOLEAN      NOT NULL DEFAULT FALSE,
    tyd_handler               VARCHAR(100),                               -- NULL = standard
    tyd_actif                 BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE propriete_definition (
    prd_id                 SERIAL PRIMARY KEY,
    prd_tyd_id             INT          NOT NULL REFERENCES type_document(tyd_id),
    prd_niveau             CHAR(1)      NOT NULL CHECK (prd_niveau IN ('E','L')),
    prd_code               VARCHAR(50)  NOT NULL,
    prd_libelle            VARCHAR(100) NOT NULL,
    prd_type_donnee        VARCHAR(20)  NOT NULL
                           CHECK (prd_type_donnee IN ('texte','entier','decimal','date','booleen','liste')),
    prd_obligatoire        BOOLEAN      NOT NULL DEFAULT FALSE,
    prd_valeur_defaut      JSONB,
    prd_options            JSONB,
    prd_groupe             VARCHAR(50),
    prd_ordre              INT          NOT NULL DEFAULT 0,
    UNIQUE (prd_tyd_id, prd_niveau, prd_code)
);

CREATE TABLE statut_document (
    std_id                 SERIAL PRIMARY KEY,
    std_tyd_id             INT          NOT NULL REFERENCES type_document(tyd_id),
    std_code               VARCHAR(20)  NOT NULL,
    std_libelle            VARCHAR(50)  NOT NULL,
    std_modifiable         BOOLEAN      NOT NULL DEFAULT TRUE,
    std_terminal           BOOLEAN      NOT NULL DEFAULT FALSE,           -- archivable
    std_ordre              INT          NOT NULL DEFAULT 0,
    UNIQUE (std_tyd_id, std_code)
);

CREATE TABLE type_ligne (
    tyl_id                 SMALLINT PRIMARY KEY,
    tyl_code               VARCHAR(20)  NOT NULL UNIQUE,
    tyl_libelle            VARCHAR(50)  NOT NULL,
    tyl_est_chiffree       BOOLEAN      NOT NULL,
    tyl_est_numerotee      BOOLEAN      NOT NULL,
    tyl_accepte_enfants    BOOLEAN      NOT NULL,
    tyl_est_pied           BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE TABLE taux_tva (
    ttv_id                 SERIAL PRIMARY KEY,
    ttv_code               VARCHAR(10)   NOT NULL UNIQUE,
    ttv_libelle            VARCHAR(100)  NOT NULL,
    ttv_taux               NUMERIC(18,6) NOT NULL,                        -- en %, 20 = 20 %
    ttv_categorie          CHAR(1)       NOT NULL
                           CHECK (ttv_categorie IN ('N','A','I','E')),    -- Normale, Autoliq., Intracom, Exonérée
    ttv_mention            TEXT,
    ttv_actif              BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE TABLE transformation_autorisee (
    tra_source_tyd_id      INT          NOT NULL REFERENCES type_document(tyd_id),
    tra_cible_tyd_id       INT          NOT NULL REFERENCES type_document(tyd_id),
    tra_etape              VARCHAR(20)  NOT NULL,                         -- COMMANDE, RECEPTION, FACTURATION, RETOUR…
    tra_vaut_etapes        VARCHAR(20)[],                                 -- étapes sautées couvertes
    PRIMARY KEY (tra_source_tyd_id, tra_cible_tyd_id)
);

CREATE TABLE droit_document (
    drt_profil             VARCHAR(50)  NOT NULL,
    drt_tyd_id             INT          NOT NULL REFERENCES type_document(tyd_id),
    drt_action             VARCHAR(20)  NOT NULL
                           CHECK (drt_action IN ('CREER','MODIFIER','VALIDER','TRANSFORMER','SUPPRIMER')),
    PRIMARY KEY (drt_profil, drt_tyd_id, drt_action)
);

CREATE TABLE compteur_numero (
    cnu_tyd_id             INT          NOT NULL REFERENCES type_document(tyd_id),
    cnu_exercice           INT          NOT NULL,
    cnu_dernier_numero     INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (cnu_tyd_id, cnu_exercice)
);

-- Entête ----------------------------------------------------------------------

CREATE TABLE document (
    ent_id                  BIGSERIAL PRIMARY KEY,
    ent_tyd_id              INT          NOT NULL REFERENCES type_document(tyd_id),
    ent_numero              VARCHAR(30),                                  -- attribué à la validation
    ent_date                DATE         NOT NULL,
    ent_objet               VARCHAR(200),
    ent_std_id              INT          NOT NULL REFERENCES statut_document(std_id),
    ent_tiers_id            BIGINT       NOT NULL,
    ent_adresse_facturation JSONB,                                        -- copiée, ne suit plus la fiche tiers
    ent_adresse_livraison   JSONB,
    ent_devise              CHAR(3)      NOT NULL DEFAULT 'EUR',
    ent_num_format          JSONB        NOT NULL
                            DEFAULT '{"separateur":".","niveaux":[{"style":"1"}]}',
    ent_precision_montant   SMALLINT     NOT NULL DEFAULT 2,
    ent_version_calcul      VARCHAR(20),
    ent_total_ht            NUMERIC(18,6) NOT NULL DEFAULT 0,
    ent_total_tva           NUMERIC(18,6) NOT NULL DEFAULT 0,
    ent_total_ttc           NUMERIC(18,6) NOT NULL DEFAULT 0,
    ent_net_a_payer         NUMERIC(18,6) NOT NULL DEFAULT 0,
    ent_proprietes          JSONB        NOT NULL DEFAULT '{}',
    ent_groupe_id           BIGINT,                                       -- commun aux indices
    ent_indice              VARCHAR(3)   NOT NULL DEFAULT 'A',
    ent_is_reference        BOOLEAN      NOT NULL DEFAULT TRUE,
    ent_verrouille          BOOLEAN      NOT NULL DEFAULT FALSE,
    ent_copie_de_id         BIGINT       REFERENCES document(ent_id),
    ent_version             INT          NOT NULL DEFAULT 1,              -- verrouillage optimiste
    ent_cree_le             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ent_cree_par            VARCHAR(50)  NOT NULL,
    ent_modifie_le          TIMESTAMPTZ,
    ent_modifie_par         VARCHAR(50),
    CONSTRAINT ux_ent_numero_indice UNIQUE (ent_tyd_id, ent_numero, ent_indice)
);
CREATE INDEX ix_ent_proprietes ON document USING GIN (ent_proprietes);
CREATE INDEX ix_ent_groupe ON document (ent_groupe_id);
CREATE UNIQUE INDEX ux_ent_reference ON document (ent_groupe_id) WHERE ent_is_reference;

-- Lignes ----------------------------------------------------------------------

CREATE TABLE document_ligne (
    lig_id                 BIGSERIAL PRIMARY KEY,
    lig_ent_id             BIGINT       NOT NULL REFERENCES document(ent_id) ON DELETE CASCADE,
    lig_parent_id          BIGINT       REFERENCES document_ligne(lig_id) ON DELETE CASCADE,
    lig_chemin             LTREE        NOT NULL DEFAULT '',             -- dérivé par trigger
    lig_ordre              INT          NOT NULL,
    lig_tyl_id             SMALLINT     NOT NULL REFERENCES type_ligne(tyl_id),

    -- Numérotation
    lig_numerotation       VARCHAR(30),
    lig_num_depart         VARCHAR(10),
    lig_num_manuelle       BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Identification et libellés
    lig_code               VARCHAR(50),
    lig_libelle_html       TEXT,                                          -- nettoyé côté serveur
    lig_libelle_affiche    TEXT,                                          -- variables remplacées
    lig_libelle_brut       TEXT,                                          -- sans balises
    lig_art_id             BIGINT,
    lig_cpt_code           VARCHAR(20),
    lig_fichier_id         BIGINT,

    -- Quantités
    lig_qte                NUMERIC(18,6),
    lig_qte_type           CHAR(1)      CHECK (lig_qte_type IN ('R','A')),
    lig_qte_vendue         NUMERIC(18,6),
    lig_qte_totale         NUMERIC(18,6),
    lig_unt_code           VARCHAR(10),
    lig_precision_qte      SMALLINT     NOT NULL DEFAULT 2,

    -- Prix (coefficients multiplicateurs, 1 par défaut)
    lig_pv                 NUMERIC(18,6),
    lig_coef_remise        NUMERIC(18,6) NOT NULL DEFAULT 1,             -- 0,90 = 10 %
    lig_pv_remise          NUMERIC(18,6),
    lig_precision_pv       SMALLINT     NOT NULL DEFAULT 2,
    lig_type_prix          CHAR(1)      NOT NULL DEFAULT 'V'
                           CHECK (lig_type_prix IN ('V','O','M','A')),   -- Vendu, Option, Mémoire, vAriante
    lig_variante_de_id     BIGINT       REFERENCES document_ligne(lig_id) ON DELETE SET NULL,
    lig_st_depuis_id       BIGINT       REFERENCES document_ligne(lig_id) ON DELETE SET NULL,

    -- Montants
    lig_montant_ht         NUMERIC(18,6),

    -- Lignes de pied
    lig_pied_mode          CHAR(1)      CHECK (lig_pied_mode IN ('P','M')),
    lig_pied_base          VARCHAR(10)  CHECK (lig_pied_base IN ('CUMUL','TOTAL_HT','TOTAL_TTC')),
    lig_pied_sens          SMALLINT     CHECK (lig_pied_sens IN (1,-1)),
    lig_pied_valeur        NUMERIC(18,6),
    lig_base_calcul        NUMERIC(18,6),
    lig_montant_tva        NUMERIC(18,6),

    -- TVA (lignes de prix uniquement ; taux par défaut sur un titre)
    lig_tva_id             INT          REFERENCES taux_tva(ttv_id),
    lig_taux_tva           NUMERIC(18,6),

    -- Divers
    lig_commentaire        TEXT,
    lig_is_non_editee      BOOLEAN      NOT NULL DEFAULT FALSE,
    lig_origine_id         BIGINT       REFERENCES document_ligne(lig_id) ON DELETE SET NULL,
    lig_proprietes         JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX ix_lig_entete  ON document_ligne (lig_ent_id);
CREATE INDEX ix_lig_parent  ON document_ligne (lig_parent_id, lig_ordre);
CREATE INDEX ix_lig_chemin  ON document_ligne USING GIST (lig_chemin);
CREATE INDEX ix_lig_article ON document_ligne (lig_art_id);

-- lig_parent_id et lig_ordre sont la source de vérité ; lig_chemin (ID séparés par des points)
-- en est dérivé pour les requêtes de sous-arbre (lig_chemin <@ '12.45').
CREATE FUNCTION fn_lig_chemin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.lig_parent_id IS NULL THEN
        NEW.lig_chemin := text2ltree(NEW.lig_id::text);
    ELSE
        SELECT p.lig_chemin || text2ltree(NEW.lig_id::text) INTO NEW.lig_chemin
        FROM document_ligne p WHERE p.lig_id = NEW.lig_parent_id;
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION fn_lig_chemin_descendants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.lig_chemin IS DISTINCT FROM OLD.lig_chemin THEN
        UPDATE document_ligne
           SET lig_chemin = NEW.lig_chemin || subpath(lig_chemin, nlevel(OLD.lig_chemin))
         WHERE lig_chemin <@ OLD.lig_chemin AND lig_id <> NEW.lig_id;
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER tr_lig_chemin BEFORE INSERT OR UPDATE OF lig_parent_id ON document_ligne
    FOR EACH ROW EXECUTE FUNCTION fn_lig_chemin();
CREATE TRIGGER tr_lig_chemin_descendants AFTER UPDATE OF lig_parent_id ON document_ligne
    FOR EACH ROW EXECUTE FUNCTION fn_lig_chemin_descendants();

-- Tables annexes --------------------------------------------------------------

CREATE TABLE document_tva (
    tva_ent_id             BIGINT        NOT NULL REFERENCES document(ent_id) ON DELETE CASCADE,
    tva_ttv_id             INT           REFERENCES taux_tva(ttv_id),
    tva_code               VARCHAR(10)   NOT NULL,
    tva_taux               NUMERIC(18,6) NOT NULL,
    tva_categorie          CHAR(1)       NOT NULL DEFAULT 'N',
    tva_base_ht            NUMERIC(18,6) NOT NULL,
    tva_montant            NUMERIC(18,6) NOT NULL,                        -- TVA calculée (0 en autoliquidation)
    tva_montant_annulation NUMERIC(18,6) NOT NULL DEFAULT 0,              -- ligne de moins-value intracom
    tva_montant_net        NUMERIC(18,6) NOT NULL,
    tva_mention            TEXT,
    PRIMARY KEY (tva_ent_id, tva_code)
);

CREATE TABLE document_lien (
    lie_source_ent_id      BIGINT       NOT NULL REFERENCES document(ent_id),
    lie_cible_ent_id       BIGINT       NOT NULL REFERENCES document(ent_id),
    lie_type               VARCHAR(20)  NOT NULL DEFAULT 'TRANSFORMATION'
                           CHECK (lie_type IN ('TRANSFORMATION','COPIE')),
    PRIMARY KEY (lie_source_ent_id, lie_cible_ent_id)
);
CREATE INDEX ix_lie_cible ON document_lien (lie_cible_ent_id);

CREATE TABLE document_ligne_lien (
    lil_id             BIGSERIAL PRIMARY KEY,
    lil_source_lig_id  BIGINT        NOT NULL REFERENCES document_ligne(lig_id),
    lil_cible_lig_id   BIGINT        NOT NULL REFERENCES document_ligne(lig_id) ON DELETE CASCADE,
    lil_etape          VARCHAR(20)   NOT NULL,
    lil_qte            NUMERIC(18,6) NOT NULL,                            -- négative pour un retour
    lil_montant_ht     NUMERIC(18,6),
    lil_avancement_pct NUMERIC(18,6),                                     -- situations : cumul en %
    lil_avancement_qte NUMERIC(18,6)                                      -- situations : cumul en quantité
);
CREATE INDEX ix_lil_source ON document_ligne_lien (lil_source_lig_id, lil_etape);
CREATE INDEX ix_lil_cible ON document_ligne_lien (lil_cible_lig_id);

CREATE TABLE document_ligne_solde (
    lso_id           BIGSERIAL PRIMARY KEY,
    lso_lig_id       BIGINT        NOT NULL REFERENCES document_ligne(lig_id) ON DELETE CASCADE,
    lso_etape        VARCHAR(20)   NOT NULL,
    lso_qte          NUMERIC(18,6) NOT NULL,
    lso_date         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    lso_utilisateur  VARCHAR(50)   NOT NULL,
    lso_motif        TEXT
);
CREATE INDEX ix_lso_ligne ON document_ligne_solde (lso_lig_id, lso_etape);

-- Historique et cas de test ---------------------------------------------------

CREATE TABLE document_historique (
    his_id           BIGSERIAL PRIMARY KEY,
    his_ent_id       BIGINT        NOT NULL REFERENCES document(ent_id) ON DELETE CASCADE,
    his_version      INT           NOT NULL,                              -- version avant modification
    his_action       VARCHAR(20)   NOT NULL
                     CHECK (his_action IN ('CREATION','MODIFICATION','VALIDATION','ANNULATION')),
    his_date         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    his_utilisateur  VARCHAR(50)   NOT NULL,
    his_instantane   JSONB COMPRESSION lz4 NOT NULL
);
CREATE INDEX ix_his_document ON document_historique (his_ent_id, his_version);

CREATE TABLE calcul_cas_test (
    cas_id                 BIGSERIAL PRIMARY KEY,
    cas_ent_id             BIGINT       REFERENCES document(ent_id) ON DELETE SET NULL,
    cas_date               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    cas_utilisateur        VARCHAR(50)  NOT NULL,
    cas_version_client     VARCHAR(20)  NOT NULL,
    cas_version_serveur    VARCHAR(20)  NOT NULL,
    cas_document_entree    JSONB        NOT NULL,
    cas_resultat_client    JSONB        NOT NULL,
    cas_resultat_serveur   JSONB        NOT NULL,
    cas_ecarts             JSONB        NOT NULL,
    cas_decision           CHAR(1)      NOT NULL CHECK (cas_decision IN ('S','A')),  -- Serveur validé, Anomalie
    cas_resultat_attendu   JSONB,
    cas_statut             CHAR(1)      NOT NULL DEFAULT 'N' CHECK (cas_statut IN ('N','E','C')),
    cas_commentaire        TEXT
);

-- Référentiel des unités : lig_unt_code reste une saisie libre (pas de clé étrangère).
CREATE TABLE IF NOT EXISTS unite (
    unt_code           VARCHAR(10)  PRIMARY KEY,
    unt_libelle        VARCHAR(50)  NOT NULL,
    unt_precision_qte  SMALLINT     NOT NULL DEFAULT 2,
    unt_ordre          INT          NOT NULL DEFAULT 0,
    unt_actif          BOOLEAN      NOT NULL DEFAULT TRUE
);
