-- =============================================================================
-- Cœur – périmètre unique des pièces (lot 0 du module Rentabilité : A1, A2, A5 de ANALYSE-MODULE-ANALYSE.md).
--
-- Les sommes de pièces passent par `v_document_valable` (module Document `019p`) : une version remplacée (REMPLACE,
-- restée verrouillée après une dévalidation) ne compte plus, ce qui doublait le facturé des marchés et les coûts des
-- chantiers après une dévalidation suivie d'une nouvelle validation.
-- Coûts des achats et de la sous-traitance : ventilés par le chantier de chaque ligne (`lig_cha_id`, vide = chantier de
-- l'entête) ; le pied de la pièce (remise, port…) est réparti entre ses chantiers au prorata du HT de leurs lignes.
-- Rejouable.
-- =============================================================================

-- Lignes vendues d'une pièce : lignes chiffrées (ouvrage, élément) sans ligne chiffrée au-dessus, type de prix V sur
-- toute la branche (ni option, variante, pour mémoire ou frais annexes), avec leur chantier (ligne, sinon entête).
CREATE OR REPLACE VIEW v_lignes_vendues AS
SELECT l.lig_id, l.lig_ent_id AS ent_id, coalesce(l.lig_cha_id, d.ent_chantier_id) AS chantier_id, l.lig_nat_id AS nature_id,
       coalesce(l.lig_montant_ht, 0) AS montant_ht
FROM document_ligne l
JOIN document d ON d.ent_id = l.lig_ent_id
WHERE l.lig_tyl_id IN (2, 3)
  AND NOT EXISTS (SELECT 1 FROM document_ligne a
                  WHERE a.lig_ent_id = l.lig_ent_id AND a.lig_chemin @> l.lig_chemin AND a.lig_id <> l.lig_id AND a.lig_tyl_id IN (2, 3))
  AND NOT EXISTS (SELECT 1 FROM document_ligne a
                  WHERE a.lig_ent_id = l.lig_ent_id AND a.lig_chemin @> l.lig_chemin AND coalesce(a.lig_type_prix, 'V') <> 'V');

COMMENT ON VIEW v_lignes_vendues IS 'Lignes vendues (chiffrées de premier niveau, type V sur toute la branche) avec leur chantier : ligne, sinon entête';

-- Part de chaque chantier dans le HT d'une pièce : HT de ses lignes vendues / HT de toutes les lignes vendues ; une
-- pièce sans ligne vendue (ou à lignes nulles) va entière au chantier de l'entête.
CREATE OR REPLACE VIEW v_document_chantiers_part AS
WITH c AS (
    SELECT v.ent_id, v.chantier_id, sum(v.montant_ht) AS ht
    FROM v_lignes_vendues v GROUP BY v.ent_id, v.chantier_id),
t AS (SELECT ent_id, sum(ht) AS ht, count(*) AS nb FROM c GROUP BY ent_id)
SELECT c.ent_id, c.chantier_id, c.ht / t.ht AS part
FROM c JOIN t ON t.ent_id = c.ent_id
WHERE t.ht <> 0
UNION ALL
SELECT d.ent_id, d.ent_chantier_id, 1::numeric
FROM document d
WHERE d.ent_chantier_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM t WHERE t.ent_id = d.ent_id AND t.ht <> 0);

COMMENT ON VIEW v_document_chantiers_part IS 'Part de chaque chantier dans le HT d''une pièce (lignes vendues), entête à défaut';

-- Facturé (reprise de 174) : pièces valables ; une pièce annulée et son avoir d'annulation se compensent.
CREATE OR REPLACE VIEW v_facturation_document AS
SELECT d.ent_id, d.ent_projet_id, d.ent_affaire_id, d.ent_chantier_id, d.ent_marche_id,
       CASE WHEN t.tyd_code IN ('V_FACTURE','V_FACTURE_AVT','V_FACTURE_ACOMPTE') THEN d.ent_total_ht
            WHEN t.tyd_code = 'V_AVOIR' AND d.ent_nature_avoir = 'AVANCEMENT' THEN d.ent_total_ht
            WHEN t.tyd_code = 'V_AVOIR' THEN -d.ent_total_ht ELSE 0 END AS facture_ht
FROM document d
JOIN v_document_valable v ON v.ent_id = d.ent_id
JOIN type_document t ON t.tyd_id = d.ent_tyd_id;

-- Heures budget d'un chantier par service (reprise de 197) : commandes clients valables, non annulées.
CREATE OR REPLACE VIEW v_heures_budget_chantier AS
SELECT d.ent_chantier_id AS chantier_id, h.srv_id, sum(h.heures) AS heures
FROM v_heures_lignes h
JOIN document d ON d.ent_id = h.ent_id
JOIN v_document_valable v ON v.ent_id = d.ent_id AND NOT v.annule
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
WHERE t.tyd_code = 'V_COMMANDE' AND d.ent_chantier_id IS NOT NULL
GROUP BY 1, 2;

-- Montant du marché (reprise de 170) : commandes valables non annulées.
CREATE OR REPLACE FUNCTION f_marche_recalculer(p_mar INT) RETURNS VOID LANGUAGE sql AS $$
    UPDATE marche m SET
        mar_montant_ht = (SELECT coalesce(sum(d.ent_total_ht), 0) FROM marche_document x JOIN document d ON d.ent_id = x.mdo_ent_id
                          WHERE x.mdo_mar_id = m.mar_id AND f_document_valable(d.ent_id, FALSE)),
        mar_ent_id = coalesce((SELECT x.mdo_ent_id FROM marche_document x WHERE x.mdo_mar_id = m.mar_id AND x.mdo_role = 'BASE'), m.mar_ent_id)
    WHERE m.mar_id = p_mar;
$$;

-- Coûts d'un chantier par mois et nature (reprise de 233) : achats et sous-traitance des pièces valables, ventilés par
-- chantier des lignes (pied au prorata).
CREATE OR REPLACE VIEW v_cout_chantier AS
SELECT p.poi_cha_id AS chantier_id, date_trunc('month', p.poi_date)::date AS mois, 'MO'::varchar(20) AS nature,
       round(sum(coalesce(p.poi_cout, 0)), 2) AS montant, sum(p.poi_minutes)::numeric AS minutes,
       count(*) FILTER (WHERE p.poi_cout IS NULL) AS non_valorises
FROM poi_pointage p
WHERE p.poi_couche = CASE WHEN EXISTS (SELECT 1 FROM poi_semaine s WHERE s.psm_sal_id = p.poi_sal_id AND s.psm_lundi = date_trunc('week', p.poi_date)::date)
                          THEN 'VALIDE' ELSE 'SAISIE' END
GROUP BY p.poi_cha_id, date_trunc('month', p.poi_date)
UNION ALL
SELECT d.ent_chantier_id, date_trunc('month', m.mvt_date)::date, 'STOCK',
       round(-sum(m.mvt_quantite * coalesce(m.mvt_prix, m.mvt_pmp, 0)), 2), NULL, count(*) FILTER (WHERE coalesce(m.mvt_prix, m.mvt_pmp) IS NULL)
FROM stk_mouvement m
JOIN document d ON d.ent_id = m.mvt_ent_id
JOIN type_document t ON t.tyd_id = d.ent_tyd_id AND t.tyd_famille = 'S'
WHERE d.ent_chantier_id IS NOT NULL AND m.mvt_lieu_id <> d.ent_chantier_id
GROUP BY d.ent_chantier_id, date_trunc('month', m.mvt_date)
UNION ALL
SELECT c.chantier_id, date_trunc('month', coalesce(d.ent_date_externe, d.ent_date))::date,
       CASE WHEN t.tyd_famille = 'T' THEN 'SOUS_TRAITANCE' ELSE 'ACHAT' END,
       round(sum(c.part * CASE WHEN t.tyd_code IN ('A_AVOIR', 'T_AVOIR') AND d.ent_nature_avoir IS DISTINCT FROM 'AVANCEMENT' THEN -d.ent_total_ht
                               ELSE d.ent_total_ht END), 2), NULL, 0
FROM document d
JOIN v_document_valable v ON v.ent_id = d.ent_id
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
JOIN v_document_chantiers_part c ON c.ent_id = d.ent_id
WHERE c.chantier_id IS NOT NULL AND t.tyd_code IN ('A_FACTURE', 'A_FACTURE_AVT', 'A_AVOIR', 'T_FACTURE_AVT', 'T_AVOIR')
GROUP BY c.chantier_id, date_trunc('month', coalesce(d.ent_date_externe, d.ent_date)), CASE WHEN t.tyd_famille = 'T' THEN 'SOUS_TRAITANCE' ELSE 'ACHAT' END
UNION ALL
SELECT m.mat_cha_id, date_trunc('month', e.mev_date)::date, 'CARBURANT', round(sum(coalesce(e.mev_cout, 0)), 2), NULL, count(*) FILTER (WHERE e.mev_cout IS NULL)
FROM materiel_evenement e
JOIN materiel m ON m.mat_id = e.mev_mat_id
WHERE e.mev_type = 'CARBURANT' AND m.mat_cha_id IS NOT NULL
GROUP BY m.mat_cha_id, date_trunc('month', e.mev_date);

COMMENT ON VIEW v_cout_chantier IS 'Coûts d''un chantier par mois et nature (MO, STOCK, ACHAT, SOUS_TRAITANCE, CARBURANT) : pièces valables, achats ventilés par chantier des lignes';
