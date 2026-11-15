-- =============================================================================
-- Cœur – module Sous-traitance, lot 1 (ST19) : sous-traitants de démonstration repris dans l'annuaire. Extrait de
-- 211_sous_traitance_marches.sql ; script de démonstration (indicateur « demo » du manifeste), appliqué juste avant 211
-- (qui supprime ensuite la table demo_sous_traitant). Personnes de l'annuaire à la casquette SOUS_TRAITANT (corps
-- d'état, taux horaire et agrément dans les propriétés), affectations et équipes recalées. Sans effet si la table de
-- démonstration n'existe plus.
-- =============================================================================

DO $$
BEGIN
    IF to_regclass('demo_sous_traitant') IS NOT NULL THEN
        INSERT INTO personne (per_niv_code, per_raison_sociale, per_casquettes, per_st_corps_etat, per_proprietes)
        SELECT 'SOCIETE', s.sst_raison, '["SOUS_TRAITANT"]'::jsonb, s.sst_metier,
               jsonb_build_object('taux_horaire', s.sst_taux_horaire, 'agree', s.sst_agree, 'observations', s.sst_observations, 'code_demo', s.sst_code)
        FROM demo_sous_traitant s
        WHERE NOT EXISTS (SELECT 1 FROM personne p WHERE p.per_proprietes ->> 'code_demo' = s.sst_code);
        -- Affectations et équipes : identifiant du sous-traitant de démonstration → personne.
        UPDATE pla_affectation a SET aff_res_id = p.per_id::text
        FROM demo_sous_traitant s JOIN personne p ON p.per_proprietes ->> 'code_demo' = s.sst_code
        WHERE a.aff_res_type = 'SOUS_TRAITANT' AND a.aff_res_id = s.sst_id::text;
        UPDATE equipe_composition e SET eqc_ressource = p.per_id::text
        FROM demo_sous_traitant s JOIN personne p ON p.per_proprietes ->> 'code_demo' = s.sst_code
        WHERE e.eqc_type = 'SOUS_TRAITANT' AND e.eqc_ressource = s.sst_id::text;
    END IF;
END $$;
