-- =============================================================================
-- Module Rentabilité, lot 1 (ANALYSE-MODULE-ANALYSE.md § 3, § 10.4, § 11) : faits versionnés, calculs par chantier,
-- file de recalcul, exécutions du planificateur. Rejouable.
--
-- Sans métier : le module ne connaît ni les chantiers, ni les natures, ni les pièces ; les colonnes d'identifiants
-- (afa_cha_id, afa_nat_id, afa_ent_id…) reçoivent leurs clés étrangères du cœur (db/258). Les faits ne sont jamais
-- effacés par un recalcul : un fait disparu est clos (afa_calcul_fin), un fait nouveau ou modifié est ouvert par le
-- calcul en cours (afa_calcul_debut) ; les faits « tels que connus » au calcul N sont ceux ouverts à N ou avant et non
-- clos à N ou avant.
-- =============================================================================

CREATE TABLE IF NOT EXISTS rentabilite_calcul (
    rca_id           BIGSERIAL    PRIMARY KEY,
    rca_cha_id       INT          NOT NULL,
    rca_debut        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    rca_fin          TIMESTAMPTZ,
    rca_declencheur  VARCHAR(20)  NOT NULL,
    rca_raison       TEXT,
    rca_par          VARCHAR(100),
    rca_version      INT          NOT NULL,
    rca_etat         VARCHAR(20)  NOT NULL DEFAULT 'EN_COURS',
    rca_message      TEXT,
    rca_nb_faits     INT,
    rca_ajouts       INT,
    rca_retraits     INT,
    rca_ecarts       INT
);
CREATE INDEX IF NOT EXISTS ix_rca_chantier ON rentabilite_calcul (rca_cha_id, rca_id DESC);

COMMENT ON TABLE rentabilite_calcul IS 'Calculs des faits d''un chantier : déclencheur (FILE, NUIT, MANUEL), version des règles, état (EN_COURS, OK, ERREUR), différences écrites';
COMMENT ON COLUMN rentabilite_calcul.rca_ecarts IS 'Recalcul de nuit : faits différents de l''existant hors faits datés du jour (engagé planifié) ; non nul = un événement n''a pas été signalé (V63)';

CREATE TABLE IF NOT EXISTS rentabilite_fait (
    afa_id            BIGSERIAL      PRIMARY KEY,
    afa_cha_id        INT            NOT NULL,
    afa_ordre_id      BIGINT,
    afa_mar_id        INT,
    afa_indicateur    VARCHAR(20)    NOT NULL,
    afa_composante    VARCHAR(20)    NOT NULL,
    afa_date          DATE           NOT NULL,
    afa_nat_id        INT,
    afa_qte           NUMERIC(18,6),
    afa_unite         VARCHAR(20),
    afa_montant_pa    NUMERIC(18,6)  NOT NULL DEFAULT 0,
    afa_montant_pr    NUMERIC(18,6)  NOT NULL DEFAULT 0,
    afa_montant_pv    NUMERIC(18,6)  NOT NULL DEFAULT 0,
    afa_heures        NUMERIC(18,6),
    afa_source_type   VARCHAR(20)    NOT NULL,
    afa_type_piece    VARCHAR(30),
    afa_ent_id        BIGINT,
    afa_lig_id        BIGINT,
    afa_source_id     BIGINT,
    afa_regle         VARCHAR(40)    NOT NULL,
    afa_libelle       TEXT,
    afa_calcul_debut  BIGINT         NOT NULL REFERENCES rentabilite_calcul (rca_id),
    afa_calcul_fin    BIGINT         REFERENCES rentabilite_calcul (rca_id)
);
CREATE INDEX IF NOT EXISTS ix_afa_chantier_ouverts ON rentabilite_fait (afa_cha_id, afa_indicateur) WHERE afa_calcul_fin IS NULL;
CREATE INDEX IF NOT EXISTS ix_afa_piece_ouverts ON rentabilite_fait (afa_ent_id) WHERE afa_calcul_fin IS NULL;
CREATE INDEX IF NOT EXISTS ix_afa_chantier_versions ON rentabilite_fait (afa_cha_id, afa_calcul_debut, afa_calcul_fin);

COMMENT ON TABLE rentabilite_fait IS 'Faits du module Rentabilité (une donnée élémentaire par ligne : ligne de pièce, pointage, tâche, mouvement), versionnés par les calculs';
COMMENT ON COLUMN rentabilite_fait.afa_indicateur IS 'BUDGET, BUDGET_EXECUTION, ENGAGE, DEBOURSE, FACTURE (flux datés : une somme jusqu''à T donne l''état ou le cumul à T)';
COMMENT ON COLUMN rentabilite_fait.afa_composante IS 'VENTE, ACHAT, SOUS_TRAITANCE, MO, MATERIEL, STOCK, POSTE (poste de pied)';
COMMENT ON COLUMN rentabilite_fait.afa_nat_id IS 'Nature (vide : « Non ventilé », jamais réparti en douce)';
COMMENT ON COLUMN rentabilite_fait.afa_regle IS 'Règle appliquée (code de la spécialisation), affichée dans la page des faits';

CREATE TABLE IF NOT EXISTS rentabilite_a_recalculer (
    arq_cha_id       INT          PRIMARY KEY,
    arq_raison       TEXT,
    arq_depuis       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    arq_prioritaire  BOOLEAN      NOT NULL DEFAULT FALSE,
    arq_tentatives   INT          NOT NULL DEFAULT 0,
    arq_erreur       TEXT,
    arq_apres        TIMESTAMPTZ
);
COMMENT ON TABLE rentabilite_a_recalculer IS 'File des chantiers à recalculer (signalés par les triggers du cœur, vidée par le planificateur de chaque base) ; arq_apres : reprise différée après une erreur';

-- Signalement : un chantier par ligne de file, la première date et la dernière raison gardées.
CREATE OR REPLACE FUNCTION f_rentabilite_signaler(p_chantiers INT[], p_raison TEXT) RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO rentabilite_a_recalculer (arq_cha_id, arq_raison)
    SELECT DISTINCT c, p_raison FROM unnest(p_chantiers) c WHERE c IS NOT NULL
    ON CONFLICT (arq_cha_id) DO UPDATE SET arq_raison = EXCLUDED.arq_raison;
$$;

CREATE TABLE IF NOT EXISTS rentabilite_execution (
    rex_tache     VARCHAR(30)  PRIMARY KEY,
    rex_derniere  TIMESTAMPTZ,
    rex_resultat  TEXT
);
COMMENT ON TABLE rentabilite_execution IS 'Dernière exécution des tâches périodiques du planificateur (recalcul de nuit) par base';

-- Lot 2 (§ 10.3, § 10.4, § 6) : contrôles « ce qui a changé », photos, vues enregistrées de la Liste.

-- Contrôle d'un chantier par un utilisateur : le calcul vu ; à la réouverture, les faits ouverts ou clos depuis ce
-- calcul sont « ce qui a changé ».
CREATE TABLE IF NOT EXISTS rentabilite_controle (
    rco_id      BIGSERIAL     PRIMARY KEY,
    rco_cha_id  INT           NOT NULL,
    rco_rca_id  BIGINT        NOT NULL REFERENCES rentabilite_calcul (rca_id),
    rco_par     VARCHAR(100)  NOT NULL,
    rco_le      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rco_chantier ON rentabilite_controle (rco_cha_id, rco_par, rco_id DESC);
COMMENT ON TABLE rentabilite_controle IS 'Contrôles des chiffres d''un chantier : calcul vu, auteur, date (ce qui a changé depuis = faits ouverts ou clos après ce calcul)';

-- Photo : les faits d'un chantier tels que connus à un calcul, datés jusqu'à une date. Les faits n'étant jamais
-- effacés, la photo est une référence (calcul, date) et non une copie : une purge future des faits clos doit garder
-- ceux qu'une photo voit encore.
CREATE TABLE IF NOT EXISTS rentabilite_photo (
    rph_id      BIGSERIAL     PRIMARY KEY,
    rph_cha_id  INT           NOT NULL,
    rph_date    DATE          NOT NULL,
    rph_rca_id  BIGINT        NOT NULL REFERENCES rentabilite_calcul (rca_id),
    rph_type    VARCHAR(10)   NOT NULL,
    rph_libelle VARCHAR(150),
    rph_par     VARCHAR(100),
    rph_le      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rph_mois ON rentabilite_photo (rph_cha_id, rph_date) WHERE rph_type = 'MOIS';
CREATE INDEX IF NOT EXISTS ix_rph_chantier ON rentabilite_photo (rph_cha_id, rph_date DESC);
COMMENT ON TABLE rentabilite_photo IS 'Photos des chiffres d''un chantier (MOIS : fin de mois, MANUEL : à la demande) : faits connus au calcul rph_rca_id, datés jusqu''au rph_date';

-- Vues enregistrées de la Liste (sur le modèle de vue_liste) : propriétaire vide = vue globale (administrateur).
CREATE TABLE IF NOT EXISTS rentabilite_vue (
    rvu_id           SERIAL        PRIMARY KEY,
    rvu_nom          VARCHAR(100)  NOT NULL,
    rvu_proprietaire VARCHAR(100),
    rvu_parametres   JSONB         NOT NULL DEFAULT '{}',
    rvu_defaut       BOOLEAN       NOT NULL DEFAULT FALSE,
    rvu_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE rentabilite_vue IS 'Vues de la Liste : niveau d''origine, colonnes, PA / PR, arrondi, période par défaut, chantiers exclus ou clos affichés';

-- Changements nets d'un chantier depuis un calcul : faits ouverts depuis (encore ouverts) et faits connus alors puis clos,
-- sans les paires identiques (un fait retiré puis rétabli à l'identique n'est pas un changement).
CREATE OR REPLACE FUNCTION f_rentabilite_signature(f rentabilite_fait) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT md5(row(f.afa_ordre_id, f.afa_mar_id, f.afa_indicateur, f.afa_composante, f.afa_date, f.afa_nat_id, f.afa_qte, f.afa_unite,
                   f.afa_montant_pa, f.afa_montant_pr, f.afa_montant_pv, f.afa_heures, f.afa_source_type, f.afa_type_piece,
                   f.afa_ent_id, f.afa_lig_id, f.afa_source_id, f.afa_regle, f.afa_libelle)::text)
$$;

CREATE OR REPLACE FUNCTION f_rentabilite_changements(p_cha INT, p_calcul BIGINT) RETURNS INT LANGUAGE sql STABLE AS $$
    SELECT coalesce(sum(abs(s.ajoutes - s.retires)), 0)::int
    FROM (SELECT f_rentabilite_signature(f) AS sig,
                 count(*) FILTER (WHERE f.afa_calcul_debut > p_calcul) AS ajoutes,
                 count(*) FILTER (WHERE f.afa_calcul_debut <= p_calcul) AS retires
          FROM rentabilite_fait f
          WHERE f.afa_cha_id = p_cha
            AND (f.afa_calcul_debut > p_calcul AND f.afa_calcul_fin IS NULL OR f.afa_calcul_debut <= p_calcul AND f.afa_calcul_fin > p_calcul)
          GROUP BY 1) s
$$;
