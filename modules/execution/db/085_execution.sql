-- Module Exécution LogiBTP – parcours des services (modèles, parcours instancié par élément : chantier…), états imposés
-- à la main par service (ANALYSE-MODULE-EXECUTION.md § 3.1, § 3.2, § 4, E7, E8). Sans clé étrangère vers l'application :
-- un service est un identifiant, un élément un couple (type_element, id_element), un type d'ordre un code fourni par
-- l'application. Les ordres eux-mêmes sont des documents (famille E, cœur). Rejouable.

CREATE TABLE IF NOT EXISTS exe_parcours_modele (
    pam_id           SERIAL        PRIMARY KEY,
    pam_code         VARCHAR(30)   NOT NULL UNIQUE,
    pam_libelle      VARCHAR(100)  NOT NULL,
    pam_description  TEXT,
    pam_ordre        INT           NOT NULL DEFAULT 0,
    pam_actif        BOOLEAN       NOT NULL DEFAULT TRUE,
    pam_maj_par      VARCHAR(50),
    pam_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Étapes d'un modèle : service, type d'ordre attendu, étapes amont (plusieurs pour une jonction : colisage après les
-- fabrications en parallèle).
CREATE TABLE IF NOT EXISTS exe_parcours_etape (
    pae_id           SERIAL        PRIMARY KEY,
    pae_pam_id       INT           NOT NULL REFERENCES exe_parcours_modele(pam_id) ON DELETE CASCADE,
    pae_code         VARCHAR(30)   NOT NULL,
    pae_libelle      VARCHAR(100),
    pae_srv_id       INT,
    pae_type_ordre   VARCHAR(20),
    pae_amonts       TEXT[]        NOT NULL DEFAULT '{}',
    pae_ordre        INT           NOT NULL DEFAULT 0,
    UNIQUE (pae_pam_id, pae_code)
);

-- Parcours d'un élément : copie modifiable des étapes d'un modèle (E7).
CREATE TABLE IF NOT EXISTS exe_parcours (
    par_id           SERIAL        PRIMARY KEY,
    par_type_element VARCHAR(30)   NOT NULL,
    par_id_element   VARCHAR(50)   NOT NULL,
    par_pam_id       INT           REFERENCES exe_parcours_modele(pam_id) ON DELETE SET NULL,
    par_maj_par      VARCHAR(50),
    par_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (par_type_element, par_id_element)
);
CREATE TABLE IF NOT EXISTS exe_parcours_element_etape (
    pee_id           SERIAL        PRIMARY KEY,
    pee_par_id       INT           NOT NULL REFERENCES exe_parcours(par_id) ON DELETE CASCADE,
    pee_code         VARCHAR(30)   NOT NULL,
    pee_libelle      VARCHAR(100),
    pee_srv_id       INT,
    pee_type_ordre   VARCHAR(20),
    pee_amonts       TEXT[]        NOT NULL DEFAULT '{}',
    pee_ordre        INT           NOT NULL DEFAULT 0,
    UNIQUE (pee_par_id, pee_code)
);

-- État imposé à la main pour un service sur un élément (pas d'ordre, intervention sans suivi…) : prime sur l'état calculé.
CREATE TABLE IF NOT EXISTS exe_etat_manuel (
    etm_type_element VARCHAR(30)   NOT NULL,
    etm_id_element   VARCHAR(50)   NOT NULL,
    etm_srv_id       INT           NOT NULL,
    etm_etat         VARCHAR(12)   NOT NULL CHECK (etm_etat IN ('SANS_OBJET', 'A_VENIR', 'EN_ATTENTE', 'EN_COURS', 'BLOQUE', 'TERMINE')),
    etm_motif        TEXT,
    etm_par          VARCHAR(50)   NOT NULL,
    etm_le           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (etm_type_element, etm_id_element, etm_srv_id)
);
