-- =============================================================================
-- Cœur – module Stock, lot 2 (ANALYSE-MODULE-STOCK.md § 5.1, § 5.3 ; module 093b) : clés étrangères des lots
-- d'inventaire (lieu = chantier), des lignes de bordereaux et des marques (articles = éléments) ; colonne `marques` de
-- la liste des éléments de la bibliothèque (filtre « parmi », segments). Rejouable.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lin_lieu') THEN
        ALTER TABLE stk_lot_inventaire ADD CONSTRAINT fk_lin_lieu FOREIGN KEY (lin_lieu_id) REFERENCES chantier(cha_id);
        ALTER TABLE stk_bordereau_ligne ADD CONSTRAINT fk_bli_element FOREIGN KEY (bli_ele_id) REFERENCES element(ele_id);
        ALTER TABLE stk_article_marque ADD CONSTRAINT fk_sam_element FOREIGN KEY (sam_ele_id) REFERENCES element(ele_id) ON DELETE CASCADE;
    END IF;
END $$;

-- Liste des éléments (reprise de 115) : marques de l'article en fin de vue.
CREATE OR REPLACE VIEW v_liste_elements AS
SELECT e.ele_id AS id, 'element'::text AS type_element, b.bib_code, e.ele_code AS code, e.ele_type AS type, e.ele_libelle AS libelle,
       f.chemin AS famille, n.nat_libelle AS nature, r.rgn_libelle AS regroupement, e.ele_gestion AS gestion, e.ele_unt_stock AS unite_stock,
       e.ele_scenario_pa AS scenario_pa, e.ele_pa AS pa, e.ele_coef_fg AS coef_fg, e.ele_pr AS pr, e.ele_coef_benef AS coef_benef,
       e.ele_pv AS pv, e.ele_pv_net AS pv_net, e.ele_actif AS actif, e.ele_modifie_le AS modifie_le, e.ele_fam_id AS fam_id, e.ele_nat_id AS nat_id,
       coalesce((SELECT array_agg(m.sam_mrq_code ORDER BY m.sam_mrq_code) FROM stk_article_marque m WHERE m.sam_ele_id = e.ele_id), '{}'::varchar[]) AS marques
FROM element e
JOIN bibliotheque b ON b.bib_id = e.ele_bib_id
LEFT JOIN v_famille_element f ON f.fam_id = e.ele_fam_id
LEFT JOIN nature_element n ON n.nat_id = e.ele_nat_id
LEFT JOIN regroupement_nature r ON r.rgn_code = n.nat_rgn_code;
