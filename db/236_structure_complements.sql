-- =============================================================================
-- Cœur – structure des affaires (analyse des demandes du 25/10/2026, lot 6 : A25, A26). Rejouable.
--
-- projet : priorité et évaluation (listes PRIORITE_PROJET, EVALUATION_PROJET, db/227), estimation (début et fin des
--   travaux, durée en heures ou en jours, adresse, zone de déplacement 0 à 9 comme les zones du Pointage), client en
--   saisie libre (avant sa création dans l'annuaire ; un prospect est un tiers provisoire), responsable et métreur =
--   individus de notre structure (prj_responsable_ind_id, prj_metreur_ind_id ; l'ancien texte prj_responsable est
--   rapproché d'un individu de la structure quand un seul correspond, et gardé en repli dans la liste).
-- chantier : code analytique (repris par l'export comptable, sinon le code du chantier), début prévu, début et fin
--   réels des travaux, chargé d'affaires et chef d'équipe = individus de notre structure ; zones de déplacement : celles
--   du Pointage (poi_zone_chantier, par agence), affichées par la fiche.
-- Vues v_liste_projets et v_liste_chantiers complétées (nouvelles colonnes à la fin).
-- =============================================================================

ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_priorite VARCHAR(30);
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_evaluation VARCHAR(30);
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_debut_prevu DATE;
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_fin_prevue DATE;
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_duree_estimee NUMERIC(10,1);
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_duree_unite CHAR(1) NOT NULL DEFAULT 'H';
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_adresse VARCHAR(200);
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_code_postal VARCHAR(10);
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_zone SMALLINT;
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_client_libre VARCHAR(300);
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_responsable_ind_id BIGINT REFERENCES individu(ind_id) ON DELETE SET NULL;
ALTER TABLE projet ADD COLUMN IF NOT EXISTS prj_metreur_ind_id BIGINT REFERENCES individu(ind_id) ON DELETE SET NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_prj_duree_unite') THEN
        ALTER TABLE projet ADD CONSTRAINT ck_prj_duree_unite CHECK (prj_duree_unite IN ('H', 'J'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_prj_zone') THEN
        ALTER TABLE projet ADD CONSTRAINT ck_prj_zone CHECK (prj_zone BETWEEN 0 AND 9);
    END IF;
END $$;

ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_code_analytique VARCHAR(30);
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_debut_prevu DATE;
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_debut_reel DATE;
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_fin_reelle DATE;
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_charge_ind_id BIGINT REFERENCES individu(ind_id) ON DELETE SET NULL;
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_chef_ind_id BIGINT REFERENCES individu(ind_id) ON DELETE SET NULL;

-- Responsable du projet (texte) rapproché d'un individu de la structure : un seul candidat (prénom et nom, sans casse).
WITH RECURSIVE structure AS (
    SELECT per_id FROM personne WHERE per_societe_base
    UNION SELECT p.per_id FROM personne p JOIN structure s ON p.per_parent_id = s.per_id),
candidats AS (
    SELECT p.prj_id, i.ind_id, count(*) OVER (PARTITION BY p.prj_id) AS nb
    FROM projet p
    JOIN individu i ON lower(trim(p.prj_responsable)) IN (lower(concat_ws(' ', i.ind_prenom, i.ind_nom)), lower(concat_ws(' ', i.ind_nom, i.ind_prenom)))
    WHERE p.prj_responsable_ind_id IS NULL AND nullif(trim(p.prj_responsable), '') IS NOT NULL
      AND EXISTS (SELECT 1 FROM rattachement r JOIN structure s ON s.per_id = r.rat_per_id WHERE r.rat_ind_id = i.ind_id))
UPDATE projet p SET prj_responsable_ind_id = x.ind_id FROM candidats x WHERE x.prj_id = p.prj_id AND x.nb = 1;

CREATE OR REPLACE VIEW v_liste_projets AS
SELECT p.prj_id AS id, 'projet'::text AS type_element, p.prj_code AS code, p.prj_libelle AS libelle,
       coalesce(t.per_raison_sociale, p.prj_client_libre::varchar(150)) AS client, p.prj_statut AS statut, p.prj_date_remise AS date_remise, p.prj_date_decision AS date_decision,
       p.prj_montant_estime AS montant_estime, p.prj_ville AS ville,
       coalesce((SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '')::varchar(100) FROM individu i WHERE i.ind_id = p.prj_responsable_ind_id), p.prj_responsable) AS responsable,
       (SELECT string_agg(c.cha_code, ', ' ORDER BY c.cha_code) FROM chantier c WHERE c.cha_prj_id = p.prj_id) AS chantier,
       (SELECT count(*) FROM document d WHERE d.ent_projet_id = p.prj_id) AS nb_documents,
       (SELECT l.lva_libelle FROM liste_valeur l WHERE l.lva_liste = 'PRIORITE_PROJET' AND l.lva_code = p.prj_priorite)::text AS priorite,
       (SELECT l.lva_libelle FROM liste_valeur l WHERE l.lva_liste = 'EVALUATION_PROJET' AND l.lva_code = p.prj_evaluation)::text AS evaluation,
       (SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '')::text FROM individu i WHERE i.ind_id = p.prj_metreur_ind_id) AS metreur,
       p.prj_debut_prevu AS debut_prevu, p.prj_fin_prevue AS fin_prevue,
       CASE WHEN p.prj_duree_estimee IS NULL THEN NULL ELSE p.prj_duree_estimee::text || CASE p.prj_duree_unite WHEN 'J' THEN ' j' ELSE ' h' END END AS duree_estimee,
       p.prj_zone AS zone, (t.per_provisoire IS TRUE) AS prospect
FROM projet p LEFT JOIN personne t ON t.per_id = p.prj_tiers_id;

CREATE OR REPLACE VIEW v_liste_chantiers AS
SELECT c.cha_id AS id, 'chantier'::text AS type_element, c.cha_code AS code, c.cha_libelle AS libelle,
       a.aff_code AS affaire, p.prj_code AS projet, t.per_raison_sociale AS client, c.cha_ville AS ville, c.cha_statut AS statut,
       c.cha_date_ouverture AS date_ouverture, c.cha_date_fin_prevue AS date_fin_prevue,
       (SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '')::varchar(100) FROM individu i WHERE i.ind_id = c.cha_conducteur_ind_id) AS conducteur,
       (SELECT count(*) FROM marche m WHERE m.mar_cha_id = c.cha_id) AS nb_marches,
       (SELECT coalesce(sum(m.mar_montant_ht), 0) FROM marche m WHERE m.mar_cha_id = c.cha_id) AS montant_marches,
       (SELECT coalesce(sum(f.facture_ht), 0) FROM v_facturation_document f WHERE f.ent_chantier_id = c.cha_id) AS facture_ht,
       f_type_chantier(c.cha_id) AS type_chantier,
       c.cha_code_analytique AS code_analytique, c.cha_debut_prevu AS debut_prevu, c.cha_debut_reel AS debut_reel, c.cha_fin_reelle AS fin_reelle,
       (SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '')::text FROM individu i WHERE i.ind_id = c.cha_charge_ind_id) AS charge_affaires,
       (SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '')::text FROM individu i WHERE i.ind_id = c.cha_chef_ind_id) AS chef_equipe
FROM chantier c
LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
LEFT JOIN projet p ON p.prj_id = c.cha_prj_id
LEFT JOIN personne t ON t.per_id = c.cha_tiers_id;
