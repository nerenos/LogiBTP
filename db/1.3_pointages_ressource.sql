-- =============================================================================
-- Cœur – derniers pointages des ressources (lot 4 du plan fiches-lignes-documents, 20/11/2026).
--   v_liste_pointages_materiel : une ligne par pointage de matériel (table pointage_materiel : application de terrain,
--   borne d'atelier, reprise), avec le matériel, le conducteur (salarié) et le chantier ; colonnes d'identifiants
--   materiel_id / salarie_id / chantier_id pour filtrer la liste depuis les fiches. Ces heures n'ont pas de couche
--   saisie / validée : elles ne figurent pas dans v_liste_pointages (main-d'œuvre, poi_pointage).
--   Source de liste « pointages_materiel » (déclarée dans client/src/app/vues-liste.js, thème et vues par défaut : db/121).
-- =============================================================================

CREATE OR REPLACE VIEW v_liste_pointages_materiel AS
SELECT p.pma_id AS id, 'pointage_materiel'::text AS type_element, p.pma_date AS date_pointage,
       m.mat_code::text AS materiel_code, m.mat_designation::text AS materiel, m.mat_id AS materiel_id,
       (s.sal_nom || ' ' || s.sal_prenom)::text AS salarie, s.sal_id AS salarie_id,
       c.cha_code::text AS chantier, c.cha_libelle::text AS chantier_libelle, c.cha_id AS chantier_id,
       round(p.pma_minutes / 60.0, 2) AS heures, p.pma_source::text AS source, p.pma_commentaire::text AS commentaire,
       p.pma_par::text AS saisi_par, p.pma_le AS saisi_le, date_trunc('week', p.pma_date)::date AS semaine
FROM pointage_materiel p
JOIN materiel m ON m.mat_id = p.pma_mat_id
LEFT JOIN salarie s ON s.sal_id = p.pma_sal_id
LEFT JOIN chantier c ON c.cha_id = p.pma_cha_id;

INSERT INTO source_liste (sli_code, sli_libelle, sli_vue, sli_colonne_id, sli_colonne_type, sli_type_element, sli_modifiable)
VALUES ('pointages_materiel', 'Pointages du matériel', 'v_liste_pointages_materiel', 'id', 'type_element', NULL, FALSE)
ON CONFLICT (sli_code) DO UPDATE SET sli_libelle = EXCLUDED.sli_libelle, sli_vue = EXCLUDED.sli_vue,
    sli_colonne_id = EXCLUDED.sli_colonne_id, sli_colonne_type = EXCLUDED.sli_colonne_type;
