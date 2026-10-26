-- =============================================================================
-- Cœur – bibliothèque (analyse des demandes du 25/10/2026, lot 7 : A18a, A18c, A18e, A18g ; module 064). Rejouable.
--
-- v_liste_elements (reprise de db/228) : mots-clés et code-barres (colonnes de recherche des vues de la bibliothèque),
--   délai de livraison, nombre d'ouvrages et d'ensembles qui utilisent l'élément.
-- v_element_utilisations : composantes des compositions (ouvrages, ensembles) liées à un élément (lig_art_id, sinon
--   lig_proprietes.element.id), à toute profondeur de la composition : élément utilisé, composé, quantité, unité.
-- Vues par défaut de la bibliothèque déjà modifiées (121 ne remplace que les vues jamais modifiées) : colonnes masquées
--   mots_cles et code_barre ajoutées si elles manquent (la recherche porte sur les colonnes de la vue).
-- =============================================================================

CREATE OR REPLACE VIEW v_element_utilisations AS
SELECT coalesce(nullif(l->>'lig_art_id', '')::bigint, nullif(l->'lig_proprietes'->'element'->>'id', '')::bigint) AS ele_id,
       e.ele_id AS compose_id, e.ele_code AS compose_code, e.ele_type AS compose_type, e.ele_libelle AS compose_libelle, e.ele_bib_id AS compose_bib_id,
       nullif(l->>'lig_qte', '')::numeric AS quantite, l->>'lig_unt_code' AS unite
FROM element e
CROSS JOIN LATERAL jsonb_array_elements(coalesce(e.ele_composition->'lignes', '[]'::jsonb)) l
WHERE e.ele_type IN ('OUVRAGE', 'ENSEMBLE')
  AND coalesce(nullif(l->>'lig_art_id', ''), nullif(l->'lig_proprietes'->'element'->>'id', '')) IS NOT NULL;

CREATE OR REPLACE VIEW v_liste_elements AS
SELECT e.ele_id AS id, 'element'::text AS type_element, b.bib_code, e.ele_code AS code, e.ele_type AS type, e.ele_libelle AS libelle,
       f.chemin AS famille, n.nat_libelle AS nature, r.rgn_libelle AS regroupement, e.ele_gestion AS gestion, e.ele_unt_stock AS unite_stock,
       e.ele_scenario_pa AS scenario_pa, e.ele_pa AS pa, e.ele_coef_fg AS coef_fg, e.ele_pr AS pr, e.ele_coef_benef AS coef_benef,
       e.ele_pv AS pv, e.ele_pv_net AS pv_net, e.ele_actif AS actif, e.ele_modifie_le AS modifie_le, e.ele_fam_id AS fam_id, e.ele_nat_id AS nat_id,
       coalesce((SELECT array_agg(m.sam_mrq_code ORDER BY m.sam_mrq_code) FROM stk_article_marque m WHERE m.sam_ele_id = e.ele_id), '{}'::varchar[]) AS marques,
       e.ele_usage AS usage,
       e.ele_mots_cles::text AS mots_cles, e.ele_code_barre::text AS code_barre, e.ele_delai_livraison AS delai_livraison,
       (SELECT count(DISTINCT u.compose_id) FROM v_element_utilisations u WHERE u.ele_id = e.ele_id) AS nb_utilisations
FROM element e
JOIN bibliotheque b ON b.bib_id = e.ele_bib_id
LEFT JOIN v_famille_element f ON f.fam_id = e.ele_fam_id
LEFT JOIN nature_element n ON n.nat_id = e.ele_nat_id
LEFT JOIN regroupement_nature r ON r.rgn_code = n.nat_rgn_code;

-- Colonnes de recherche des vues de la bibliothèque déjà modifiées.
UPDATE vue_liste v
   SET vli_definition = jsonb_set(v.vli_definition, '{colonnes}', coalesce(v.vli_definition->'colonnes', '[]')
       || '[{"code": "mots_cles", "titre": "Mots-clés", "masquee": true}, {"code": "code_barre", "titre": "Code-barres", "masquee": true}]'::jsonb)
 WHERE v.vli_definition->'source'->>'vue' = 'elements'
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v.vli_definition->'colonnes', '[]')) c WHERE c->>'code' = 'mots_cles');
