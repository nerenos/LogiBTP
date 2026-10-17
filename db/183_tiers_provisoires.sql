-- =============================================================================
-- Cœur – tiers provisoires (module Annuaire, modules/annuaire/db/071) : statut dans la liste des personnes (rejouable).
-- La vue par défaut « Tiers provisoires à valider » est générée dans db/121 (client/src/app/vues-liste.js).
-- =============================================================================

CREATE OR REPLACE VIEW v_liste_personnes AS
SELECT per_id AS id, 'personne'::text AS type_element, per_code AS code, per_raison_sociale AS raison_sociale, per_nom_commercial AS nom_commercial,
       per_niv_code AS niveau, ARRAY(SELECT jsonb_array_elements_text(per_casquettes)) AS casquettes, parent, chemin, per_siren AS siren,
       per_siret AS siret, per_tva_intra AS tva_intra, per_pays AS pays, adresse, code_postal, ville, telephone, email, contact,
       per_societe_base AS societe_base, per_actif AS actif, per_modifie_le AS modifie_le, per_provisoire AS provisoire
FROM v_annuaire_personnes;
