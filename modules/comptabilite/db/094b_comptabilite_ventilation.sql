-- =============================================================================
-- Module Comptabilité (base, lot 2 ; ANALYSE-MODULE-COMPTABILITE.md § 3.2, 4.4, 4.5) : types comptables (journal,
-- parent, compte par défaut et comptes des postes particuliers : remise, retenue de garantie, acompte, paiement
-- direct, prorata, écarts d'arrondi) et clés de ventilation (type comptable × nature et / ou taux de TVA → compte).
-- Natures et taux désignés par leur code (fournis par l'application). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS type_comptable (
    tco_code                 VARCHAR(20)  PRIMARY KEY,
    tco_libelle              VARCHAR(60)  NOT NULL,
    tco_parent               VARCHAR(20)  REFERENCES type_comptable(tco_code) ON UPDATE CASCADE,
    tco_sens                 VARCHAR(8)   NOT NULL DEFAULT 'VENTE' CHECK (tco_sens IN ('VENTE', 'ACHAT')),
    tco_journal              VARCHAR(10),
    tco_journal_libelle      VARCHAR(60),
    tco_cpt_defaut           VARCHAR(20)  REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE,
    tco_cpt_remise           VARCHAR(20)  REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE,
    tco_cpt_retenue          VARCHAR(20)  REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE,
    tco_retenue_compte_tiers BOOLEAN      NOT NULL DEFAULT FALSE,
    tco_cpt_acompte          VARCHAR(20)  REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE,
    tco_cpt_paiement_direct  VARCHAR(20)  REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE,
    tco_cpt_prorata          VARCHAR(20)  REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE,
    tco_cpt_ecart_debit      VARCHAR(20)  REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE,
    tco_cpt_ecart_credit     VARCHAR(20)  REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE,
    tco_ordre                INT          NOT NULL DEFAULT 0,
    tco_actif                BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Clés de ventilation : une par (type, nature, taux) ; au moins la nature ou le taux (sinon : compte par défaut du type).
CREATE TABLE IF NOT EXISTS ventilation_compte (
    vco_id        SERIAL       PRIMARY KEY,
    vco_tco_code  VARCHAR(20)  NOT NULL REFERENCES type_comptable(tco_code) ON UPDATE CASCADE ON DELETE CASCADE,
    vco_nature    VARCHAR(30),
    vco_taux      VARCHAR(20),
    vco_cpt_code  VARCHAR(20)  NOT NULL REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE,
    CHECK (vco_nature IS NOT NULL OR vco_taux IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ventilation_compte ON ventilation_compte (vco_tco_code, coalesce(vco_nature, ''), coalesce(vco_taux, ''));
