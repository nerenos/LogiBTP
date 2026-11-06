-- Cœur – module SAV, équipements installés, lot 4 du plan Stock (plans/stock.md ; modules/sav/db/093s ;
-- ANALYSE-MODULE-STOCK.md § 11, S24.8) : activation du module par société, clés étrangères de la table du module
-- (articles = éléments, lots du stock, lieux = chantiers, clients = personnes, pièces = documents), droits des profils
-- (ceux du Stock) et retrait des équipements d'une pièce dévalidée, annulée ou remplacée. Rejouable.

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_ordre) VALUES
 ('sav', 'SAV', 'Équipements installés chez les clients : numéros de série posés, garantie, retrait, remplacement', 65)
ON CONFLICT (mod_code) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_eqi_element') THEN
        ALTER TABLE equipement_installe ADD CONSTRAINT fk_eqi_element FOREIGN KEY (eqi_ele_id) REFERENCES element(ele_id);
        ALTER TABLE equipement_installe ADD CONSTRAINT fk_eqi_lot FOREIGN KEY (eqi_lot_id) REFERENCES stk_lot(lot_id) ON DELETE SET NULL;
        ALTER TABLE equipement_installe ADD CONSTRAINT fk_eqi_lieu FOREIGN KEY (eqi_lieu_id) REFERENCES chantier(cha_id) ON DELETE SET NULL;
        ALTER TABLE equipement_installe ADD CONSTRAINT fk_eqi_tiers FOREIGN KEY (eqi_tiers_id) REFERENCES personne(per_id) ON DELETE SET NULL;
        ALTER TABLE equipement_installe ADD CONSTRAINT fk_eqi_piece FOREIGN KEY (eqi_ent_id) REFERENCES document(ent_id) ON DELETE CASCADE;
        ALTER TABLE equipement_installe ADD CONSTRAINT fk_eqi_ligne FOREIGN KEY (eqi_lig_id) REFERENCES document_ligne(lig_id) ON DELETE SET NULL;
        ALTER TABLE equipement_installe ADD CONSTRAINT fk_eqi_retrait FOREIGN KEY (eqi_retire_ent_id) REFERENCES document(ent_id) ON DELETE SET NULL;
    END IF;
END $$;

-- Droits : les profils qui ont le nœud « stock » ont le nœud « sav » avec les mêmes actions.
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT dpr_pro_id, 'sav', dpr_actions FROM droit_profil WHERE dpr_noeud = 'stock'
ON CONFLICT DO NOTHING;

-- Pièce dévalidée, annulée ou remplacée : les équipements nés de ses mouvements disparaissent, ceux qu'elle avait
-- retirés redeviennent installés (sauf si le numéro de série a été reposé entre-temps).
CREATE OR REPLACE FUNCTION f_sav_piece_retiree() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.ent_verrouille AND NOT NEW.ent_verrouille)
       OR (NEW.ent_std_id IS DISTINCT FROM OLD.ent_std_id
           AND EXISTS (SELECT 1 FROM statut_document s WHERE s.std_id = NEW.ent_std_id AND s.std_code IN ('ANNULE', 'REMPLACE'))) THEN
        DELETE FROM equipement_installe WHERE eqi_ent_id = NEW.ent_id AND eqi_origine = 'MOUVEMENT';
        BEGIN
            UPDATE equipement_installe SET eqi_etat = 'INSTALLE', eqi_retire_le = NULL, eqi_retire_ent_id = NULL
            WHERE eqi_retire_ent_id = NEW.ent_id AND eqi_etat = 'RETIRE';
        EXCEPTION WHEN unique_violation THEN
            NULL;
        END;
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tr_sav_piece_retiree ON document;
CREATE TRIGGER tr_sav_piece_retiree AFTER UPDATE OF ent_verrouille, ent_std_id ON document FOR EACH ROW EXECUTE FUNCTION f_sav_piece_retiree();
