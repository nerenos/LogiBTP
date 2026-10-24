-- =============================================================================
-- Module Stock, lot 1 (documentation/conception/ANALYSE-MODULE-STOCK.md) : méthode de valorisation de la société,
-- emplacements des lieux de stock (lieux = identifiants fournis par l'application : chantiers pour le cœur), journal
-- des mouvements (date-heure à la minute, quantité signée en unité de stock, prix des entrées valorisées, PMP calculé),
-- comptages (inventaires, lot 2), réévaluations du PMP, valorisation courante des articles (recalculée par le serveur
-- pour les articles marqués « à valoriser » par les triggers). Le stock n'est jamais saisi : dernier comptage de
-- date-heure ≤ T + mouvements postérieurs jusqu'à T (f_stk_quantite, v_stk_stock), comme stock.js / ReglesStock.cs.
-- Articles et lieux sans clé étrangère (posées par l'application). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stk_parametre (
    spa_id          SMALLINT      PRIMARY KEY DEFAULT 1 CHECK (spa_id = 1),
    spa_methode     VARCHAR(12)   NOT NULL DEFAULT 'PMP' CHECK (spa_methode IN ('PMP', 'DERNIER_PA')),  -- S29 : globale
    spa_maj_par     VARCHAR(50),
    spa_maj_le      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
INSERT INTO stk_parametre (spa_id) VALUES (1) ON CONFLICT DO NOTHING;
COMMENT ON TABLE stk_parametre IS 'Paramètres du stock de la société : méthode de valorisation (PMP ou dernier prix d''achat, S29)';

-- Emplacements (zone › allée › rack › étagère › case…) d'un lieu de stock ; code complet unique dans le lieu.
CREATE TABLE IF NOT EXISTS stk_emplacement (
    emp_id          BIGSERIAL     PRIMARY KEY,
    emp_lieu_id     BIGINT        NOT NULL,
    emp_parent_id   BIGINT        REFERENCES stk_emplacement(emp_id) ON DELETE CASCADE,
    emp_code        VARCHAR(30)   NOT NULL,
    emp_libelle     VARCHAR(100),
    emp_niveau      VARCHAR(10)   NOT NULL DEFAULT 'ZONE' CHECK (emp_niveau IN ('ZONE', 'ALLEE', 'RACK', 'ETAGERE', 'CASE', 'AUTRE')),
    emp_ordre       INT           NOT NULL DEFAULT 0,
    emp_actif       BOOLEAN       NOT NULL DEFAULT TRUE,
    UNIQUE (emp_lieu_id, emp_code)
);

-- Emplacements habituels d'un article dans un lieu (proposés dans les mouvements et les bordereaux).
CREATE TABLE IF NOT EXISTS stk_article_emplacement (
    sae_ele_id      BIGINT        NOT NULL,
    sae_emp_id      BIGINT        NOT NULL REFERENCES stk_emplacement(emp_id) ON DELETE CASCADE,
    sae_ordre       INT           NOT NULL DEFAULT 0,
    PRIMARY KEY (sae_ele_id, sae_emp_id)
);

-- Journal des mouvements : un par ligne de pièce et par lieu touché (un transfert en donne deux). Écrit par
-- l'application à la validation de la pièce, retiré à son annulation.
CREATE TABLE IF NOT EXISTS stk_mouvement (
    mvt_id              BIGSERIAL     PRIMARY KEY,
    mvt_ele_id          BIGINT        NOT NULL,
    mvt_lieu_id         BIGINT        NOT NULL,
    mvt_emp_id          BIGINT        REFERENCES stk_emplacement(emp_id) ON DELETE SET NULL,
    mvt_date            TIMESTAMPTZ   NOT NULL,                          -- à la minute (S5)
    mvt_quantite        NUMERIC(18,6) NOT NULL,                          -- signée, en unité de stock
    mvt_prix            NUMERIC(18,6),                                   -- prix unitaire d'une entrée valorisée (achat)
    mvt_provisoire      BOOLEAN       NOT NULL DEFAULT FALSE,            -- réception non facturée (S31)
    mvt_prix_ent_id     BIGINT,                                          -- pièce qui a fixé le prix (facture)
    mvt_prix_initial    NUMERIC(18,6),                                   -- prix de la réception, rétabli si la facture est annulée
    mvt_pmp             NUMERIC(18,6),                                   -- PMP à l'issue du mouvement (calculé)
    mvt_origine         VARCHAR(12)   NOT NULL DEFAULT 'DOCUMENT' CHECK (mvt_origine IN ('DOCUMENT', 'DOTATION', 'BORNE')),
    mvt_ent_id          BIGINT,                                          -- pièce d'origine
    mvt_lig_id          BIGINT,                                          -- ligne d'origine
    mvt_tiers_id        BIGINT,
    mvt_ind_id          BIGINT,                                          -- salarié doté (lot 4)
    mvt_tracabilite     TEXT,                                            -- réservé : lots et numéros de série (S24)
    mvt_cree_le         TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mvt_article_lieu ON stk_mouvement (mvt_ele_id, mvt_lieu_id, mvt_date);
CREATE INDEX IF NOT EXISTS ix_mvt_lieu ON stk_mouvement (mvt_lieu_id, mvt_date);
CREATE INDEX IF NOT EXISTS ix_mvt_piece ON stk_mouvement (mvt_ent_id);
CREATE INDEX IF NOT EXISTS ix_mvt_ligne ON stk_mouvement (mvt_lig_id);

-- Comptages (inventaires, lot 2) : quantité comptée d'un article dans un lieu à une date-heure (cumul des lignes du lot).
CREATE TABLE IF NOT EXISTS stk_comptage (
    cpt_id              BIGSERIAL     PRIMARY KEY,
    cpt_ele_id          BIGINT        NOT NULL,
    cpt_lieu_id         BIGINT        NOT NULL,
    cpt_date            TIMESTAMPTZ   NOT NULL,                          -- à la minute
    cpt_quantite        NUMERIC(18,6) NOT NULL,
    cpt_prix            NUMERIC(18,6),                                   -- valeur d'inventaire saisie (S30)
    cpt_commentaire     TEXT,
    cpt_ent_id          BIGINT,                                          -- bordereau d'inventaire (ou micro-inventaire)
    cpt_par             VARCHAR(50),
    cpt_le              TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cpt_article_lieu ON stk_comptage (cpt_ele_id, cpt_lieu_id, cpt_date);

-- Réévaluations du PMP saisies dans la fiche article (S4) ou à l'inventaire (S30, « Appliquer au PMP »).
CREATE TABLE IF NOT EXISTS stk_reevaluation (
    rev_id              BIGSERIAL     PRIMARY KEY,
    rev_ele_id          BIGINT        NOT NULL,
    rev_date            TIMESTAMPTZ   NOT NULL,
    rev_pmp             NUMERIC(18,6) NOT NULL CHECK (rev_pmp >= 0),
    rev_ancien_pmp      NUMERIC(18,6),
    rev_commentaire     TEXT,
    rev_par             VARCHAR(50)   NOT NULL,
    rev_le              TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rev_article ON stk_reevaluation (rev_ele_id, rev_date);

-- Valorisation courante d'un article (rejeu de tous ses événements, ReglesValorisation) ; dernier prix d'achat et sa
-- provenance (mouvement, donc pièce, fournisseur et date).
CREATE TABLE IF NOT EXISTS stk_valeur (
    sva_ele_id          BIGINT        PRIMARY KEY,
    sva_pmp             NUMERIC(18,6),
    sva_dernier_pa      NUMERIC(18,6),
    sva_dernier_pa_mvt_id BIGINT,
    sva_dernier_pa_date TIMESTAMPTZ,
    sva_provisoire      BOOLEAN       NOT NULL DEFAULT FALSE,
    sva_calcule_le      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Articles à revaloriser (événement ajouté, modifié ou retiré) : traités par le serveur avant toute lecture des valeurs.
CREATE TABLE IF NOT EXISTS stk_a_valoriser (
    sav_ele_id          BIGINT        PRIMARY KEY,
    sav_le              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION f_stk_marquer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    ancien BIGINT;
    nouveau BIGINT;
BEGIN
    IF TG_TABLE_NAME = 'stk_mouvement' THEN
        IF TG_OP <> 'INSERT' THEN ancien := OLD.mvt_ele_id; END IF;
        IF TG_OP <> 'DELETE' THEN nouveau := NEW.mvt_ele_id; END IF;
    ELSIF TG_TABLE_NAME = 'stk_comptage' THEN
        IF TG_OP <> 'INSERT' THEN ancien := OLD.cpt_ele_id; END IF;
        IF TG_OP <> 'DELETE' THEN nouveau := NEW.cpt_ele_id; END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN ancien := OLD.rev_ele_id; END IF;
        IF TG_OP <> 'DELETE' THEN nouveau := NEW.rev_ele_id; END IF;
    END IF;
    INSERT INTO stk_a_valoriser (sav_ele_id)
    SELECT x FROM (VALUES (ancien), (nouveau)) AS v(x) WHERE x IS NOT NULL
    ON CONFLICT (sav_ele_id) DO NOTHING;
    RETURN NULL;
END $$;

-- Le PMP écrit par le recalcul ne marque pas l'article : seules les colonnes qui changent la valorisation comptent.
DROP TRIGGER IF EXISTS tr_stk_mouvement_marquer ON stk_mouvement;
CREATE TRIGGER tr_stk_mouvement_marquer AFTER INSERT OR DELETE OR UPDATE OF mvt_ele_id, mvt_lieu_id, mvt_date, mvt_quantite, mvt_prix, mvt_provisoire
    ON stk_mouvement FOR EACH ROW EXECUTE FUNCTION f_stk_marquer();
DROP TRIGGER IF EXISTS tr_stk_comptage_marquer ON stk_comptage;
CREATE TRIGGER tr_stk_comptage_marquer AFTER INSERT OR UPDATE OR DELETE ON stk_comptage FOR EACH ROW EXECUTE FUNCTION f_stk_marquer();
DROP TRIGGER IF EXISTS tr_stk_reevaluation_marquer ON stk_reevaluation;
CREATE TRIGGER tr_stk_reevaluation_marquer AFTER INSERT OR UPDATE OR DELETE ON stk_reevaluation FOR EACH ROW EXECUTE FUNCTION f_stk_marquer();

-- Stock d'un article dans un lieu à une date-heure (à la minute) : dernier comptage ≤ T + mouvements postérieurs ≤ T.
CREATE OR REPLACE FUNCTION f_stk_quantite(p_ele BIGINT, p_lieu BIGINT, p_t TIMESTAMPTZ DEFAULT now()) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    WITH fin AS (SELECT date_trunc('minute', p_t) AS t),
    c AS (SELECT date_trunc('minute', cpt_date) AS d, cpt_quantite AS q FROM stk_comptage, fin
          WHERE cpt_ele_id = p_ele AND cpt_lieu_id = p_lieu AND date_trunc('minute', cpt_date) <= fin.t
          ORDER BY cpt_date DESC, cpt_id DESC LIMIT 1)
    SELECT coalesce((SELECT q FROM c), 0) + coalesce((
        SELECT sum(m.mvt_quantite) FROM stk_mouvement m, fin
        WHERE m.mvt_ele_id = p_ele AND m.mvt_lieu_id = p_lieu AND date_trunc('minute', m.mvt_date) <= fin.t
          AND (NOT EXISTS (SELECT 1 FROM c) OR date_trunc('minute', m.mvt_date) > (SELECT d FROM c))), 0)
$$;

-- Stock présent de chaque article dans chaque lieu (ensembliste, sans fonction par ligne), valeur unitaire selon la
-- méthode de la société et date du dernier mouvement.
CREATE OR REPLACE VIEW v_stk_stock AS
WITH dc AS (
    SELECT DISTINCT ON (cpt_ele_id, cpt_lieu_id) cpt_ele_id AS ele, cpt_lieu_id AS lieu, date_trunc('minute', cpt_date) AS d, cpt_quantite AS q
    FROM stk_comptage WHERE cpt_date <= now()
    ORDER BY cpt_ele_id, cpt_lieu_id, cpt_date DESC, cpt_id DESC
), mv AS (
    SELECT m.mvt_ele_id AS ele, m.mvt_lieu_id AS lieu,
           sum(m.mvt_quantite) FILTER (WHERE dc.d IS NULL OR date_trunc('minute', m.mvt_date) > dc.d) AS q,
           max(m.mvt_date) AS dernier
    FROM stk_mouvement m LEFT JOIN dc ON dc.ele = m.mvt_ele_id AND dc.lieu = m.mvt_lieu_id
    WHERE m.mvt_date <= now()
    GROUP BY m.mvt_ele_id, m.mvt_lieu_id
), cles AS (
    SELECT ele, lieu FROM mv UNION SELECT ele, lieu FROM dc
)
SELECT k.ele AS ele_id, k.lieu AS lieu_id,
       coalesce(dc.q, 0) + coalesce(mv.q, 0) AS quantite,
       dc.d AS dernier_comptage, mv.dernier AS dernier_mouvement,
       CASE p.spa_methode WHEN 'DERNIER_PA' THEN v.sva_dernier_pa ELSE v.sva_pmp END AS valeur_unitaire,
       v.sva_pmp AS pmp, v.sva_dernier_pa AS dernier_pa, v.sva_provisoire AS provisoire
FROM cles k
LEFT JOIN dc ON dc.ele = k.ele AND dc.lieu = k.lieu
LEFT JOIN mv ON mv.ele = k.ele AND mv.lieu = k.lieu
LEFT JOIN stk_valeur v ON v.sva_ele_id = k.ele
CROSS JOIN stk_parametre p;
COMMENT ON VIEW v_stk_stock IS 'Stock présent par article et lieu : dernier comptage + mouvements postérieurs (module Stock, § 3.1)';
