-- =============================================================================
-- Cœur – ordre d'entretien du matériel (analyse des demandes du 25/10/2026, lot 5c-3 : A8, décision M5 ;
-- ANALYSE-DEMANDES-2026-10.md § 6). Rejouable.
--
-- Type E_ENT (famille E du module Exécution) : statuts, droits, états (intervention, contrôle), service par défaut
--   ATELIER ; transformations vers la demande d'approvisionnement (pièces du stock), la demande de prix et la
--   commande fournisseur (réparation extérieure).
-- document.ent_mat_id (matériel entretenu), ent_ent_nature (PREVENTIF, CURATIF, REGLEMENTAIRE), ent_mpl_id (plan d'entretien
--   d'origine, lot 5c-4) : colonnes du cœur
--   lues et écrites en SQL (Btp/EntretiensMateriel.cs), hors entité ; relevé du compteur à l'intervention =
--   materiel_releve de source ORDRE (db/233).
-- Clôture : un ordre d'entretien passé à l'état TERMINE inscrit un événement ENTRETIEN dans l'historique du matériel
--   (retiré si l'ordre quitte cet état) ; f_chantier_entretien_ouvert : un chantier de suivi qui porte un ordre
--   d'entretien en cours est proposé au pointage (main-d'œuvre d'atelier, M3).
-- =============================================================================

INSERT INTO type_document (tyd_code, tyd_libelle, tyd_famille, tyd_sens, tyd_prefixe_numero, tyd_numerotation_continue, tyd_mouvemente_stock, tyd_handler)
SELECT 'E_ENT', 'Ordre d''entretien du matériel', 'E', 4, 'ENT', FALSE, FALSE, NULL
WHERE NOT EXISTS (SELECT 1 FROM type_document WHERE tyd_code = 'E_ENT');

INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.code, s.libelle, s.modifiable, s.terminal, s.ordre
FROM type_document t
CROSS JOIN (VALUES
    ('BROUILLON', 'Brouillon', TRUE, FALSE, 1), ('APPROUVE', 'Approuvé', FALSE, FALSE, 2), ('ENVOYE', 'Transmis', FALSE, FALSE, 3),
    ('VALIDE', 'Pris en charge', FALSE, FALSE, 4), ('SOLDE', 'Soldé', FALSE, FALSE, 6), ('ANNULE', 'Annulé', FALSE, TRUE, 11),
    ('REMPLACE', 'Remplacé', FALSE, TRUE, 12)
) AS s(code, libelle, modifiable, terminal, ordre)
WHERE t.tyd_code = 'E_ENT'
ON CONFLICT (std_tyd_id, std_code) DO NOTHING;

INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT 'ADMIN', t.tyd_id, a.action FROM type_document t
CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('VALIDER'), ('TRANSFORMER'), ('SUPPRIMER'), ('APPROUVER'), ('DEVALIDER'), ('FORCER')) AS a(action)
WHERE t.tyd_code = 'E_ENT'
ON CONFLICT DO NOTHING;
INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT 'SAISIE', t.tyd_id, a.action FROM type_document t CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('TRANSFORMER')) AS a(action)
WHERE t.tyd_code = 'E_ENT'
ON CONFLICT DO NOTHING;

-- Droits du module Droits (db/221) : nœud documents/E/E_ENT pour les profils qui ont déjà un droit sur un type d'ordre.
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT d.dpr_pro_id, 'documents/E/E_ENT', d.dpr_actions
FROM droit_profil d
WHERE d.dpr_noeud = 'documents/E/E_SAV'
  AND NOT EXISTS (SELECT 1 FROM droit_profil x WHERE x.dpr_pro_id = d.dpr_pro_id AND x.dpr_noeud = 'documents/E/E_ENT');

INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape, tra_vaut_etapes)
SELECT s.tyd_id, c.tyd_id, x.etape, NULL
FROM (VALUES ('E_ENT', 'E_DAP', 'APPRO'), ('E_ENT', 'A_DEVIS', 'CONSULTATION'), ('E_ENT', 'A_COMMANDE', 'COMMANDE')) AS x(source, cible, etape)
JOIN type_document s ON s.tyd_code = x.source
JOIN type_document c ON c.tyd_code = x.cible
WHERE NOT EXISTS (SELECT 1 FROM transformation_autorisee a WHERE a.tra_source_tyd_id = s.tyd_id AND a.tra_cible_tyd_id = c.tyd_id);

UPDATE type_document t SET tyd_srv_id = s.srv_id FROM service s
WHERE t.tyd_code = 'E_ENT' AND t.tyd_srv_id IS NULL AND s.srv_code = 'ATELIER';

INSERT INTO exe_etat_type (ett_type_ordre, ett_etc_code, ett_ordre, ett_date_obligatoire, ett_controle, ett_controle_bloquant, ett_statut_document)
SELECT x.type, x.code, x.ordre, x.obligatoire, x.controle, x.bloquant, NULL
FROM (VALUES ('E_ENT', 'INTERVENTION', 1, TRUE, FALSE, TRUE), ('E_ENT', 'CONTROLE', 2, FALSE, TRUE, FALSE)) AS x(type, code, ordre, obligatoire, controle, bloquant)
WHERE EXISTS (SELECT 1 FROM exe_etat_catalogue c WHERE c.etc_code = x.code)
  AND NOT EXISTS (SELECT 1 FROM exe_etat_type t WHERE t.ett_type_ordre = x.type);

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_mat_id INT REFERENCES materiel(mat_id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_ent_nature VARCHAR(15);
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_mpl_id INT;  -- plan d'entretien à l'origine de l'ordre (clé étrangère : lot 5c-4)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ent_ent_nature') THEN
        ALTER TABLE document ADD CONSTRAINT ck_ent_ent_nature CHECK (ent_ent_nature IN ('PREVENTIF', 'CURATIF', 'REGLEMENTAIRE'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_ent_materiel ON document (ent_mat_id) WHERE ent_mat_id IS NOT NULL;
COMMENT ON COLUMN document.ent_mat_id IS 'Matériel entretenu par un ordre d''entretien E_ENT (lot 5c-3)';

-- Chantier de suivi qui porte un ordre d'entretien en cours (proposé au pointage).
CREATE OR REPLACE FUNCTION f_chantier_entretien_ouvert(p_cha_id INT) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id AND t.tyd_code = 'E_ENT'
                   JOIN statut_document s ON s.std_id = d.ent_std_id
                   WHERE d.ent_chantier_id = p_cha_id AND d.ent_is_reference AND coalesce(d.ent_exe_etat, 'A_FAIRE') <> 'TERMINE'
                     AND s.std_code NOT IN ('ANNULE', 'REMPLACE'))
$$;

-- Clôture : événement ENTRETIEN de l'historique (date du relevé de l'ordre, sinon du jour).
CREATE OR REPLACE FUNCTION f_entretien_cloture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.ent_mat_id IS NULL OR NOT EXISTS (SELECT 1 FROM type_document t WHERE t.tyd_id = NEW.ent_tyd_id AND t.tyd_code = 'E_ENT') THEN
        RETURN NULL;
    END IF;
    IF NEW.ent_exe_etat = 'TERMINE' AND OLD.ent_exe_etat IS DISTINCT FROM 'TERMINE'
       AND NOT EXISTS (SELECT 1 FROM materiel_evenement e WHERE e.mev_ent_id = NEW.ent_id AND e.mev_type = 'ENTRETIEN') THEN
        INSERT INTO materiel_evenement (mev_mat_id, mev_type, mev_date, mev_libelle, mev_description, mev_ent_id, mev_maj_par)
        VALUES (NEW.ent_mat_id, 'ENTRETIEN',
                coalesce((SELECT max(r.mre_date) FROM materiel_releve r WHERE r.mre_ent_id = NEW.ent_id), current_date),
                left(coalesce(nullif(NEW.ent_objet, ''), 'Entretien ' || coalesce(NEW.ent_numero, '')), 150),
                CASE NEW.ent_ent_nature WHEN 'PREVENTIF' THEN 'Entretien préventif' WHEN 'CURATIF' THEN 'Entretien curatif (réparation)'
                                        WHEN 'REGLEMENTAIRE' THEN 'Entretien réglementaire' END,
                NEW.ent_id, 'ordre');
    ELSIF OLD.ent_exe_etat = 'TERMINE' AND NEW.ent_exe_etat IS DISTINCT FROM 'TERMINE' THEN
        DELETE FROM materiel_evenement WHERE mev_ent_id = NEW.ent_id AND mev_type = 'ENTRETIEN' AND mev_maj_par = 'ordre';
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tr_entretien_cloture ON document;
CREATE TRIGGER tr_entretien_cloture AFTER UPDATE OF ent_exe_etat ON document FOR EACH ROW EXECUTE FUNCTION f_entretien_cloture();
