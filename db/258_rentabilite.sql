-- =============================================================================
-- Cœur – module Rentabilité, lot 1 (ANALYSE-MODULE-ANALYSE.md § 4.1, § 5.6, § 11.4, Q7, Q8, R2). Rejouable.
--
-- - activation par société (module_societe « rentabilite ») ;
-- - clés étrangères des tables du module (faits, calculs et file d'un chantier supprimés avec lui) ;
-- - rôle de chaque type de pièce (rentabilite_role_type) : un nouveau type se déclare ici, sans code ; les règles de
--   chaque rôle sont dans Btp/RentabiliteBtp.cs ; un type sans rôle n'entre pas dans l'analyse ;
-- - taux horaire moyen par service (pointages non valorisés, tâches théoriques du planning) et coefficients de frais
--   généraux par nature, datés (PR des coûts réels) ;
-- - ordre d'exécution d'une pièce : elle-même si c'est un OE, sinon l'OE trouvé en remontant les transformations ;
-- - triggers de signalement : ils ne calculent rien, ils mettent les chantiers concernés dans la file du module
--   (pièces verrouillées, soldes de lignes, pointages et semaines validées, tâches et affectations du planning,
--   mouvements de stock).
-- =============================================================================

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_ordre) VALUES
 ('rentabilite', 'Rentabilité', 'Suivi économique des chantiers : budget, budget d''exécution, engagé, déboursé, facturé par nature et par ordre d''exécution', 90)
ON CONFLICT (mod_code) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_afa_chantier') THEN
        ALTER TABLE rentabilite_fait ADD CONSTRAINT fk_afa_chantier FOREIGN KEY (afa_cha_id) REFERENCES chantier (cha_id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rca_chantier') THEN
        ALTER TABLE rentabilite_calcul ADD CONSTRAINT fk_rca_chantier FOREIGN KEY (rca_cha_id) REFERENCES chantier (cha_id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arq_chantier') THEN
        ALTER TABLE rentabilite_a_recalculer ADD CONSTRAINT fk_arq_chantier FOREIGN KEY (arq_cha_id) REFERENCES chantier (cha_id) ON DELETE CASCADE;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Rôle des types de pièces (§ 4.1), codes de RolesRentabilite (Domaine/Codes.cs ↔ ROLE_RENTABILITE de codes.js).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rentabilite_role_type (
    rrt_tyd_code  VARCHAR(20)  PRIMARY KEY REFERENCES type_document (tyd_code) ON UPDATE CASCADE ON DELETE CASCADE,
    rrt_role      VARCHAR(30)  NOT NULL,
    rrt_maj_par   VARCHAR(50),
    rrt_maj_le    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE rentabilite_role_type IS 'Rôle d''un type de pièce dans le module Rentabilité (budget, engagé, déboursé, facturé : règles de Btp/RentabiliteBtp.cs) ; type absent : hors analyse';

INSERT INTO rentabilite_role_type (rrt_tyd_code, rrt_role)
SELECT x.code, x.role FROM (VALUES
    ('V_COMMANDE', 'COMMANDE_VENTE'),
    ('V_FACTURE', 'FACTURE_VENTE'),
    ('V_FACTURE_AVT', 'FACTURE_VENTE'),
    ('V_FACTURE_ACOMPTE', 'FACTURE_ACOMPTE'),
    ('V_AVOIR', 'AVOIR_VENTE'),
    ('E_OE', 'ORDRE_EXECUTION'),
    ('A_COMMANDE', 'COMMANDE_ACHAT'),
    ('A_RECEPTION', 'RECEPTION_ACHAT'),
    ('A_RETOUR', 'RETOUR_ACHAT'),
    ('A_FACTURE', 'FACTURE_ACHAT'),
    ('A_FACTURE_AVT', 'FACTURE_ACHAT'),
    ('A_AVOIR', 'AVOIR_ACHAT'),
    ('T_COMMANDE', 'COMMANDE_ST'),
    ('T_FACTURE_AVT', 'FACTURE_ST'),
    ('T_AVOIR', 'AVOIR_ST'),
    ('S_RESERVATION', 'RESERVATION_STOCK'),
    ('S_SORTIE', 'MOUVEMENT_STOCK'),
    ('S_TRANSFERT', 'MOUVEMENT_STOCK'),
    ('S_ENTREE', 'MOUVEMENT_STOCK')) x (code, role)
WHERE EXISTS (SELECT 1 FROM type_document t WHERE t.tyd_code = x.code)
ON CONFLICT (rrt_tyd_code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Taux horaire moyen par service (Q8, R2) et coefficients de frais généraux par nature, datés (Q7).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rentabilite_taux_service (
    rts_srv_id  INT            PRIMARY KEY REFERENCES service (srv_id) ON DELETE CASCADE,
    rts_taux    NUMERIC(12,4)  NOT NULL CHECK (rts_taux >= 0),
    rts_maj_par VARCHAR(50),
    rts_maj_le  TIMESTAMPTZ    NOT NULL DEFAULT now()
);
COMMENT ON TABLE rentabilite_taux_service IS 'Taux horaire moyen d''un service : pointages non valorisés (signalés) et tâches théoriques sans affectation du planning';

CREATE TABLE IF NOT EXISTS rentabilite_coef_fg (
    rcf_id      SERIAL         PRIMARY KEY,
    rcf_nat_id  INT            REFERENCES nature_element (nat_id) ON DELETE CASCADE,
    rcf_depuis  DATE           NOT NULL,
    rcf_coef    NUMERIC(8,4)   NOT NULL CHECK (rcf_coef > 0),
    rcf_maj_par VARCHAR(50),
    rcf_maj_le  TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rcf_nature_date ON rentabilite_coef_fg (coalesce(rcf_nat_id, 0), rcf_depuis);
COMMENT ON TABLE rentabilite_coef_fg IS 'Coefficient de frais généraux des coûts réels (PR = PA × coefficient) : par nature (vide = toutes), le plus récent à la date du fait ; aucun : 1';

-- -----------------------------------------------------------------------------
-- Ordre d'exécution d'une pièce (§ 5.6, R3) : la pièce si son type a le rôle ORDRE_EXECUTION, sinon le plus proche
-- OE en remontant les transformations (E_DAP → A_COMMANDE → réception → facture…) ; aucun : NULL (« Sans ordre »).
-- Même remontée pour savoir si une facture de vente a une commande d'origine (Q5).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION f_rentabilite_ancetre(p_ent BIGINT, p_role TEXT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
    WITH RECURSIVE remontee (ent_id, niveau) AS (
        SELECT p_ent, 0
        UNION
        SELECT l.lie_source_ent_id, r.niveau + 1 FROM remontee r JOIN document_lien l ON l.lie_cible_ent_id = r.ent_id
        WHERE r.niveau < 8)
    SELECT r.ent_id FROM remontee r
    JOIN document d ON d.ent_id = r.ent_id
    JOIN type_document t ON t.tyd_id = d.ent_tyd_id
    JOIN rentabilite_role_type x ON x.rrt_tyd_code = t.tyd_code AND x.rrt_role = p_role
    ORDER BY r.niveau, r.ent_id LIMIT 1
$$;

COMMENT ON FUNCTION f_rentabilite_ancetre(BIGINT, TEXT) IS 'La pièce ou sa plus proche pièce d''origine (liens de transformation) dont le type a le rôle donné';

CREATE OR REPLACE FUNCTION f_rentabilite_ordre(p_ent BIGINT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
    SELECT f_rentabilite_ancetre(p_ent, 'ORDRE_EXECUTION')
$$;

-- -----------------------------------------------------------------------------
-- Signalement (§ 11.4) : les triggers ne calculent rien, ils mettent les chantiers dans la file du module.
-- -----------------------------------------------------------------------------

-- Chantiers d'une pièce : entête, lignes (document_chantier) et lieux de stock.
CREATE OR REPLACE FUNCTION f_rentabilite_chantiers_piece(p_ent BIGINT) RETURNS INT[] LANGUAGE sql STABLE AS $$
    SELECT ARRAY(SELECT dch_cha_id FROM document_chantier WHERE dch_ent_id = p_ent
                 UNION SELECT d.ent_chantier_id FROM document d WHERE d.ent_id = p_ent AND d.ent_chantier_id IS NOT NULL
                 UNION SELECT d.ent_stk_destination_id::int FROM document d WHERE d.ent_id = p_ent AND d.ent_stk_destination_id IS NOT NULL
                 UNION SELECT d.ent_stk_origine_id::int FROM document d WHERE d.ent_id = p_ent AND d.ent_stk_origine_id IS NOT NULL)
$$;

-- Pièce verrouillée (validation, dévalidation, annulation, statut, rattachement, totaux, dates) ; suppression.
CREATE OR REPLACE FUNCTION trg_rentabilite_document() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.ent_verrouille THEN
            PERFORM f_rentabilite_signaler(ARRAY[OLD.ent_chantier_id], 'Pièce supprimée');
        END IF;
        RETURN NULL;
    END IF;
    IF NOT (OLD.ent_verrouille OR NEW.ent_verrouille) THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM type_document t JOIN rentabilite_role_type x ON x.rrt_tyd_code = t.tyd_code WHERE t.tyd_id = NEW.ent_tyd_id) THEN
        RETURN NULL;
    END IF;
    PERFORM f_rentabilite_signaler(f_rentabilite_chantiers_piece(NEW.ent_id) || ARRAY[OLD.ent_chantier_id],
        'Pièce ' || coalesce(NEW.ent_numero, NEW.ent_id::text) || ' modifiée');
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_document ON document;
CREATE TRIGGER rentabilite_document AFTER UPDATE OF ent_verrouille, ent_std_id, ent_is_reference, ent_chantier_id, ent_total_ht, ent_date, ent_date_externe,
        ent_stk_origine_id, ent_stk_destination_id OR DELETE ON document
    FOR EACH ROW EXECUTE FUNCTION trg_rentabilite_document();

-- Lignes d'une pièce verrouillée (chantier des lignes, solde) et liens de transformation vers elles.
CREATE OR REPLACE FUNCTION trg_rentabilite_lignes() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_chantiers INT[];
BEGIN
    SELECT ARRAY(SELECT DISTINCT unnest(f_rentabilite_chantiers_piece(d.ent_id))
                 FROM document d
                 WHERE d.ent_verrouille AND d.ent_id IN (SELECT lig_ent_id FROM nouvelles UNION SELECT lig_ent_id FROM anciennes))
    INTO v_chantiers;
    IF cardinality(v_chantiers) > 0 THEN PERFORM f_rentabilite_signaler(v_chantiers, 'Lignes d''une pièce validée modifiées'); END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_lignes_maj ON document_ligne;
CREATE TRIGGER rentabilite_lignes_maj AFTER UPDATE ON document_ligne
    REFERENCING OLD TABLE AS anciennes NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION trg_rentabilite_lignes();

CREATE OR REPLACE FUNCTION trg_rentabilite_solde() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_lig BIGINT := CASE WHEN TG_OP = 'DELETE' THEN OLD.lso_lig_id ELSE NEW.lso_lig_id END;
BEGIN
    PERFORM f_rentabilite_signaler(f_rentabilite_chantiers_piece(l.lig_ent_id), 'Solde d''une ligne')
    FROM document_ligne l WHERE l.lig_id = v_lig;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_solde ON document_ligne_solde;
CREATE TRIGGER rentabilite_solde AFTER INSERT OR UPDATE OR DELETE ON document_ligne_solde
    FOR EACH ROW EXECUTE FUNCTION trg_rentabilite_solde();

-- Pointages (saisie, couche validée, valorisation) : par instruction.
CREATE OR REPLACE FUNCTION trg_rentabilite_pointages() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_chantiers INT[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_chantiers := ARRAY(SELECT DISTINCT poi_cha_id FROM nouvelles);
    ELSIF TG_OP = 'DELETE' THEN
        v_chantiers := ARRAY(SELECT DISTINCT poi_cha_id FROM anciennes);
    ELSE
        v_chantiers := ARRAY(SELECT poi_cha_id FROM nouvelles UNION SELECT poi_cha_id FROM anciennes);
    END IF;
    IF cardinality(v_chantiers) > 0 THEN PERFORM f_rentabilite_signaler(v_chantiers, 'Pointages'); END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_pointages_ins ON poi_pointage;
DROP TRIGGER IF EXISTS rentabilite_pointages_maj ON poi_pointage;
DROP TRIGGER IF EXISTS rentabilite_pointages_sup ON poi_pointage;
CREATE TRIGGER rentabilite_pointages_ins AFTER INSERT ON poi_pointage
    REFERENCING NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION trg_rentabilite_pointages();
CREATE TRIGGER rentabilite_pointages_maj AFTER UPDATE ON poi_pointage
    REFERENCING OLD TABLE AS anciennes NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION trg_rentabilite_pointages();
CREATE TRIGGER rentabilite_pointages_sup AFTER DELETE ON poi_pointage
    REFERENCING OLD TABLE AS anciennes FOR EACH STATEMENT EXECUTE FUNCTION trg_rentabilite_pointages();

-- Semaine validée ou dévalidée : la couche retenue change pour les chantiers pointés de la semaine.
CREATE OR REPLACE FUNCTION trg_rentabilite_semaine() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE s RECORD;
BEGIN
    s := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    PERFORM f_rentabilite_signaler(ARRAY(SELECT DISTINCT p.poi_cha_id FROM poi_pointage p
                                         WHERE p.poi_sal_id = s.psm_sal_id AND p.poi_date BETWEEN s.psm_lundi AND s.psm_lundi + 6), 'Semaine de pointage');
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_semaine ON poi_semaine;
CREATE TRIGGER rentabilite_semaine AFTER INSERT OR DELETE ON poi_semaine
    FOR EACH ROW EXECUTE FUNCTION trg_rentabilite_semaine();

-- Planning : tâches d'un chantier et leurs affectations (engagé planifié).
CREATE OR REPLACE FUNCTION trg_rentabilite_tache() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' AND OLD.tac_type_element = 'chantier' AND OLD.tac_id_element ~ '^\d+$' THEN
        PERFORM f_rentabilite_signaler(ARRAY[OLD.tac_id_element::int], 'Planning');
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.tac_type_element = 'chantier' AND NEW.tac_id_element ~ '^\d+$' THEN
        PERFORM f_rentabilite_signaler(ARRAY[NEW.tac_id_element::int], 'Planning');
    END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_tache ON pla_tache;
CREATE TRIGGER rentabilite_tache AFTER INSERT OR UPDATE OF tac_debut, tac_fin, tac_heures, tac_etat, tac_srv_id, tac_type_element, tac_id_element,
        tac_origine_type, tac_origine_id OR DELETE ON pla_tache
    FOR EACH ROW EXECUTE FUNCTION trg_rentabilite_tache();

CREATE OR REPLACE FUNCTION trg_rentabilite_affectation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_tac BIGINT := CASE WHEN TG_OP = 'DELETE' THEN OLD.aff_tac_id ELSE NEW.aff_tac_id END;
BEGIN
    PERFORM f_rentabilite_signaler(ARRAY[t.tac_id_element::int], 'Planning')
    FROM pla_tache t WHERE t.tac_id = v_tac AND t.tac_type_element = 'chantier' AND t.tac_id_element ~ '^\d+$';
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_affectation ON pla_affectation;
CREATE TRIGGER rentabilite_affectation AFTER INSERT OR UPDATE OR DELETE ON pla_affectation
    FOR EACH ROW EXECUTE FUNCTION trg_rentabilite_affectation();

-- Mouvements de stock (sortie, retour, revalorisation au PMP : V18).
CREATE OR REPLACE FUNCTION trg_rentabilite_mouvements() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_chantiers INT[];
BEGIN
    SELECT ARRAY(SELECT DISTINCT unnest(f_rentabilite_chantiers_piece(x.ent))
                 FROM (SELECT mvt_ent_id AS ent FROM nouvelles UNION SELECT mvt_ent_id FROM anciennes) x WHERE x.ent IS NOT NULL)
    INTO v_chantiers;
    IF cardinality(v_chantiers) > 0 THEN PERFORM f_rentabilite_signaler(v_chantiers, 'Mouvements de stock'); END IF;
    RETURN NULL;
END $$;

-- Tables de transition vides pour les opérations sans l'une d'elles : un trigger par opération.
CREATE OR REPLACE FUNCTION trg_rentabilite_mouvements_ins() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM f_rentabilite_signaler(ARRAY(SELECT DISTINCT unnest(f_rentabilite_chantiers_piece(x.mvt_ent_id)) FROM (SELECT DISTINCT mvt_ent_id FROM nouvelles WHERE mvt_ent_id IS NOT NULL) x), 'Mouvements de stock');
    RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION trg_rentabilite_mouvements_sup() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM f_rentabilite_signaler(ARRAY(SELECT DISTINCT unnest(f_rentabilite_chantiers_piece(x.mvt_ent_id)) FROM (SELECT DISTINCT mvt_ent_id FROM anciennes WHERE mvt_ent_id IS NOT NULL) x), 'Mouvements de stock');
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_mouvements_ins ON stk_mouvement;
DROP TRIGGER IF EXISTS rentabilite_mouvements_maj ON stk_mouvement;
DROP TRIGGER IF EXISTS rentabilite_mouvements_sup ON stk_mouvement;
CREATE TRIGGER rentabilite_mouvements_ins AFTER INSERT ON stk_mouvement
    REFERENCING NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION trg_rentabilite_mouvements_ins();
CREATE TRIGGER rentabilite_mouvements_maj AFTER UPDATE ON stk_mouvement
    REFERENCING OLD TABLE AS anciennes NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION trg_rentabilite_mouvements();
CREATE TRIGGER rentabilite_mouvements_sup AFTER DELETE ON stk_mouvement
    REFERENCING OLD TABLE AS anciennes FOR EACH STATEMENT EXECUTE FUNCTION trg_rentabilite_mouvements_sup();

-- Premier calcul : tous les chantiers ouverts dans la file (le planificateur la vide quand le module est actif).
SELECT f_rentabilite_signaler(ARRAY(SELECT cha_id FROM chantier WHERE cha_statut = 'OUVERT'), 'Installation du module');
