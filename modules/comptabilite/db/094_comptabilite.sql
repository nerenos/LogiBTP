-- =============================================================================
-- Module Comptabilité (base, lot 1 ; ANALYSE-MODULE-COMPTABILITE.md § 4) : plan comptable, paramètres (longueur des
-- comptes, complétion par des zéros, préfixes des comptes de tiers, TVA sur les débits), collectifs par type de tiers,
-- catégories de TVA (comportement du calcul, mention réglementaire, exigibilité). Sans métier : les types de tiers, les
-- taux de TVA et les tiers sont fournis par l'application (SpecialisationComptabilite). Rejouable.
-- =============================================================================

-- Plan comptable. La table existait en version minimale (code, libellé, actif : db/166 du cœur) : elle est complétée.
CREATE TABLE IF NOT EXISTS compte_comptable (
    cpt_code     VARCHAR(20)  PRIMARY KEY,
    cpt_libelle  VARCHAR(150) NOT NULL,
    cpt_actif    BOOLEAN      NOT NULL DEFAULT TRUE
);
-- Type : GENERAL, COLLECTIF (comptes de tiers 401 / 411…), TVA, TRESORERIE ; sens d'usage : VENTE, ACHAT, LES_DEUX, AUCUN
-- (filtre des listes de choix des pièces de vente et d'achat) ; libellé court pour l'export ; lettrable (module complet).
ALTER TABLE compte_comptable ADD COLUMN IF NOT EXISTS cpt_type VARCHAR(12) NOT NULL DEFAULT 'GENERAL';
ALTER TABLE compte_comptable ADD COLUMN IF NOT EXISTS cpt_sens VARCHAR(8) NOT NULL DEFAULT 'AUCUN';
ALTER TABLE compte_comptable ADD COLUMN IF NOT EXISTS cpt_libelle_court VARCHAR(35);
ALTER TABLE compte_comptable ADD COLUMN IF NOT EXISTS cpt_lettrable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE compte_comptable ADD COLUMN IF NOT EXISTS cpt_maj_par VARCHAR(100);
ALTER TABLE compte_comptable ADD COLUMN IF NOT EXISTS cpt_maj_le TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE compte_comptable DROP CONSTRAINT IF EXISTS compte_comptable_cpt_type_check;
ALTER TABLE compte_comptable ADD CONSTRAINT compte_comptable_cpt_type_check CHECK (cpt_type IN ('GENERAL', 'COLLECTIF', 'TVA', 'TRESORERIE'));
ALTER TABLE compte_comptable DROP CONSTRAINT IF EXISTS compte_comptable_cpt_sens_check;
ALTER TABLE compte_comptable ADD CONSTRAINT compte_comptable_cpt_sens_check CHECK (cpt_sens IN ('VENTE', 'ACHAT', 'LES_DEUX', 'AUCUN'));

-- Paramètres : une valeur JSON par clé.
CREATE TABLE IF NOT EXISTS parametre_comptabilite (
    pcp_cle      VARCHAR(40)  PRIMARY KEY,
    pcp_valeur   JSONB        NOT NULL,
    pcp_maj_par  VARCHAR(100),
    pcp_maj_le   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
INSERT INTO parametre_comptabilite (pcp_cle, pcp_valeur) VALUES
 ('longueur_comptes_generaux', '6'),
 ('longueur_comptes_tiers', 'null'),
 ('completer_zeros', 'true'),
 ('prefixes_tiers', '{}'),
 ('tva_sur_debits', 'false')
ON CONFLICT (pcp_cle) DO NOTHING;

-- Collectifs (comptes de regroupement des tiers) par type de tiers ; les types sont déclarés par l'application.
CREATE TABLE IF NOT EXISTS collectif_tiers (
    col_code     VARCHAR(20)  PRIMARY KEY,
    col_libelle  VARCHAR(60)  NOT NULL,
    col_cpt_code VARCHAR(20)  REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE,
    col_ordre    INT          NOT NULL DEFAULT 0
);

-- Catégories de TVA : comportement du calcul (N normale, A autoliquidation, I intracommunautaire, E exonérée : ceux
-- que connaissent les moteurs de calcul), mention réglementaire proposée aux taux, exigibilité (E encaissements,
-- D débits, NULL : paramètre de la société), TVA autoliquidée (due par le preneur).
CREATE TABLE IF NOT EXISTS categorie_tva (
    ctv_code         VARCHAR(20)  PRIMARY KEY,
    ctv_libelle      VARCHAR(80)  NOT NULL,
    ctv_comportement CHAR(1)      NOT NULL CHECK (ctv_comportement IN ('N', 'A', 'I', 'E')),
    ctv_mention      TEXT,
    ctv_exigibilite  CHAR(1)      CHECK (ctv_exigibilite IN ('E', 'D')),
    ctv_ordre        INT          NOT NULL DEFAULT 0,
    ctv_actif        BOOLEAN      NOT NULL DEFAULT TRUE
);
