-- Module CRM LogiBTP – suivi des validations (plans et pièces techniques, indices, visas des tiers) et bordereaux de
-- diffusion (ANALYSE-MODULE-CRM.md, lot 4 : § 2.4, § 2.5, C9 à C11). Rejouable.

-- Statuts de visa, paramétrables : effet ACCEPTE (bon pour exécution…), REFUSE (bloquant), NEUTRE (pour information).
CREATE TABLE IF NOT EXISTS crm_statut_visa (
    stv_code     VARCHAR(10)   PRIMARY KEY,
    stv_libelle  VARCHAR(80)   NOT NULL,
    stv_effet    VARCHAR(8)    NOT NULL CHECK (stv_effet IN ('ACCEPTE', 'REFUSE', 'NEUTRE')),
    stv_ordre    INT           NOT NULL DEFAULT 0,
    stv_actif    BOOLEAN       NOT NULL DEFAULT TRUE
);
INSERT INTO crm_statut_visa (stv_code, stv_libelle, stv_effet, stv_ordre) VALUES
 ('BPE', 'Bon pour exécution', 'ACCEPTE', 10),
 ('VAO', 'Visa avec observations', 'ACCEPTE', 20),
 ('REF', 'Refusé', 'REFUSE', 30),
 ('SO', 'Sans objet / pour information', 'NEUTRE', 40)
ON CONFLICT (stv_code) DO NOTHING;

-- Plan ou pièce technique soumise au visa, rattachée à un élément de l'application (chantier, affaire, marché…).
CREATE TABLE IF NOT EXISTS crm_plan (
    pla_id            BIGSERIAL     PRIMARY KEY,
    pla_repere        VARCHAR(40)   NOT NULL,
    pla_repere_cctp   VARCHAR(40),
    pla_nom           VARCHAR(200)  NOT NULL,
    pla_lot           VARCHAR(80),
    pla_finition      VARCHAR(120),                                  -- teinte RAL, état de surface…
    pla_message_html  TEXT,
    pla_type_element  VARCHAR(30),
    pla_id_element    VARCHAR(50),
    pla_cree_par      VARCHAR(50)   NOT NULL,
    pla_cree_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    pla_maj_par       VARCHAR(50),
    pla_maj_le        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pla_element ON crm_plan (pla_type_element, pla_id_element);

-- Indice d'un plan (A, B…) : date de diffusion (nulle : à diffuser), motif de révision, fichier en GED.
CREATE TABLE IF NOT EXISTS crm_plan_indice (
    pin_id        BIGSERIAL     PRIMARY KEY,
    pin_pla_id    BIGINT        NOT NULL REFERENCES crm_plan(pla_id) ON DELETE CASCADE,
    pin_indice    VARCHAR(5)    NOT NULL,
    pin_date      DATE,
    pin_motif     VARCHAR(200),
    pin_dge_id    BIGINT,                                            -- document de la GED (fichier de l'indice)
    pin_cree_par  VARCHAR(50)   NOT NULL,
    pin_cree_le   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (pin_pla_id, pin_indice)
);

-- Bordereau de diffusion : pièces envoyées à une liste de destinataires, à une date.
CREATE TABLE IF NOT EXISTS crm_diffusion (
    dif_id               BIGSERIAL     PRIMARY KEY,
    dif_numero           VARCHAR(20)   NOT NULL UNIQUE,              -- BD-AAAA-NNNN
    dif_date             DATE          NOT NULL,
    dif_objet            VARCHAR(200)  NOT NULL,
    dif_type_element     VARCHAR(30),
    dif_id_element       VARCHAR(50),
    dif_delai_visa_jours INT           NOT NULL DEFAULT 15 CHECK (dif_delai_visa_jours >= 0),
    dif_cree_par         VARCHAR(50)   NOT NULL,
    dif_cree_le          TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_dif_element ON crm_diffusion (dif_type_element, dif_id_element);

CREATE TABLE IF NOT EXISTS crm_diffusion_piece (
    dfp_id       BIGSERIAL     PRIMARY KEY,
    dfp_dif_id   BIGINT        NOT NULL REFERENCES crm_diffusion(dif_id) ON DELETE CASCADE,
    dfp_pin_id   BIGINT        REFERENCES crm_plan_indice(pin_id) ON DELETE SET NULL,
    dfp_dge_id   BIGINT,                                             -- autre pièce de la GED
    dfp_libelle  VARCHAR(250)  NOT NULL
);

CREATE TABLE IF NOT EXISTS crm_diffusion_destinataire (
    dfd_id           BIGSERIAL     PRIMARY KEY,
    dfd_dif_id       BIGINT        NOT NULL REFERENCES crm_diffusion(dif_id) ON DELETE CASCADE,
    dfd_tiers_id     BIGINT        NOT NULL,
    dfd_ind_id       BIGINT,
    dfd_mode         VARCHAR(12)   NOT NULL DEFAULT 'COURRIEL' CHECK (dfd_mode IN ('COURRIEL', 'PAPIER', 'PLATEFORME', 'MAIN_PROPRE')),
    dfd_exemplaires  INT           NOT NULL DEFAULT 1 CHECK (dfd_exemplaires >= 0),
    dfd_attend_visa  BOOLEAN       NOT NULL DEFAULT FALSE,
    dfd_not_id       BIGINT        REFERENCES crm_note(not_id) ON DELETE SET NULL   -- tâche de retour du visa
);

-- Visa d'un tiers sur un indice : attendu (statut nul) puis reçu ; tâche de retour et bordereau d'origine.
CREATE TABLE IF NOT EXISTS crm_visa (
    vis_id            BIGSERIAL     PRIMARY KEY,
    vis_pin_id        BIGINT        NOT NULL REFERENCES crm_plan_indice(pin_id) ON DELETE CASCADE,
    vis_tiers_id      BIGINT        NOT NULL,
    vis_ind_id        BIGINT,
    vis_attendu_le    DATE,
    vis_stv_code      VARCHAR(10)   REFERENCES crm_statut_visa(stv_code),
    vis_recu_le       DATE,
    vis_observation   TEXT,
    vis_dge_retour_id BIGINT,                                        -- plan annoté en retour (GED)
    vis_dfd_id        BIGINT        REFERENCES crm_diffusion_destinataire(dfd_id) ON DELETE SET NULL,
    vis_maj_par       VARCHAR(50),
    vis_maj_le        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (vis_pin_id, vis_tiers_id)
);
CREATE INDEX IF NOT EXISTS ix_vis_dfd ON crm_visa (vis_dfd_id);

-- Éléments du CRM porteurs de pièces dans la GED (remplace la définition de 097).
CREATE OR REPLACE FUNCTION f_crm_element_existe(p_type TEXT, p_id BIGINT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT CASE p_type
        WHEN 'crm_note' THEN EXISTS (SELECT 1 FROM crm_note WHERE not_id = p_id)
        WHEN 'crm_demande' THEN EXISTS (SELECT 1 FROM crm_demande WHERE dem_id = p_id)
        WHEN 'crm_plan' THEN EXISTS (SELECT 1 FROM crm_plan WHERE pla_id = p_id)
        WHEN 'crm_diffusion' THEN EXISTS (SELECT 1 FROM crm_diffusion WHERE dif_id = p_id)
        ELSE NULL
    END
$$;
