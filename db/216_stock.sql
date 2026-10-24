-- =============================================================================
-- Cœur – module Stock, lot 1 (ANALYSE-MODULE-STOCK.md § 3.2, § 4, S1, S2, S9 à S12 ; module 093) : activation
-- (`module_societe` « stock »), lieux de stock = chantiers (dépôt géré `cha_depot`, ou chantier qui tient un stock
-- `cha_stock_tenu` ; sinon une entrée sur le chantier est consommée), affaire de gestion « STOCK » et dépôt principal
-- (chantier interne INT-DEPOT), date du mouvement et lieux d'origine / de destination des pièces, clés étrangères des
-- tables du module, retrait des mouvements d'une pièce dévalidée ou annulée (prix de facture retiré des réceptions),
-- vues de liste des mouvements et des dépôts. Rejouable.
-- =============================================================================

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_ordre) VALUES
 ('stock', 'Stock', 'Dépôts et emplacements, mouvements des livraisons, réceptions et transferts, valorisation, inventaires, réservations, dotations des salariés', 60)
ON CONFLICT (mod_code) DO NOTHING;

-- Lieux de stock : dépôt géré (inventaires, mini / maxi), ou chantier qui tient un stock (S2).
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_depot BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_stock_tenu BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN chantier.cha_depot IS 'Dépôt de stock géré (module Stock) : emplacements, inventaires, mini / maxi';
COMMENT ON COLUMN chantier.cha_stock_tenu IS 'Chantier qui tient un stock (transferts entre chantiers) ; sinon une entrée sur le chantier est consommée (S2)';

INSERT INTO affaire (aff_code, aff_libelle, aff_nature, aff_commentaire)
VALUES ('STOCK', 'Stock (dépôts)', 'G', 'Affaire de gestion des dépôts de stock (module Stock)')
ON CONFLICT (aff_code) DO NOTHING;
UPDATE chantier SET cha_depot = TRUE, cha_aff_id = coalesce(cha_aff_id, (SELECT aff_id FROM affaire WHERE aff_code = 'STOCK'))
WHERE cha_code = 'INT-DEPOT' AND NOT cha_depot;

-- Pièces : date-heure du mouvement (S10 : validation par défaut), lieu d'origine et de destination (S9, S12).
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_date_mouvement TIMESTAMPTZ;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_stk_origine_id INT REFERENCES chantier(cha_id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_stk_destination_id INT REFERENCES chantier(cha_id) ON DELETE SET NULL;
COMMENT ON COLUMN document.ent_date_mouvement IS 'Date-heure du mouvement de stock (à la minute ; instant de la validation par défaut)';
COMMENT ON COLUMN document.ent_stk_origine_id IS 'Lieu de stock d''origine : dépôt de départ d''une livraison, origine d''un transfert (vide : entrée)';
COMMENT ON COLUMN document.ent_stk_destination_id IS 'Lieu de stock de destination : dépôt d''une réception, destination d''un transfert (vide : sortie)';

-- Clés étrangères des tables du module (articles = éléments, lieux = chantiers, pièces = documents).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mvt_element') THEN
        ALTER TABLE stk_mouvement ADD CONSTRAINT fk_mvt_element FOREIGN KEY (mvt_ele_id) REFERENCES element(ele_id);
        ALTER TABLE stk_mouvement ADD CONSTRAINT fk_mvt_lieu FOREIGN KEY (mvt_lieu_id) REFERENCES chantier(cha_id);
        ALTER TABLE stk_mouvement ADD CONSTRAINT fk_mvt_piece FOREIGN KEY (mvt_ent_id) REFERENCES document(ent_id) ON DELETE CASCADE;
        ALTER TABLE stk_mouvement ADD CONSTRAINT fk_mvt_ligne FOREIGN KEY (mvt_lig_id) REFERENCES document_ligne(lig_id) ON DELETE CASCADE;
        ALTER TABLE stk_mouvement ADD CONSTRAINT fk_mvt_tiers FOREIGN KEY (mvt_tiers_id) REFERENCES personne(per_id) ON DELETE SET NULL;
        ALTER TABLE stk_mouvement ADD CONSTRAINT fk_mvt_individu FOREIGN KEY (mvt_ind_id) REFERENCES individu(ind_id) ON DELETE SET NULL;
        ALTER TABLE stk_comptage ADD CONSTRAINT fk_cpt_element FOREIGN KEY (cpt_ele_id) REFERENCES element(ele_id);
        ALTER TABLE stk_comptage ADD CONSTRAINT fk_cpt_lieu FOREIGN KEY (cpt_lieu_id) REFERENCES chantier(cha_id);
        ALTER TABLE stk_comptage ADD CONSTRAINT fk_cpt_piece FOREIGN KEY (cpt_ent_id) REFERENCES document(ent_id) ON DELETE CASCADE;
        ALTER TABLE stk_reevaluation ADD CONSTRAINT fk_rev_element FOREIGN KEY (rev_ele_id) REFERENCES element(ele_id) ON DELETE CASCADE;
        ALTER TABLE stk_emplacement ADD CONSTRAINT fk_emp_lieu FOREIGN KEY (emp_lieu_id) REFERENCES chantier(cha_id) ON DELETE CASCADE;
        ALTER TABLE stk_article_emplacement ADD CONSTRAINT fk_sae_element FOREIGN KEY (sae_ele_id) REFERENCES element(ele_id) ON DELETE CASCADE;
    END IF;
END $$;

-- Pièce dévalidée, annulée ou remplacée : ses mouvements disparaissent ; une facture annulée rend aux réceptions leur
-- prix d'origine (provisoire). Les articles touchés sont revalorisés (triggers du module).
CREATE OR REPLACE FUNCTION f_stk_piece_retiree() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.ent_verrouille AND NOT NEW.ent_verrouille)
       OR (NEW.ent_std_id IS DISTINCT FROM OLD.ent_std_id
           AND EXISTS (SELECT 1 FROM statut_document s WHERE s.std_id = NEW.ent_std_id AND s.std_code IN ('ANNULE', 'REMPLACE'))) THEN
        DELETE FROM stk_mouvement WHERE mvt_ent_id = NEW.ent_id;
        UPDATE stk_mouvement SET mvt_prix = mvt_prix_initial, mvt_provisoire = TRUE, mvt_prix_ent_id = NULL WHERE mvt_prix_ent_id = NEW.ent_id;
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tr_stk_piece_retiree ON document;
CREATE TRIGGER tr_stk_piece_retiree AFTER UPDATE OF ent_verrouille, ent_std_id ON document FOR EACH ROW EXECUTE FUNCTION f_stk_piece_retiree();

-- Mouvements de stock (liste) : pièce, article, lieu, quantité en unité de stock, valeur au PMP du mouvement.
CREATE OR REPLACE VIEW v_liste_stk_mouvements AS
SELECT m.mvt_id AS id, 'mouvement_stock'::text AS type_element,
       m.mvt_date AS date_mouvement, c.cha_code AS lieu, c.cha_libelle AS lieu_libelle, c.cha_depot AS depot,
       e.ele_code AS article, e.ele_libelle AS article_libelle, e.ele_unt_stock AS unite,
       m.mvt_quantite AS quantite, CASE WHEN m.mvt_quantite > 0 THEN 'Entrée' ELSE 'Sortie' END AS sens,
       m.mvt_prix AS prix, m.mvt_provisoire AS provisoire, m.mvt_pmp AS pmp,
       round(m.mvt_quantite * coalesce(m.mvt_prix, m.mvt_pmp), 2) AS valeur,
       d.ent_numero AS piece, t.tyd_libelle AS type_piece, t.tyd_code AS type_document, p.per_raison_sociale AS tiers,
       emp.emp_code AS emplacement, m.mvt_origine AS origine,
       m.mvt_ele_id AS element_id, m.mvt_lieu_id AS lieu_id, m.mvt_ent_id AS document_id
FROM stk_mouvement m
JOIN element e ON e.ele_id = m.mvt_ele_id
JOIN chantier c ON c.cha_id = m.mvt_lieu_id
LEFT JOIN document d ON d.ent_id = m.mvt_ent_id
LEFT JOIN type_document t ON t.tyd_id = d.ent_tyd_id
LEFT JOIN personne p ON p.per_id = m.mvt_tiers_id
LEFT JOIN stk_emplacement emp ON emp.emp_id = m.mvt_emp_id
WHERE f_module_actif('stock');

-- Dépôts et chantiers qui tiennent un stock : nombre d'articles en stock et valeur présente.
CREATE OR REPLACE VIEW v_liste_depots AS
SELECT c.cha_id AS id, 'chantier'::text AS type_element, c.cha_code AS code, c.cha_libelle AS libelle,
       c.cha_depot AS depot, c.cha_ville AS ville, c.cha_statut AS statut,
       (SELECT count(*) FROM v_stk_stock s WHERE s.lieu_id = c.cha_id AND s.quantite <> 0) AS nb_articles,
       (SELECT round(sum(s.quantite * coalesce(s.valeur_unitaire, e.ele_pa)), 2) FROM v_stk_stock s JOIN element e ON e.ele_id = s.ele_id
         WHERE s.lieu_id = c.cha_id AND s.quantite <> 0) AS valeur,
       (SELECT count(*) FROM stk_emplacement x WHERE x.emp_lieu_id = c.cha_id) AS nb_emplacements
FROM chantier c
WHERE (c.cha_depot OR c.cha_stock_tenu) AND f_module_actif('stock');
