-- Module CRM LogiBTP – notes (actions, messages, tâches), liens vers les éléments de l'application, destinataires,
-- historique, droits et consultations des notes protégées (ANALYSE-MODULE-CRM.md, lot 1). Sans clé étrangère vers
-- l'application : un élément est désigné par (type_element, id_element), comme dans la GED ; les individus et les
-- services sont des identifiants fournis par l'application. Rejouable.

-- Types de notes (appel, courriel, visite…), globaux ou propres à un service.
CREATE TABLE IF NOT EXISTS crm_type_note (
    tno_id          SERIAL        PRIMARY KEY,
    tno_code        VARCHAR(20)   NOT NULL UNIQUE,
    tno_libelle     VARCHAR(80)   NOT NULL,
    tno_srv_id      INT,                                          -- service (nul : global)
    tno_icone       VARCHAR(8),
    tno_modele_html TEXT,                                         -- texte proposé à la création
    tno_ordre       INT           NOT NULL DEFAULT 0,
    tno_actif       BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO crm_type_note (tno_code, tno_libelle, tno_icone, tno_ordre) VALUES
 ('NOTE', 'Note', '📝', 10),
 ('APPEL', 'Appel téléphonique', '📞', 20),
 ('COURRIEL', 'Courriel', '✉', 30),
 ('VISITE', 'Visite', '🚶', 40),
 ('REUNION', 'Réunion', '👥', 50),
 ('RELANCE', 'Relance', '🔁', 60)
ON CONFLICT (tno_code) DO NOTHING;

-- Note : nature ACTION / MESSAGE / TACHE, état, responsable (individu) ou service à prendre (responsable nul).
CREATE TABLE IF NOT EXISTS crm_note (
    not_id             BIGSERIAL     PRIMARY KEY,
    not_nature         VARCHAR(10)   NOT NULL CHECK (not_nature IN ('ACTION', 'MESSAGE', 'TACHE')),
    not_etat           VARCHAR(10)   NOT NULL DEFAULT 'A_FAIRE' CHECK (not_etat IN ('A_FAIRE', 'EN_COURS', 'TERMINE', 'MEMO', 'ANNULEE')),
    not_tno_id         INT           REFERENCES crm_type_note(tno_id) ON DELETE SET NULL,
    not_srv_id         INT,                                       -- service de la note (nul : globale)
    not_objet          VARCHAR(200)  NOT NULL,
    not_message_html   TEXT,
    not_responsable_id BIGINT,                                    -- individu ; nul avec un service : à prendre
    not_echeance       TIMESTAMPTZ,
    not_parent_id      BIGINT        REFERENCES crm_note(not_id) ON DELETE CASCADE,   -- réponse (fil de discussion)
    not_prive          BOOLEAN       NOT NULL DEFAULT FALSE,
    not_rgpd           BOOLEAN       NOT NULL DEFAULT FALSE,      -- données personnelles : droit RGPD, lecture journalisée
    not_dans_fil       BOOLEAN       NOT NULL DEFAULT FALSE,
    not_archivee_le    TIMESTAMPTZ,
    not_cree_par       VARCHAR(50)   NOT NULL,
    not_cree_le        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    not_maj_par        VARCHAR(50),
    not_maj_le         TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_not_responsable ON crm_note (not_responsable_id, not_etat);
CREATE INDEX IF NOT EXISTS ix_not_service ON crm_note (not_srv_id, not_etat) WHERE not_responsable_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_not_cree_par ON crm_note (not_cree_par);
CREATE INDEX IF NOT EXISTS ix_not_parent ON crm_note (not_parent_id);

-- Éléments rattachés (tiers, chantier, document…) ; le principal donne le titre.
CREATE TABLE IF NOT EXISTS crm_note_lien (
    nli_not_id       BIGINT        NOT NULL REFERENCES crm_note(not_id) ON DELETE CASCADE,
    nli_type_element VARCHAR(30)   NOT NULL,
    nli_id_element   VARCHAR(50)   NOT NULL,
    nli_principal    BOOLEAN       NOT NULL DEFAULT FALSE,
    PRIMARY KEY (nli_not_id, nli_type_element, nli_id_element)
);
CREATE INDEX IF NOT EXISTS ix_nli_element ON crm_note_lien (nli_type_element, nli_id_element);

-- Destinataires (individus) et lecture.
CREATE TABLE IF NOT EXISTS crm_note_destinataire (
    nde_not_id   BIGINT        NOT NULL REFERENCES crm_note(not_id) ON DELETE CASCADE,
    nde_ind_id   BIGINT        NOT NULL,
    nde_lu_le    TIMESTAMPTZ,
    PRIMARY KEY (nde_not_id, nde_ind_id)
);
CREATE INDEX IF NOT EXISTS ix_nde_ind ON crm_note_destinataire (nde_ind_id);

-- Historique : création, état, responsable (prise en charge, réassignation, rendu au service), échéance.
CREATE TABLE IF NOT EXISTS crm_note_historique (
    nhi_id        BIGSERIAL     PRIMARY KEY,
    nhi_not_id    BIGINT        NOT NULL REFERENCES crm_note(not_id) ON DELETE CASCADE,
    nhi_quoi      VARCHAR(20)   NOT NULL,                         -- CREATION, ETAT, RESPONSABLE, ECHEANCE, SERVICE
    nhi_avant     TEXT,
    nhi_apres     TEXT,
    nhi_par       VARCHAR(50),
    nhi_le        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nhi_note ON crm_note_historique (nhi_not_id, nhi_le);

CREATE OR REPLACE FUNCTION f_crm_note_historique() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO crm_note_historique (nhi_not_id, nhi_quoi, nhi_apres, nhi_par) VALUES (NEW.not_id, 'CREATION', NEW.not_etat, NEW.not_cree_par);
        RETURN NEW;
    END IF;
    IF NEW.not_etat IS DISTINCT FROM OLD.not_etat THEN
        INSERT INTO crm_note_historique (nhi_not_id, nhi_quoi, nhi_avant, nhi_apres, nhi_par) VALUES (NEW.not_id, 'ETAT', OLD.not_etat, NEW.not_etat, NEW.not_maj_par);
    END IF;
    IF NEW.not_responsable_id IS DISTINCT FROM OLD.not_responsable_id THEN
        INSERT INTO crm_note_historique (nhi_not_id, nhi_quoi, nhi_avant, nhi_apres, nhi_par)
        VALUES (NEW.not_id, 'RESPONSABLE', OLD.not_responsable_id::text, NEW.not_responsable_id::text, NEW.not_maj_par);
    END IF;
    IF NEW.not_srv_id IS DISTINCT FROM OLD.not_srv_id THEN
        INSERT INTO crm_note_historique (nhi_not_id, nhi_quoi, nhi_avant, nhi_apres, nhi_par) VALUES (NEW.not_id, 'SERVICE', OLD.not_srv_id::text, NEW.not_srv_id::text, NEW.not_maj_par);
    END IF;
    IF NEW.not_echeance IS DISTINCT FROM OLD.not_echeance THEN
        INSERT INTO crm_note_historique (nhi_not_id, nhi_quoi, nhi_avant, nhi_apres, nhi_par) VALUES (NEW.not_id, 'ECHEANCE', OLD.not_echeance::text, NEW.not_echeance::text, NEW.not_maj_par);
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_crm_note_historique ON crm_note;
CREATE TRIGGER tr_crm_note_historique AFTER INSERT OR UPDATE ON crm_note FOR EACH ROW EXECUTE FUNCTION f_crm_note_historique();

-- Droits du module par profil : SUPERVISER (lever le masquage d'une note privée), RGPD (lire une note de données
-- personnelles). Chaque levée ou lecture est journalisée dans crm_consultation, visible de l'auteur de la note.
CREATE TABLE IF NOT EXISTS crm_droit (
    cdr_profil  VARCHAR(50)  NOT NULL,
    cdr_action  VARCHAR(20)  NOT NULL CHECK (cdr_action IN ('SUPERVISER', 'RGPD')),
    PRIMARY KEY (cdr_profil, cdr_action)
);
INSERT INTO crm_droit (cdr_profil, cdr_action) VALUES ('ADMIN', 'SUPERVISER'), ('ADMIN', 'RGPD') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS crm_consultation (
    cco_id      BIGSERIAL     PRIMARY KEY,
    cco_not_id  BIGINT        NOT NULL REFERENCES crm_note(not_id) ON DELETE CASCADE,
    cco_motif   VARCHAR(10)   NOT NULL CHECK (cco_motif IN ('PRIVEE', 'RGPD')),
    cco_par     VARCHAR(50)   NOT NULL,
    cco_le      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cco_note ON crm_consultation (cco_not_id, cco_le);
