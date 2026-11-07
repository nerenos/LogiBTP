-- Cœur – module SAV, lot 5 du plan Stock (plans/stock.md ; ANALYSE-MODULE-STOCK.md § 11, S24.8) : liste des équipements
-- installés (module Liste, source sav_equipements) : article, chantier (filtre ?chantier=CODE), client, pose, fin et état de la garantie, état.
-- Fin de garantie = fin saisie, sinon pose + durée en mois − 1 jour (même règle que ReglesGarantie). Rejouable.

CREATE OR REPLACE VIEW v_liste_equipements AS
SELECT q.*,
       CASE WHEN q.fin_garantie IS NULL THEN 'SANS' WHEN q.fin_garantie < current_date THEN 'ECHUE' ELSE 'EN_COURS' END AS garantie
FROM (
    SELECT i.eqi_id AS id, 'equipement'::text AS type_element, i.eqi_numero AS numero,
           e.ele_code AS article, e.ele_libelle AS article_libelle, i.eqi_libelle AS libelle,
           c.cha_code AS chantier, c.cha_libelle AS chantier_libelle, p.per_raison_sociale AS tiers,
           i.eqi_pose AS pose,
           coalesce(i.eqi_fin_garantie,
                    CASE WHEN i.eqi_pose IS NOT NULL AND coalesce(i.eqi_garantie_mois, 0) > 0
                         THEN (i.eqi_pose + i.eqi_garantie_mois * interval '1 month' - interval '1 day')::date END) AS fin_garantie,
           i.eqi_etat AS etat, i.eqi_origine AS origine, i.eqi_retire_le AS retire_le,
           d.ent_numero AS piece, i.eqi_cree_le AS cree_le,
           i.eqi_ele_id AS element_id, i.eqi_lieu_id AS lieu_id, i.eqi_tiers_id AS tiers_id
    FROM equipement_installe i
    JOIN element e ON e.ele_id = i.eqi_ele_id
    LEFT JOIN chantier c ON c.cha_id = i.eqi_lieu_id
    LEFT JOIN personne p ON p.per_id = i.eqi_tiers_id
    LEFT JOIN document d ON d.ent_id = i.eqi_ent_id
    WHERE f_module_actif('sav')
) q;
COMMENT ON VIEW v_liste_equipements IS 'Liste des équipements installés chez les clients (module SAV) : numéro de série, lieu, client, garantie, état';
