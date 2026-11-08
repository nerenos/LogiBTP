-- =============================================================================
-- Cœur – vue des repas d'une période (plan restaurants-suites, lot 3). Rejouable.
--   v_liste_repas : un repas (poi_repas) par ligne, avec salarié, service, restaurant et chantier du jour ;
--   source de liste « repas » (déclarée dans client/src/app/vues-liste.js). Pas de montant : le repas n'en porte pas
--   (avantage en nature par la règle de paie REPAS).
-- =============================================================================

CREATE OR REPLACE VIEW v_liste_repas AS
SELECT r.prp_id AS id, 'repas'::text AS type_element, r.prp_date AS date_repas,
       s.sal_nom || ' ' || s.sal_prenom AS salarie, s.sal_code::varchar(10) AS matricule, s.sal_id AS salarie_id,
       sv.srv_libelle AS service, sv.srv_id AS service_id,
       coalesce(p.per_raison_sociale, r.prp_restaurant_libelle)::text AS restaurant, r.prp_restaurant_id AS restaurant_id,
       c.cha_code AS chantier, c.cha_libelle AS chantier_libelle, c.cha_id AS chantier_id,
       r.prp_commentaire AS commentaire, r.prp_appareil AS appareil, r.prp_par AS saisi_par, r.prp_le AS saisi_le,
       date_trunc('week', r.prp_date)::date AS semaine
FROM poi_repas r
JOIN salarie s ON s.sal_id = r.prp_sal_id
LEFT JOIN personne p ON p.per_id = r.prp_restaurant_id
LEFT JOIN chantier c ON c.cha_id = r.prp_cha_id
LEFT JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
LEFT JOIN service sv ON sv.srv_id = sm.sme_srv_id
WHERE f_module_actif('pointage');

INSERT INTO source_liste (sli_code, sli_libelle, sli_vue, sli_colonne_id, sli_colonne_type, sli_type_element, sli_modifiable)
VALUES ('repas', 'Repas des salariés', 'v_liste_repas', 'id', 'type_element', NULL, FALSE)
ON CONFLICT (sli_code) DO UPDATE SET sli_libelle = EXCLUDED.sli_libelle, sli_vue = EXCLUDED.sli_vue,
    sli_colonne_id = EXCLUDED.sli_colonne_id, sli_colonne_type = EXCLUDED.sli_colonne_type;
