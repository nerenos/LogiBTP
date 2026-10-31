-- =============================================================================
-- Cœur – matériel (analyse d'ergonomie du 31/10/2026, FM1 à FM3). Rejouable.
--
-- FM1 : un matériel identifié a toujours une quantité de 1 (trigger, quelle que soit la saisie).
-- FM2 : compteurs saisis à la création de la fiche → relevés initiaux de source REPRISE à la date d'entrée ; une valeur
--   corrigée ensuite est un relevé de rectification (source INVENTAIRE, motif obligatoire) qui peut descendre sous le
--   précédent (ReglesCompteurs ↔ compteurs.js, jeu tests/ressources/05_compteurs.json).
-- FM3 : deux notions séparées — la disponibilité (mat_etat : Disponible, En chantier, En panne, Rebut) et la condition
--   (mat_condition : liste paramétrable ETAT_MATERIEL — bon état, usé, endommagé, hors service). Chaque changement de
--   l'une ou de l'autre est tracé dans materiel_etat (date, valeurs, motif, origine, auteur). Affectations : condition au
--   départ (celle du matériel) et au retour (obligatoire pour clore celle d'un matériel identifié, sauf affectations
--   déjà terminées : maf_retour_requis à false) ; retour endommagé ou hors service → événement et notification
--   (AffectationsMateriel.cs).
-- =============================================================================

-- FM2 : rectification d'un compteur.
ALTER TABLE materiel_releve DROP CONSTRAINT IF EXISTS materiel_releve_mre_source_check;
ALTER TABLE materiel_releve ADD CONSTRAINT materiel_releve_mre_source_check
    CHECK (mre_source IN ('SAISIE', 'CARBURANT', 'ORDRE', 'BORNE', 'REPRISE', 'TERRAIN', 'INVENTAIRE'));
ALTER TABLE materiel ALTER COLUMN mat_heures SET DEFAULT 0;

-- FM3 : conditions du matériel (liste de valeurs du cœur), une seule fois.
INSERT INTO liste_valeur (lva_liste, lva_code, lva_libelle, lva_ordre, lva_couleur)
SELECT 'ETAT_MATERIEL', v.code, v.libelle, v.ordre, v.couleur
FROM (VALUES ('BON', 'Bon état', 10, NULL), ('USE', 'Usé', 20, NULL), ('ENDOMMAGE', 'Endommagé', 30, '#d97706'), ('HS', 'Hors service', 40, '#dc2626'))
     AS v(code, libelle, ordre, couleur)
WHERE NOT EXISTS (SELECT 1 FROM liste_valeur WHERE lva_liste = 'ETAT_MATERIEL');

ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_condition VARCHAR(30) NOT NULL DEFAULT 'BON';
-- Motif, origine et auteur du dernier changement : posés avec la modification, recopiés dans l'historique puis vidés.
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_etat_motif VARCHAR(200);
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_etat_source VARCHAR(15);
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_etat_par VARCHAR(50);

CREATE TABLE IF NOT EXISTS materiel_etat (
    met_id          SERIAL        PRIMARY KEY,
    met_mat_id      INT           NOT NULL REFERENCES materiel(mat_id) ON DELETE CASCADE,
    met_le          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    met_etat        VARCHAR(10)   NOT NULL,
    met_condition   VARCHAR(30)   NOT NULL,
    met_motif       VARCHAR(200),
    met_source      VARCHAR(15)   NOT NULL DEFAULT 'FICHE' CHECK (met_source IN ('CREATION', 'FICHE', 'AFFECTATION', 'REPRISE')),
    met_par         VARCHAR(50)
);
CREATE INDEX IF NOT EXISTS ix_met_materiel ON materiel_etat (met_mat_id, met_le);

-- Affectations : condition au départ et au retour.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'materiel_affectation' AND column_name = 'maf_retour_requis') THEN
        ALTER TABLE materiel_affectation ADD COLUMN maf_retour_requis BOOLEAN NOT NULL DEFAULT TRUE;
        -- Affectations déjà terminées : leur état de retour n'est pas connu, il n'est pas exigé.
        UPDATE materiel_affectation SET maf_retour_requis = FALSE WHERE maf_au IS NOT NULL;
    END IF;
END $$;
ALTER TABLE materiel_affectation ADD COLUMN IF NOT EXISTS maf_condition_depart VARCHAR(30);
ALTER TABLE materiel_affectation ADD COLUMN IF NOT EXISTS maf_condition_retour VARCHAR(30);

-- Reprise : état initial de chaque matériel (une fois).
INSERT INTO materiel_etat (met_mat_id, met_le, met_etat, met_condition, met_motif, met_source, met_par)
SELECT m.mat_id, coalesce(m.mat_date_entree::timestamptz, now()), m.mat_etat, m.mat_condition, NULL, 'REPRISE', 'reprise'
FROM materiel m WHERE NOT EXISTS (SELECT 1 FROM materiel_etat e WHERE e.met_mat_id = m.mat_id);

-- FM1 et historique des changements (avant écriture : la ligne existe, le motif est vidé une fois recopié).
CREATE OR REPLACE FUNCTION f_materiel_avant_ecriture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.mat_mode = 'IDENTIFIE' THEN NEW.mat_quantite := 1; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.mat_etat IS DISTINCT FROM OLD.mat_etat OR NEW.mat_condition IS DISTINCT FROM OLD.mat_condition) THEN
        INSERT INTO materiel_etat (met_mat_id, met_etat, met_condition, met_motif, met_source, met_par)
        VALUES (NEW.mat_id, NEW.mat_etat, NEW.mat_condition, nullif(trim(NEW.mat_etat_motif), ''), coalesce(NEW.mat_etat_source, 'FICHE'), NEW.mat_etat_par);
    END IF;
    IF TG_OP = 'UPDATE' THEN
        NEW.mat_etat_motif := NULL;
        NEW.mat_etat_source := NULL;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_materiel_avant_ecriture ON materiel;
CREATE TRIGGER tr_materiel_avant_ecriture BEFORE INSERT OR UPDATE ON materiel
    FOR EACH ROW EXECUTE FUNCTION f_materiel_avant_ecriture();

-- Création : état initial et relevés initiaux des compteurs saisis (FM2).
CREATE OR REPLACE FUNCTION f_materiel_apres_creation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO materiel_etat (met_mat_id, met_etat, met_condition, met_motif, met_source, met_par)
    VALUES (NEW.mat_id, NEW.mat_etat, NEW.mat_condition, nullif(trim(NEW.mat_etat_motif), ''), 'CREATION', NEW.mat_etat_par);
    INSERT INTO materiel_releve (mre_mat_id, mre_date, mre_unite, mre_valeur, mre_source, mre_commentaire, mre_maj_par)
    SELECT NEW.mat_id, coalesce(NEW.mat_date_entree, current_date), r.unite, r.valeur, 'REPRISE', 'Compteur à la création de la fiche', coalesce(NEW.mat_etat_par, 'creation')
    FROM (VALUES ('H', NEW.mat_heures::numeric), ('KM', NEW.mat_kilometres::numeric)) AS r(unite, valeur)
    WHERE r.valeur > 0;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tr_materiel_apres_creation ON materiel;
CREATE TRIGGER tr_materiel_apres_creation AFTER INSERT ON materiel
    FOR EACH ROW EXECUTE FUNCTION f_materiel_apres_creation();

-- FM1 : reprise des quantités des matériels identifiés.
UPDATE materiel SET mat_quantite = 1 WHERE mat_mode = 'IDENTIFIE' AND mat_quantite <> 1;

COMMENT ON TABLE materiel_etat IS 'Historique de la disponibilité (mat_etat) et de la condition (mat_condition) du matériel : FM3 de l''analyse d''ergonomie';
