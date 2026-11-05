-- Cœur – module Stock, lots et numéros de série, lot S24-c (module 093h ; ANALYSE-MODULE-STOCK.md § 11, S24.5 à S24.7,
-- S24.12) : élément GED « stk_lot » (certificats matière du lot, catégorie certificat_matiere), liste des lots
-- (v_liste_stk_lots : stock présent, lieux, chantiers où le lot est sorti — colonne chantier filtrable par
-- /liste/stk_lots?chantier=CODE —, certificats, date limite, périmé), clé étrangère des copies de certificats vers
-- les chantiers. Rejouable.

-- Éléments de la GED : reprise de 207 avec le lot de stock.
CREATE OR REPLACE FUNCTION f_ged_element_existe(p_type TEXT, p_id TEXT) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
    n BIGINT;
    tyd INT;
BEGIN
    IF p_type IS NULL OR p_id IS NULL THEN RETURN NULL; END IF;
    IF p_id !~ '^[0-9]{1,18}$' THEN RETURN FALSE; END IF;
    n := p_id::BIGINT;
    SELECT tyd_id INTO tyd FROM type_document WHERE tyd_code = p_type;
    IF FOUND THEN
        RETURN EXISTS (SELECT 1 FROM document WHERE ent_tyd_id = tyd AND coalesce(ent_groupe_id, ent_id) = n);
    END IF;
    RETURN CASE p_type
        WHEN 'salarie'  THEN EXISTS (SELECT 1 FROM salarie WHERE sal_id = n)
        WHEN 'interim'  THEN EXISTS (SELECT 1 FROM salarie WHERE sal_id = n)
        WHEN 'materiel' THEN EXISTS (SELECT 1 FROM materiel WHERE mat_id = n)
        WHEN 'element'  THEN EXISTS (SELECT 1 FROM element WHERE ele_id = n)
        WHEN 'personne' THEN EXISTS (SELECT 1 FROM personne WHERE per_id = n)
        WHEN 'individu' THEN EXISTS (SELECT 1 FROM individu WHERE ind_id = n)
        WHEN 'projet'   THEN EXISTS (SELECT 1 FROM projet WHERE prj_id = n)
        WHEN 'affaire'  THEN EXISTS (SELECT 1 FROM affaire WHERE aff_id = n)
        WHEN 'chantier' THEN EXISTS (SELECT 1 FROM chantier WHERE cha_id = n)
        WHEN 'marche'   THEN EXISTS (SELECT 1 FROM marche WHERE mar_id = n)
        WHEN 'equipe'   THEN EXISTS (SELECT 1 FROM equipe WHERE equ_id = n)
        WHEN 'mail_compte' THEN EXISTS (SELECT 1 FROM mail_compte WHERE mco_id = n)
        WHEN 'stk_lot'  THEN EXISTS (SELECT 1 FROM stk_lot WHERE lot_id = n)
        ELSE CASE WHEN p_type LIKE 'crm\_%' THEN f_crm_element_existe(p_type, n) END
    END;
END $$;

UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"certificat_matiere","libelle":"Certificat matière"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"certificat_matiere"}]'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_slc_lieu') THEN
        ALTER TABLE stk_lot_certificat_copie ADD CONSTRAINT fk_slc_lieu FOREIGN KEY (slc_lieu_id) REFERENCES chantier(cha_id) ON DELETE CASCADE;
    END IF;
END $$;

-- Chantiers servis par un lot : entrées sur un lieu qui n'est pas un dépôt, et sorties d'un dépôt vers la destination ou
-- le chantier de la pièce (un chantier qui ne tient pas de stock n'a pas de mouvement d'entrée).
CREATE OR REPLACE VIEW v_stk_lot_chantier AS
SELECT DISTINCT x.lot_id, x.cha_id FROM (
    SELECT m.mvt_lot_id AS lot_id, m.mvt_lieu_id AS cha_id
    FROM stk_mouvement m JOIN chantier c ON c.cha_id = m.mvt_lieu_id
    WHERE m.mvt_lot_id IS NOT NULL AND m.mvt_quantite > 0 AND NOT c.cha_depot
    UNION ALL
    SELECT m.mvt_lot_id, coalesce(d.ent_stk_destination_id, d.ent_chantier_id)
    FROM stk_mouvement m JOIN document d ON d.ent_id = m.mvt_ent_id
    WHERE m.mvt_lot_id IS NOT NULL AND m.mvt_quantite < 0
) x JOIN chantier c ON c.cha_id = x.cha_id
WHERE x.cha_id IS NOT NULL AND NOT c.cha_depot;
COMMENT ON VIEW v_stk_lot_chantier IS 'Chantiers où un lot est sorti (S24.6) : certificats copiés dans leur GED, filtre de la liste des lots';

CREATE OR REPLACE VIEW v_liste_stk_lots AS
SELECT l.lot_id AS id, 'stk_lot'::text AS type_element, l.lot_numero AS numero,
       e.ele_code AS article, e.ele_libelle AS article_libelle, e.ele_unt_stock AS unite,
       coalesce(s.sas_suivi, 'AUCUN') AS suivi, p.per_raison_sociale AS fournisseur,
       l.lot_fabrication AS fabrication, l.lot_limite AS limite, l.lot_coulee AS coulee, l.lot_norme AS norme,
       coalesce((SELECT sum(q.quantite) FROM v_stk_stock_lot q WHERE q.lot_id = l.lot_id), 0) AS quantite,
       ARRAY(SELECT c.cha_code FROM v_stk_stock_lot q JOIN chantier c ON c.cha_id = q.lieu_id WHERE q.lot_id = l.lot_id ORDER BY c.cha_code) AS lieux,
       -- Chantiers où le lot est sorti (v_stk_lot_chantier) : filtre par rattachement.
       ARRAY(SELECT c.cha_code FROM v_stk_lot_chantier v JOIN chantier c ON c.cha_id = v.cha_id WHERE v.lot_id = l.lot_id ORDER BY c.cha_code) AS chantier,
       (SELECT count(*) FROM document_ged g WHERE g.dge_type_element = 'stk_lot' AND g.dge_id_element = l.lot_id::text
          AND g.dge_categorie = 'certificat_matiere' AND NOT g.dge_supprime) AS certificats,
       coalesce(s.sas_certificat, FALSE) AS certificat_exige,
       coalesce(s.sas_certificat, FALSE) AND NOT EXISTS (SELECT 1 FROM document_ged g WHERE g.dge_type_element = 'stk_lot'
          AND g.dge_id_element = l.lot_id::text AND g.dge_categorie = 'certificat_matiere' AND NOT g.dge_supprime) AS sans_certificat,
       (l.lot_limite IS NOT NULL AND l.lot_limite < current_date) AS perime,
       l.lot_cree_le AS cree_le, l.lot_ele_id AS element_id
FROM stk_lot l
JOIN element e ON e.ele_id = l.lot_ele_id
LEFT JOIN stk_article_suivi s ON s.sas_ele_id = l.lot_ele_id
LEFT JOIN personne p ON p.per_id = l.lot_tiers_id
WHERE f_module_actif('stock');
COMMENT ON VIEW v_liste_stk_lots IS 'Liste des lots et numéros de série (S24) : stock présent, lieux, chantiers servis, certificats, péremption';
