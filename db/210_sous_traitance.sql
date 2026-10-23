-- =============================================================================
-- Cœur – module Sous-traitance, lot 0 (ANALYSE-MODULE-SOUS-TRAITANCE.md ST1, ST3, ST31 ; module Document 019i) :
-- activation du module (`module_societe` « sous_traitance ») ; famille T visible dans les listes seulement si le module
-- est actif et le type aussi (`f_type_visible`, règle E24) ; règles des achats reprises par la famille T. Rejouable.
-- =============================================================================

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_ordre) VALUES
 ('sous_traitance', 'Sous-traitance', 'Appels d''offres, marchés et commandes de sous-traitance, pièces exigées, factures et paiement direct', 50)
ON CONFLICT (mod_code) DO NOTHING;

CREATE OR REPLACE FUNCTION f_type_visible(p_famille VARCHAR, p_actif BOOLEAN) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT CASE p_famille
             WHEN 'E' THEN p_actif AND f_module_actif('execution')
             WHEN 'T' THEN p_actif AND f_module_actif('sous_traitance')
             ELSE TRUE END
$$;

-- Règles de la famille A reprises pour la famille T (une fois : une règle T déjà posée est gardée).
INSERT INTO regle_document (rdo_code, rdo_famille, rdo_valeur, rdo_actif)
SELECT r.rdo_code, 'T', r.rdo_valeur, r.rdo_actif FROM regle_document r
WHERE r.rdo_famille = 'A' AND r.rdo_tyd_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM regle_document x WHERE x.rdo_code = r.rdo_code AND x.rdo_famille = 'T');
