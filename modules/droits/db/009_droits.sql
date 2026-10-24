-- Module Droits (ANALYSE-MODULE-DROITS.md, lot 1) : profils et arbre des droits ; rejouable.
-- Un profil porte des lignes { nœud : { ACTION : PORTÉE } } (droit_profil) ; un nœud sans ligne hérite de son plus proche
-- ancêtre qui en a une. Profil total (ADMIN) : tous les droits, sans ligne. Identifiants en UUID (non consécutifs).

CREATE TABLE IF NOT EXISTS profil (
    pro_id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    pro_code         VARCHAR(30)   NOT NULL UNIQUE CHECK (pro_code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
    pro_libelle      VARCHAR(100)  NOT NULL,
    pro_description  TEXT,
    pro_systeme      BOOLEAN       NOT NULL DEFAULT FALSE,
    pro_total        BOOLEAN       NOT NULL DEFAULT FALSE,
    pro_cree_par     VARCHAR(50)   NOT NULL DEFAULT 'systeme',
    pro_cree_le      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    pro_maj_par      VARCHAR(50),
    pro_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS droit_profil (
    dpr_pro_id       UUID          NOT NULL REFERENCES profil(pro_id) ON DELETE CASCADE,
    dpr_noeud        VARCHAR(200)  NOT NULL CHECK (dpr_noeud ~ '^[a-z_]+(/[A-Za-z0-9_]+)*$'),
    dpr_actions      JSONB         NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dpr_actions) = 'object'),
    PRIMARY KEY (dpr_pro_id, dpr_noeud)
);

-- Journal des modifications des profils et de leurs droits (audit).
CREATE TABLE IF NOT EXISTS journal_droits (
    jdr_id           BIGSERIAL     PRIMARY KEY,
    jdr_le           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    jdr_par          VARCHAR(50)   NOT NULL,
    jdr_profil       VARCHAR(30)   NOT NULL,
    jdr_evenement    VARCHAR(20)   NOT NULL,
    jdr_noeud        VARCHAR(200),
    jdr_avant        JSONB,
    jdr_apres        JSONB
);
CREATE INDEX IF NOT EXISTS ix_journal_droits_profil ON journal_droits (jdr_profil, jdr_id DESC);

-- Profils système : administrateur (total), saisie, saisie mobile (profil par défaut d'un nouveau compte), service.
INSERT INTO profil (pro_code, pro_libelle, pro_description, pro_systeme, pro_total) VALUES
 ('ADMIN', 'Administrateur', 'Tous les droits', TRUE, TRUE),
 ('SAISIE', 'Saisie', 'Saisie des documents et des fiches, sans validation', TRUE, FALSE),
 ('MOBILE', 'Saisie mobile', 'Pointage de ses propres heures (profil par défaut d''un nouveau compte)', TRUE, FALSE),
 ('SERVICE', 'Service', 'Comptes de service (tâches de fond, sans connexion interactive)', TRUE, FALSE)
ON CONFLICT (pro_code) DO NOTHING;

-- Saisie mobile : ses propres pointages.
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT pro_id, 'pointage', '{"CONSULTER":"SOI","MODIFIER":"SOI","CREER":"SOI","SUPPRIMER":"SOI"}'::jsonb FROM profil WHERE pro_code = 'MOBILE'
ON CONFLICT DO NOTHING;
