-- =============================================================================
-- Cœur LogiBTP – bibliothèque : vue de liste des éléments, unités complémentaires, catégorie GED des notices
-- techniques (DOE). Données de démonstration : 116_bibliotheque_demo.sql (généré).
-- =============================================================================

INSERT INTO unite (unt_code, unt_libelle, unt_precision_qte, unt_ordre) VALUES
 ('pal', 'Palette', 0, 90), ('pl', 'Plaque', 0, 91), ('rl', 'Rouleau', 0, 92)
ON CONFLICT (unt_code) DO NOTHING;

-- Bibliothèque d'un document : codes appelés sans préfixe (null : bibliothèque par défaut).
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_bib_id INT REFERENCES bibliotheque(bib_id);

-- Notices techniques des éléments : remises au client dans le dossier des ouvrages exécutés (DOE).
UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"notice_technique","libelle":"Notice technique (DOE)","doe":true}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"notice_technique"}]'::jsonb;

-- Liste des éléments (source « elements » des listes) : bibliothèque, chemin de la famille, nature et regroupement.
-- fam_id et nat_id : filtres des arbres de familles et de natures (panneau de la liste).
CREATE OR REPLACE VIEW v_liste_elements AS
SELECT e.ele_id AS id, 'element'::text AS type_element, b.bib_code, e.ele_code AS code, e.ele_type AS type, e.ele_libelle AS libelle,
       f.chemin AS famille, n.nat_libelle AS nature, r.rgn_libelle AS regroupement, e.ele_gestion AS gestion, e.ele_unt_stock AS unite_stock,
       e.ele_scenario_pa AS scenario_pa, e.ele_pa AS pa, e.ele_coef_fg AS coef_fg, e.ele_pr AS pr, e.ele_coef_benef AS coef_benef,
       e.ele_pv AS pv, e.ele_pv_net AS pv_net, e.ele_actif AS actif, e.ele_modifie_le AS modifie_le, e.ele_fam_id AS fam_id, e.ele_nat_id AS nat_id
FROM element e
JOIN bibliotheque b ON b.bib_id = e.ele_bib_id
LEFT JOIN v_famille_element f ON f.fam_id = e.ele_fam_id
LEFT JOIN nature_element n ON n.nat_id = e.ele_nat_id
LEFT JOIN regroupement_nature r ON r.rgn_code = n.nat_rgn_code;
