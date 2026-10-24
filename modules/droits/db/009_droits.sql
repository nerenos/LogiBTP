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

-- Montants de validation (lot 2, D10 à D12) : HT par pièce et cumul sur des jours glissants, par profil et nœud (héritage
-- comme les droits) ; −1 = sans limite, 0 = toute validation soumise à demande.
CREATE TABLE IF NOT EXISTS limite_validation (
    lva_pro_id       UUID          NOT NULL REFERENCES profil(pro_id) ON DELETE CASCADE,
    lva_noeud        VARCHAR(200)  NOT NULL,
    lva_piece        NUMERIC(14,2) NOT NULL DEFAULT -1 CHECK (lva_piece >= -1),
    lva_cumul        NUMERIC(14,2) NOT NULL DEFAULT -1 CHECK (lva_cumul >= -1),
    lva_jours        SMALLINT      NOT NULL DEFAULT 30 CHECK (lva_jours BETWEEN 1 AND 366),
    PRIMARY KEY (lva_pro_id, lva_noeud)
);

-- Borne d'atelier (D16, lot 3) : identifiant d'appareil à profil propre ; les pièces saisies à la borne sont créées au
-- nom du salarié avec les droits de ce profil (sorties et retours de stock, pointages, étapes).
INSERT INTO profil (pro_code, pro_libelle, pro_description, pro_systeme, pro_total) VALUES
 ('BORNE', 'Borne d''atelier', 'Droits des saisies faites à une borne (appareil enregistré, PIN du salarié)', TRUE, FALSE)
ON CONFLICT (pro_code) DO NOTHING;
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT p.pro_id, n.noeud, n.actions::jsonb FROM profil p
CROSS JOIN (VALUES
    ('documents', '{}'),
    ('documents/S', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","VALIDER":"TOUT","CREER":"TOUT"}'),
    ('pointage', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT"}'),
    ('execution', '{"CONSULTER":"TOUT","MODIFIER":"TOUT"}'),
    ('stock', '{"CONSULTER":"TOUT","CREER":"TOUT"}')) n(noeud, actions)
WHERE p.pro_code = 'BORNE'
ON CONFLICT DO NOTHING;
