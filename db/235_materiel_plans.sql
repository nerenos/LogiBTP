-- =============================================================================
-- Cœur – plans et échéances d'entretien du matériel (analyse des demandes du 25/10/2026, lot 5c-4 : A9, contenu de
-- A4, décision M6 ; ANALYSE-DEMANDES-2026-10.md § 6). Rejouable.
--
-- materiel_plan : plan d'entretien d'un type de matériel (mpl_type, code de TYPE_MATERIEL : un type enfant hérite de son
--   parent) ou d'un matériel (mpl_mat_id) ; même code = remplace le plan hérité, inactif = le retire ; périodicités en
--   heures, kilomètres, mois (la première atteinte déclenche), nature, opérations (une par ligne, reprises dans l'ordre
--   d'entretien). Échéances calculées par ReglesEntretiens.cs ↔ client/src/app/ressources/entretiens.js (jeu
--   tests/ressources/06_entretiens.json) dans Btp/PlansEntretien.cs.
-- materiel_evenement.mev_plan_code : plan réalisé par un entretien ou un contrôle (dernier entretien d'un plan) ; posé
--   à la clôture d'un ordre d'entretien issu d'un plan (document.ent_mpl_id, db/234 : clé étrangère ici).
-- Démonstration : plans des types Engins, Levage, Véhicules (une fois, table vide).
-- =============================================================================

CREATE TABLE IF NOT EXISTS materiel_plan (
    mpl_id          SERIAL        PRIMARY KEY,
    mpl_type        VARCHAR(30),
    mpl_mat_id      INT           REFERENCES materiel(mat_id) ON DELETE CASCADE,
    mpl_code        VARCHAR(20)   NOT NULL,
    mpl_libelle     VARCHAR(150),
    mpl_operations  TEXT,
    mpl_nature      VARCHAR(15)   NOT NULL DEFAULT 'PREVENTIF' CHECK (mpl_nature IN ('PREVENTIF', 'CURATIF', 'REGLEMENTAIRE')),
    mpl_heures      NUMERIC(10,1) CHECK (mpl_heures > 0),
    mpl_km          NUMERIC(10,0) CHECK (mpl_km > 0),
    mpl_mois        INT           CHECK (mpl_mois > 0),
    mpl_actif       BOOLEAN       NOT NULL DEFAULT TRUE,
    mpl_ordre       INT           NOT NULL DEFAULT 0,
    mpl_maj_par     VARCHAR(50),
    mpl_maj_le      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CHECK ((mpl_type IS NULL) <> (mpl_mat_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mpl_type_code ON materiel_plan (mpl_type, mpl_code) WHERE mpl_type IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mpl_materiel_code ON materiel_plan (mpl_mat_id, mpl_code) WHERE mpl_mat_id IS NOT NULL;

ALTER TABLE materiel_evenement ADD COLUMN IF NOT EXISTS mev_plan_code VARCHAR(20);
CREATE INDEX IF NOT EXISTS ix_mev_plan ON materiel_evenement (mev_mat_id, mev_plan_code, mev_date) WHERE mev_plan_code IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ent_mpl') THEN
        UPDATE document SET ent_mpl_id = NULL WHERE ent_mpl_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM materiel_plan WHERE mpl_id = ent_mpl_id);
        ALTER TABLE document ADD CONSTRAINT fk_ent_mpl FOREIGN KEY (ent_mpl_id) REFERENCES materiel_plan(mpl_id) ON DELETE SET NULL;
    END IF;
END $$;

-- Clôture d'un ordre d'entretien (reprise de db/234) : l'événement porte le code du plan de l'ordre.
CREATE OR REPLACE FUNCTION f_entretien_cloture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.ent_mat_id IS NULL OR NOT EXISTS (SELECT 1 FROM type_document t WHERE t.tyd_id = NEW.ent_tyd_id AND t.tyd_code = 'E_ENT') THEN
        RETURN NULL;
    END IF;
    IF NEW.ent_exe_etat = 'TERMINE' AND OLD.ent_exe_etat IS DISTINCT FROM 'TERMINE'
       AND NOT EXISTS (SELECT 1 FROM materiel_evenement e WHERE e.mev_ent_id = NEW.ent_id AND e.mev_type = 'ENTRETIEN') THEN
        INSERT INTO materiel_evenement (mev_mat_id, mev_type, mev_date, mev_libelle, mev_description, mev_ent_id, mev_plan_code, mev_maj_par)
        VALUES (NEW.ent_mat_id, 'ENTRETIEN',
                coalesce((SELECT max(r.mre_date) FROM materiel_releve r WHERE r.mre_ent_id = NEW.ent_id), current_date),
                left(coalesce(nullif(NEW.ent_objet, ''), 'Entretien ' || coalesce(NEW.ent_numero, '')), 150),
                CASE NEW.ent_ent_nature WHEN 'PREVENTIF' THEN 'Entretien préventif' WHEN 'CURATIF' THEN 'Entretien curatif (réparation)'
                                        WHEN 'REGLEMENTAIRE' THEN 'Entretien réglementaire' END,
                NEW.ent_id, (SELECT p.mpl_code FROM materiel_plan p WHERE p.mpl_id = NEW.ent_mpl_id), 'ordre');
    ELSIF OLD.ent_exe_etat = 'TERMINE' AND NEW.ent_exe_etat IS DISTINCT FROM 'TERMINE' THEN
        DELETE FROM materiel_evenement WHERE mev_ent_id = NEW.ent_id AND mev_type = 'ENTRETIEN' AND mev_maj_par = 'ordre';
    END IF;
    RETURN NULL;
END $$;

INSERT INTO materiel_plan (mpl_type, mpl_code, mpl_libelle, mpl_operations, mpl_nature, mpl_heures, mpl_km, mpl_mois, mpl_ordre, mpl_maj_par)
SELECT x.type, x.code, x.libelle, x.operations, x.nature, x.heures, x.km, x.mois, x.ordre, 'demo'
FROM (VALUES
    ('ENGINS', 'VIDANGE', 'Vidange moteur et filtres', E'Vidange huile moteur\nFiltres à huile, à air et à gazole\nContrôle des niveaux', 'PREVENTIF', 250, NULL, 12, 10),
    ('ENGINS', 'GRAISSAGE', 'Graissage des articulations', 'Graissage de toutes les articulations', 'PREVENTIF', 50, NULL, NULL, 20),
    ('LEVAGE', 'REVISION', 'Révision annuelle', E'Contrôle des organes de levage\nVidange hydraulique', 'PREVENTIF', 500, NULL, 12, 10),
    ('VEHICULES', 'REVISION', 'Révision constructeur', E'Vidange et filtres\nContrôle des freins', 'PREVENTIF', NULL, 20000, 12, 10),
    ('VEHICULES', 'PNEUS', 'Contrôle et permutation des pneus', 'Usure, pression, permutation', 'PREVENTIF', NULL, 10000, NULL, 20)
) AS x(type, code, libelle, operations, nature, heures, km, mois, ordre)
WHERE NOT EXISTS (SELECT 1 FROM materiel_plan);
