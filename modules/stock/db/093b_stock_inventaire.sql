-- =============================================================================
-- Module Stock, lot 2 (ANALYSE-MODULE-STOCK.md § 5.1, § 5.3, S6 à S8, S20, S30) : lots d'inventaire (un lieu, une
-- date-heure à la minute imposée à tous leurs bordereaux), bordereaux (générés par emplacement, famille, marque ou
-- articles du dépôt, ou saisis) et leurs lignes (quantité comptée ou vide = non compté, emplacement, prix d'inventaire,
-- « Appliquer au PMP », commentaire, quantité théorique à la génération) ; à la validation du lot, un comptage par
-- article (cumul) dans stk_comptage ; micro-inventaire = lot d'un article validé d'office. Marques des articles
-- (listes rapides : inventaires, magasin, borne). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stk_lot_inventaire (
    lin_id              BIGSERIAL     PRIMARY KEY,
    lin_lieu_id         BIGINT        NOT NULL,
    lin_date            TIMESTAMPTZ   NOT NULL,                          -- date-heure du comptage, à la minute
    lin_libelle         VARCHAR(150)  NOT NULL,
    lin_etat            VARCHAR(10)   NOT NULL DEFAULT 'BROUILLON' CHECK (lin_etat IN ('BROUILLON', 'VALIDE', 'ANNULE')),
    lin_micro           BOOLEAN       NOT NULL DEFAULT FALSE,            -- micro-inventaire (correction directe d'un article)
    lin_commentaire     TEXT,
    lin_cree_par        VARCHAR(50)   NOT NULL,
    lin_cree_le         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    lin_valide_par      VARCHAR(50),
    lin_valide_le       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_lin_lieu ON stk_lot_inventaire (lin_lieu_id, lin_date DESC);

CREATE TABLE IF NOT EXISTS stk_bordereau (
    bor_id              BIGSERIAL     PRIMARY KEY,
    bor_lin_id          BIGINT        NOT NULL REFERENCES stk_lot_inventaire(lin_id) ON DELETE CASCADE,
    bor_libelle         VARCHAR(150)  NOT NULL,
    bor_critere         JSONB,                                           -- génération : { par, valeurs }
    bor_compteur        VARCHAR(100),                                    -- personne qui compte
    bor_ordre           INT           NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_bor_lot ON stk_bordereau (bor_lin_id);

CREATE TABLE IF NOT EXISTS stk_bordereau_ligne (
    bli_id              BIGSERIAL     PRIMARY KEY,
    bli_bor_id          BIGINT        NOT NULL REFERENCES stk_bordereau(bor_id) ON DELETE CASCADE,
    bli_ele_id          BIGINT        NOT NULL,
    bli_emp_id          BIGINT        REFERENCES stk_emplacement(emp_id) ON DELETE SET NULL,
    bli_quantite        NUMERIC(18,6),                                   -- vide : non compté (l'article n'est pas mis à 0)
    bli_theorique       NUMERIC(18,6),                                   -- stock calculé à la date du lot, à la génération
    bli_prix            NUMERIC(18,6),                                   -- valeur d'inventaire saisie (S30)
    bli_appliquer_pmp   BOOLEAN       NOT NULL DEFAULT FALSE,
    bli_commentaire     TEXT,
    bli_ordre           INT           NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_bli_bordereau ON stk_bordereau_ligne (bli_bor_id, bli_ordre);

-- Comptages et réévaluations issus d'un lot (retirés si le lot est annulé).
ALTER TABLE stk_comptage ADD COLUMN IF NOT EXISTS cpt_lin_id BIGINT REFERENCES stk_lot_inventaire(lin_id) ON DELETE CASCADE;
ALTER TABLE stk_reevaluation ADD COLUMN IF NOT EXISTS rev_lin_id BIGINT REFERENCES stk_lot_inventaire(lin_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ix_cpt_lot ON stk_comptage (cpt_lin_id);

-- Marques des articles (S20) : listes rapides ; plusieurs par article.
CREATE TABLE IF NOT EXISTS stk_marque (
    mrq_code            VARCHAR(20)   PRIMARY KEY,
    mrq_libelle         VARCHAR(100)  NOT NULL,
    mrq_couleur         VARCHAR(9),
    mrq_ordre           INT           NOT NULL DEFAULT 0,
    mrq_actif           BOOLEAN       NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS stk_article_marque (
    sam_ele_id          BIGINT        NOT NULL,
    sam_mrq_code        VARCHAR(20)   NOT NULL REFERENCES stk_marque(mrq_code) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (sam_ele_id, sam_mrq_code)
);
CREATE INDEX IF NOT EXISTS ix_sam_marque ON stk_article_marque (sam_mrq_code);
INSERT INTO stk_marque (mrq_code, mrq_libelle, mrq_couleur, mrq_ordre) VALUES
 ('EPI', 'Équipements de protection individuelle', '#f79009', 1),
 ('OUTILLAGE', 'Outillage consommable', '#2e90fa', 2),
 ('TOURNANT', 'Inventaire tournant', '#12b76a', 3)
ON CONFLICT (mrq_code) DO NOTHING;
