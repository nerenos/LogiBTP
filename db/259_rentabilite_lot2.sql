-- =============================================================================
-- Cœur – module Rentabilité, lot 2 (ANALYSE-MODULE-ANALYSE.md § 4.7, § 6, § 10.3, § 10.4, R6). Rejouable.
--
-- - clés étrangères des contrôles et des photos (supprimés avec leur chantier) ;
-- - rôle RECU_ACOMPTE (reçu d'acompte en trésorerie : sa validation signale le chantier de son marché) ;
-- - triggers de signalement des acomptes en trésorerie : acomptes du marché, déductions des pièces, règlements pointés
--   sur les échéances d'un reçu (module Règlements) ;
-- - règles de calcul en version 2 (acomptes) : tous les chantiers ouverts remis dans la file.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rco_chantier') THEN
        ALTER TABLE rentabilite_controle ADD CONSTRAINT fk_rco_chantier FOREIGN KEY (rco_cha_id) REFERENCES chantier (cha_id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rph_chantier') THEN
        ALTER TABLE rentabilite_photo ADD CONSTRAINT fk_rph_chantier FOREIGN KEY (rph_cha_id) REFERENCES chantier (cha_id) ON DELETE CASCADE;
    END IF;
END $$;

INSERT INTO rentabilite_role_type (rrt_tyd_code, rrt_role)
SELECT 'V_RECU_ACOMPTE', 'RECU_ACOMPTE' WHERE EXISTS (SELECT 1 FROM type_document WHERE tyd_code = 'V_RECU_ACOMPTE')
ON CONFLICT (rrt_tyd_code) DO NOTHING;

-- Chantier du marché d'un acompte.
CREATE OR REPLACE FUNCTION f_rentabilite_chantier_acompte(p_mac INT) RETURNS INT LANGUAGE sql STABLE AS $$
    SELECT m.mar_cha_id FROM marche_acompte a JOIN marche m ON m.mar_id = a.mac_mar_id WHERE a.mac_id = p_mac
$$;

CREATE OR REPLACE FUNCTION trg_rentabilite_marche_acompte() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM f_rentabilite_signaler(ARRAY(SELECT m.mar_cha_id FROM marche m
        WHERE m.mar_id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.mac_mar_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.mac_mar_id END)), 'Acompte du marché modifié');
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS rentabilite_marche_acompte ON marche_acompte;
CREATE TRIGGER rentabilite_marche_acompte AFTER INSERT OR UPDATE OR DELETE ON marche_acompte
    FOR EACH ROW EXECUTE FUNCTION trg_rentabilite_marche_acompte();

CREATE OR REPLACE FUNCTION trg_rentabilite_deduction() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM f_rentabilite_signaler(ARRAY[f_rentabilite_chantier_acompte(CASE WHEN TG_OP = 'DELETE' THEN OLD.acd_mac_id ELSE NEW.acd_mac_id END)],
        'Déduction d''acompte modifiée');
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS rentabilite_deduction ON acompte_deduction;
CREATE TRIGGER rentabilite_deduction AFTER INSERT OR UPDATE OR DELETE ON acompte_deduction
    FOR EACH ROW EXECUTE FUNCTION trg_rentabilite_deduction();

-- Règlement pointé sur l'échéance d'un reçu d'acompte (module Règlements).
CREATE OR REPLACE FUNCTION f_rentabilite_chantiers_echeance(p_ech BIGINT) RETURNS INT[] LANGUAGE sql STABLE AS $$
    SELECT ARRAY(SELECT m.mar_cha_id FROM document_echeance e
                 JOIN marche_acompte a ON a.mac_piece_ent_id = e.ech_ent_id
                 JOIN marche m ON m.mar_id = a.mac_mar_id
                 WHERE e.ech_id = p_ech)
$$;

CREATE OR REPLACE FUNCTION trg_rentabilite_pointage_reglement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN PERFORM f_rentabilite_signaler(f_rentabilite_chantiers_echeance(OLD.poi_echeance_id), 'Règlement d''acompte modifié'); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM f_rentabilite_signaler(f_rentabilite_chantiers_echeance(NEW.poi_echeance_id), 'Règlement d''acompte modifié'); END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS rentabilite_pointage_reglement ON pointage;
CREATE TRIGGER rentabilite_pointage_reglement AFTER INSERT OR UPDATE OR DELETE ON pointage
    FOR EACH ROW EXECUTE FUNCTION trg_rentabilite_pointage_reglement();

CREATE OR REPLACE FUNCTION trg_rentabilite_reglement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM f_rentabilite_signaler(ARRAY(SELECT unnest(f_rentabilite_chantiers_echeance(p.poi_echeance_id)) FROM pointage p WHERE p.poi_reg_id = NEW.reg_id),
        'Règlement d''acompte modifié');
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS rentabilite_reglement ON reglement;
CREATE TRIGGER rentabilite_reglement AFTER UPDATE OF reg_date, reg_montant ON reglement
    FOR EACH ROW EXECUTE FUNCTION trg_rentabilite_reglement();

-- Règles en version 2 : recalcul de tous les chantiers ouverts.
SELECT f_rentabilite_signaler(ARRAY(SELECT cha_id FROM chantier WHERE cha_statut = 'OUVERT'), 'Règles de calcul en version 2 (acomptes)');
