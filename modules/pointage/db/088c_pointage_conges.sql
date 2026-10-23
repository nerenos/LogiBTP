-- =============================================================================
-- Module Pointage : demandes de congés et absences. Le salarié (ou le responsable de son service) demande une période
-- (journées entières ou demi-journées aux bornes) avec un commentaire, sans nature ; le RH valide en affectant la nature
-- (CP, RTT, AR, AT…, liste modifiable, code de paie exporté) ou refuse. Les congés validés comptent dans la synthèse
-- (jours d'absence sans exception « sans pointage ») et dans l'export de paie (jours par nature). Le cœur en tient une
-- tâche d'absence dans le planning (pco_tac_id). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS poi_nature_absence (
    pna_code       VARCHAR(20)   PRIMARY KEY,
    pna_libelle    VARCHAR(80)   NOT NULL,
    pna_code_paie  VARCHAR(20),
    pna_couleur    VARCHAR(9),
    pna_ordre      INT           NOT NULL DEFAULT 0,
    pna_actif      BOOLEAN       NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE poi_nature_absence IS 'Natures d''absence affectées par le RH à la validation d''un congé (export de paie : code de paie, sinon le code)';

INSERT INTO poi_nature_absence (pna_code, pna_libelle, pna_code_paie, pna_couleur, pna_ordre) VALUES
 ('CP', 'Congés payés', 'CP', '#0ea5e9', 10),
 ('RTT', 'Réduction du temps de travail', 'RTT', '#6366f1', 20),
 ('AR', 'Absence autorisée rémunérée', 'AR', '#14b8a6', 30),
 ('ANR', 'Absence autorisée non rémunérée', 'ANR', '#94a3b8', 40),
 ('EVT', 'Événement familial', 'EVT', '#a855f7', 50),
 ('MAL', 'Maladie', 'MAL', '#f97316', 60),
 ('AT', 'Accident du travail', 'AT', '#ef4444', 70),
 ('CSS', 'Congé sans solde', 'CSS', '#64748b', 80),
 ('FORM', 'Formation', 'FORM', '#22c55e', 90)
ON CONFLICT (pna_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS poi_conge (
    pco_id           BIGSERIAL     PRIMARY KEY,
    pco_sal_id       INT           NOT NULL,
    pco_du           DATE          NOT NULL,
    pco_au           DATE          NOT NULL,
    pco_debut_midi   BOOLEAN       NOT NULL DEFAULT FALSE,
    pco_fin_midi     BOOLEAN       NOT NULL DEFAULT FALSE,
    pco_commentaire  TEXT,
    pco_etat         VARCHAR(10)   NOT NULL DEFAULT 'DEMANDE' CHECK (pco_etat IN ('DEMANDE', 'VALIDE', 'REFUSE', 'ANNULE')),
    pco_nature       VARCHAR(20)   REFERENCES poi_nature_absence(pna_code),
    pco_demande_par  VARCHAR(50)   NOT NULL,
    pco_demande_le   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    pco_traite_par   VARCHAR(50),
    pco_traite_le    TIMESTAMPTZ,
    pco_reponse      TEXT,
    pco_tac_id       BIGINT,
    pco_version      INT           NOT NULL DEFAULT 1,
    CONSTRAINT ck_pco_periode CHECK (pco_au >= pco_du),
    CONSTRAINT ck_pco_nature CHECK (pco_etat <> 'VALIDE' OR pco_nature IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_pco_salarie ON poi_conge (pco_sal_id, pco_du);
CREATE INDEX IF NOT EXISTS ix_pco_etat ON poi_conge (pco_etat, pco_du);
COMMENT ON COLUMN poi_conge.pco_debut_midi IS 'Le congé commence l''après-midi du premier jour';
COMMENT ON COLUMN poi_conge.pco_fin_midi IS 'Le congé finit à midi le dernier jour';
COMMENT ON COLUMN poi_conge.pco_tac_id IS 'Tâche d''absence du planning tenue par le cœur (demande : option ; validé : confirmée)';
