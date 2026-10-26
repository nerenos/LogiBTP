-- =============================================================================
-- Cœur – coûts du matériel (analyse des demandes du 25/10/2026, lot 5c-1 : A8 ; ANALYSE-DEMANDES-2026-10.md § 6,
-- décisions M1 à M4). Rejouable.
--
-- Affaire de gestion MATERIEL : un chantier de suivi par matériel identifié (MAT-<code>), un par type pour les
--   matériels gérés par nombre (MAT-T-<type>, partagé) ; créé à la demande ou à la première imputation
--   (Btp/CoutsMateriel.cs), jamais vide ; materiel.mat_cha_id (db/230).
-- Statut du chantier de suivi : ouvert tant qu'un de ses matériels n'est pas en sommeil, clos sinon (trigger).
-- v_cout_chantier : coûts par chantier, mois et nature :
--   MO               pointages retenus valorisés (couche validée des semaines corrigées, sinon saisie ; v_cout_mo_chantier) ;
--   STOCK            pièces de stock (famille S) du chantier : mouvements sur un autre lieu que lui (sortie d'un dépôt
--                    vers le chantier, retour au dépôt en négatif), valorisés au prix du mouvement, sinon au PMP ;
--   ACHAT            factures et situations fournisseur validées, moins les avoirs (HT, date externe sinon date) ;
--   SOUS_TRAITANCE   factures d'avancement de sous-traitance validées, moins les avoirs.
-- =============================================================================

INSERT INTO affaire (aff_code, aff_libelle, aff_nature, aff_commentaire)
VALUES ('MATERIEL', 'Suivi des coûts du matériel', 'G', 'Affaire de gestion du matériel : un chantier de suivi par matériel identifié, un par type pour le matériel géré par nombre')
ON CONFLICT (aff_code) DO NOTHING;

CREATE OR REPLACE FUNCTION f_materiel_chantier_statut() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    c INT;
BEGIN
    FOREACH c IN ARRAY ARRAY[NEW.mat_cha_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.mat_cha_id END] LOOP
        IF c IS NOT NULL THEN
            UPDATE chantier ch SET cha_statut = x.statut
            FROM (SELECT CASE WHEN EXISTS (SELECT 1 FROM materiel m WHERE m.mat_cha_id = c AND m.mat_usage <> 'S') THEN 'OUVERT' ELSE 'CLOS' END AS statut) x
            WHERE ch.cha_id = c AND ch.cha_statut IS DISTINCT FROM x.statut
              AND EXISTS (SELECT 1 FROM materiel m WHERE m.mat_cha_id = c);
        END IF;
    END LOOP;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_materiel_chantier_statut ON materiel;
CREATE TRIGGER tr_materiel_chantier_statut AFTER INSERT OR UPDATE OF mat_usage, mat_cha_id ON materiel
    FOR EACH ROW EXECUTE FUNCTION f_materiel_chantier_statut();

UPDATE chantier c SET cha_statut = CASE WHEN EXISTS (SELECT 1 FROM materiel m WHERE m.mat_cha_id = c.cha_id AND m.mat_usage <> 'S') THEN 'OUVERT' ELSE 'CLOS' END
WHERE EXISTS (SELECT 1 FROM materiel m WHERE m.mat_cha_id = c.cha_id)
  AND c.cha_statut IS DISTINCT FROM CASE WHEN EXISTS (SELECT 1 FROM materiel m WHERE m.mat_cha_id = c.cha_id AND m.mat_usage <> 'S') THEN 'OUVERT' ELSE 'CLOS' END;

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
SELECT d.ent_chantier_id, date_trunc('month', coalesce(d.ent_date_externe, d.ent_date))::date,
       CASE WHEN t.tyd_famille = 'T' THEN 'SOUS_TRAITANCE' ELSE 'ACHAT' END,
       round(sum(CASE WHEN t.tyd_code IN ('A_AVOIR', 'T_AVOIR') AND d.ent_nature_avoir IS DISTINCT FROM 'AVANCEMENT' THEN -d.ent_total_ht
                      ELSE d.ent_total_ht END), 2), NULL, 0
FROM document d
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
WHERE d.ent_verrouille AND d.ent_chantier_id IS NOT NULL
  AND t.tyd_code IN ('A_FACTURE', 'A_FACTURE_AVT', 'A_AVOIR', 'T_FACTURE_AVT', 'T_AVOIR')
GROUP BY d.ent_chantier_id, date_trunc('month', coalesce(d.ent_date_externe, d.ent_date)), CASE WHEN t.tyd_famille = 'T' THEN 'SOUS_TRAITANCE' ELSE 'ACHAT' END;

COMMENT ON VIEW v_cout_chantier IS 'Coûts d''un chantier par mois et nature (MO, STOCK, ACHAT, SOUS_TRAITANCE) : chantier de suivi du matériel (lot 5c-1)';
