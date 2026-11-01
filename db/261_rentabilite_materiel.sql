-- =============================================================================
-- Cœur – valorisation du matériel et des intérimaires dans la rentabilité (ANALYSE-MODULE-ANALYSE.md § 4.4, § 4.5,
-- V43, V46, R9, R10 ; module Rentabilité, lot 5). Rejouable.
--
-- materiel.mat_cout_horaire : coût moyen horaire d'usage du matériel, saisi sur la fiche (non daté, R9) ; vide : coût
--   du type de matériel (rentabilite_cout_materiel, liste TYPE_MATERIEL), sinon de son type parent
--   (f_cout_horaire_materiel). Les heures pointées du matériel (pointage_materiel) sont un déboursé du chantier pointé,
--   ses heures planifiées (affectations hors location) un engagé ; le matériel loué l'est par sa commande de location.
-- rentabilite_parametre : nature des heures de matériel (Non ventilé si vide ; à l'installation : première nature active
--   du regroupement des engins).
-- Intérimaires (R10) : option du Pointage poi_parametre.ppa_interim_imputes ; non cochée (défaut) : heures sans valeur,
--   coût par les factures de l'agence ; cochée : taux de la mission. Un changement de l'option signale les chantiers.
-- Triggers de signalement : pointages du matériel, coût, type et location d'un matériel, option des intérimaires ;
-- chantiers ouverts remis en file (règles en version 5).
-- =============================================================================

ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_cout_horaire NUMERIC(12,4);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_mat_cout_horaire') THEN
        ALTER TABLE materiel ADD CONSTRAINT ck_mat_cout_horaire CHECK (mat_cout_horaire >= 0);
    END IF;
END $$;
COMMENT ON COLUMN materiel.mat_cout_horaire IS 'Coût moyen horaire d''usage (rentabilité des chantiers) ; vide : coût du type de matériel';

CREATE TABLE IF NOT EXISTS rentabilite_cout_materiel (
    rcm_type     VARCHAR(30)   PRIMARY KEY,
    rcm_cout     NUMERIC(12,4) NOT NULL CHECK (rcm_cout >= 0),
    rcm_maj_par  VARCHAR(50),
    rcm_maj_le   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE rentabilite_cout_materiel IS 'Coût moyen horaire par type de matériel (code de TYPE_MATERIEL ; un type enfant sans coût prend celui de son parent)';

CREATE TABLE IF NOT EXISTS rentabilite_parametre (
    rpa_id            SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (rpa_id = 1),
    rpa_nat_materiel  INT          REFERENCES nature_element (nat_id) ON DELETE SET NULL,
    rpa_maj_par       VARCHAR(50),
    rpa_maj_le        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON COLUMN rentabilite_parametre.rpa_nat_materiel IS 'Nature des heures de matériel pointées et planifiées (vide : non ventilé)';
INSERT INTO rentabilite_parametre (rpa_id, rpa_nat_materiel)
SELECT 1, (SELECT nat_id FROM nature_element WHERE nat_rgn_code = 'ENGIN' AND nat_actif ORDER BY nat_code LIMIT 1)
ON CONFLICT DO NOTHING;

-- Coût horaire effectif : fiche, sinon type, sinon type parent.
CREATE OR REPLACE FUNCTION f_cout_horaire_materiel(p_mat_id INT) RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT coalesce(m.mat_cout_horaire,
                    (SELECT r.rcm_cout FROM rentabilite_cout_materiel r WHERE r.rcm_type = m.mat_famille),
                    (SELECT r.rcm_cout FROM liste_valeur l JOIN rentabilite_cout_materiel r ON r.rcm_type = l.lva_parent
                     WHERE l.lva_liste = 'TYPE_MATERIEL' AND l.lva_code = m.mat_famille))
    FROM materiel m WHERE m.mat_id = p_mat_id
$$;

-- Signalement : pointages du matériel (chantier pointé, avant et après).
CREATE OR REPLACE FUNCTION trg_rentabilite_pointage_materiel() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM f_rentabilite_signaler(ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
        CASE WHEN TG_OP <> 'INSERT' THEN OLD.pma_cha_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.pma_cha_id END]) x WHERE x IS NOT NULL),
        'Pointage du matériel');
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_pointage_materiel ON pointage_materiel;
CREATE TRIGGER rentabilite_pointage_materiel AFTER INSERT OR UPDATE OR DELETE ON pointage_materiel
    FOR EACH ROW EXECUTE FUNCTION trg_rentabilite_pointage_materiel();

-- Coût, type ou location d'un matériel : chantiers où il est pointé ou planifié.
CREATE OR REPLACE FUNCTION trg_rentabilite_materiel() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM f_rentabilite_signaler(ARRAY(
        SELECT p.pma_cha_id FROM pointage_materiel p WHERE p.pma_mat_id = NEW.mat_id AND p.pma_cha_id IS NOT NULL
        UNION
        SELECT t.tac_id_element::int FROM pla_affectation a JOIN pla_tache t ON t.tac_id = a.aff_tac_id
        WHERE a.aff_res_type = 'MATERIEL' AND a.aff_res_id = NEW.mat_id::text AND t.tac_type_element = 'chantier' AND t.tac_id_element ~ '^\d+$'),
        'Coût du matériel');
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_materiel ON materiel;
CREATE TRIGGER rentabilite_materiel AFTER UPDATE OF mat_cout_horaire, mat_famille, mat_loueur_id, mat_fin_location ON materiel
    FOR EACH ROW WHEN (OLD.mat_cout_horaire IS DISTINCT FROM NEW.mat_cout_horaire OR OLD.mat_famille IS DISTINCT FROM NEW.mat_famille
                       OR OLD.mat_loueur_id IS DISTINCT FROM NEW.mat_loueur_id OR OLD.mat_fin_location IS DISTINCT FROM NEW.mat_fin_location)
    EXECUTE FUNCTION trg_rentabilite_materiel();

-- Option des intérimaires du Pointage : chantiers où des intérimaires ont pointé.
CREATE OR REPLACE FUNCTION trg_rentabilite_option_interim() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM f_rentabilite_signaler(ARRAY(
        SELECT DISTINCT p.poi_cha_id FROM poi_pointage p JOIN salarie s ON s.sal_id = p.poi_sal_id WHERE s.sal_statut = 'INTERIM'),
        'Valorisation des intérimaires');
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rentabilite_option_interim ON poi_parametre;
CREATE TRIGGER rentabilite_option_interim AFTER UPDATE OF ppa_interim_imputes ON poi_parametre
    FOR EACH ROW WHEN (OLD.ppa_interim_imputes IS DISTINCT FROM NEW.ppa_interim_imputes)
    EXECUTE FUNCTION trg_rentabilite_option_interim();

-- Les règles de calcul changent (matériel, intérimaires) : tous les chantiers ouverts sont recalculés.
SELECT f_rentabilite_signaler(ARRAY(SELECT cha_id FROM chantier WHERE cha_statut = 'OUVERT'), 'Règles de calcul en version 5 (matériel, intérimaires)');
