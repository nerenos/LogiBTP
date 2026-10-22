-- =============================================================================
-- Cœur – module Planning, lot 2 (modules/planning/db/089) : activation par société, service des tâches. Les
-- ressources des affectations (salariés, matériels, sous-traitants) sont désignées par type et identifiant, sans clé
-- étrangère (plusieurs tables). Rejouable.
-- =============================================================================

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_ordre) VALUES
 ('planning', 'Planning', 'Planification des tâches des chantiers et des services sur les ressources (équipes, salariés, matériels), capacité et charge', 35)
ON CONFLICT (mod_code) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tac_service') THEN
        ALTER TABLE pla_tache ADD CONSTRAINT fk_tac_service FOREIGN KEY (tac_srv_id) REFERENCES service (srv_id);
    END IF;
END $$;
