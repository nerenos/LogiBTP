-- =============================================================================
-- Cœur LogiBTP – module Comptabilité, base, lot 2 (module `094b` ; ANALYSE-MODULE-COMPTABILITE.md § 4.4, 4.5) :
--  * types comptables VENTE, ACHAT et SOUS_TRAITANCE (parent ACHAT, journal HA par défaut, C10) avec leurs comptes
--    par défaut et ceux des postes (retenue de garantie sur un compte distinct, C12) ; comptes ajoutés au plan ;
--  * type comptable d'un type de document : par la famille (V vente, A achat, T sous-traitance), surchargeable
--    (`tyd_tco_code`) ;
--  * comptes des natures (`nat_compte_vente`, `nat_compte_achat`) repris en clés de ventilation « nature » (C7) ; les
--    colonnes restent dans la table du module Bibliothèque mais ne sont plus saisies.
-- Rejouable.
-- =============================================================================

INSERT INTO compte_comptable (cpt_code, cpt_libelle, cpt_type, cpt_sens) VALUES
 ('611000', 'Sous-traitance générale', 'GENERAL', 'ACHAT'),
 ('704000', 'Travaux', 'GENERAL', 'VENTE'),
 ('606000', 'Achats non stockés de matières et fournitures', 'GENERAL', 'ACHAT')
ON CONFLICT (cpt_code) DO NOTHING;

INSERT INTO type_comptable (tco_code, tco_libelle, tco_parent, tco_sens, tco_journal, tco_journal_libelle, tco_cpt_defaut, tco_cpt_remise,
                            tco_cpt_retenue, tco_cpt_acompte, tco_cpt_ecart_debit, tco_cpt_ecart_credit, tco_ordre) VALUES
 ('VENTE', 'Ventes', NULL, 'VENTE', 'VT', 'Journal des ventes', '704000', '709000', '411700', '419100', '658000', '758000', 10),
 ('ACHAT', 'Achats', NULL, 'ACHAT', 'HA', 'Journal des achats', '606000', '609000', '401700', '409100', '658000', '758000', 20),
 ('SOUS_TRAITANCE', 'Sous-traitance', 'ACHAT', 'ACHAT', 'HA', 'Journal des achats', '611000', NULL, NULL, NULL, NULL, NULL, 30)
ON CONFLICT (tco_code) DO NOTHING;

-- Type comptable d'un type de document : vide = celui de sa famille.
ALTER TABLE type_document ADD COLUMN IF NOT EXISTS tyd_tco_code VARCHAR(20) REFERENCES type_comptable(tco_code) ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION f_type_comptable(p_tyd_tco_code VARCHAR, p_famille VARCHAR) RETURNS VARCHAR LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(p_tyd_tco_code, CASE p_famille WHEN 'V' THEN 'VENTE' WHEN 'A' THEN 'ACHAT' WHEN 'T' THEN 'SOUS_TRAITANCE' END)
$$;

-- Comptes des natures repris une seule fois en clés de ventilation (marque `natures_reprises` des paramètres : une clé
-- retirée ensuite n'est jamais recréée) ; compte absent du plan : ajouté.
INSERT INTO compte_comptable (cpt_code, cpt_libelle, cpt_sens)
SELECT DISTINCT x.compte, 'Compte de la nature ' || x.nature, x.sens
FROM (SELECT nat_compte_vente AS compte, nat_code AS nature, 'VENTE' AS sens FROM nature_element WHERE coalesce(nat_compte_vente, '') <> ''
      UNION ALL SELECT nat_compte_achat, nat_code, 'ACHAT' FROM nature_element WHERE coalesce(nat_compte_achat, '') <> '') x
WHERE NOT EXISTS (SELECT 1 FROM compte_comptable c WHERE c.cpt_code = x.compte)
  AND NOT EXISTS (SELECT 1 FROM parametre_comptabilite WHERE pcp_cle = 'natures_reprises')
ON CONFLICT (cpt_code) DO NOTHING;

INSERT INTO ventilation_compte (vco_tco_code, vco_nature, vco_taux, vco_cpt_code)
SELECT x.tco, x.nature, NULL, x.compte
FROM (SELECT 'VENTE' AS tco, nat_code AS nature, nat_compte_vente AS compte FROM nature_element WHERE coalesce(nat_compte_vente, '') <> ''
      UNION ALL SELECT 'ACHAT', nat_code, nat_compte_achat FROM nature_element WHERE coalesce(nat_compte_achat, '') <> '') x
WHERE NOT EXISTS (SELECT 1 FROM parametre_comptabilite WHERE pcp_cle = 'natures_reprises')
ON CONFLICT DO NOTHING;

INSERT INTO parametre_comptabilite (pcp_cle, pcp_valeur) VALUES ('natures_reprises', 'true') ON CONFLICT (pcp_cle) DO NOTHING;
