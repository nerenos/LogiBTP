-- =============================================================================
-- Cœur – responsable (chargé d'affaires) d'une affaire = individu de notre structure (lot 0 du module Rentabilité, R12
-- de ANALYSE-MODULE-ANALYSE.md). Rejouable.
--
-- aff_responsable_ind_id remplace le texte aff_responsable, comme prj_responsable_ind_id pour les projets (db/236) :
-- l'ancien texte est rapproché d'un individu de la structure quand un seul correspond (prénom et nom, sans casse), sinon
-- il reste en repli dans la liste et la fiche (« ancienne saisie », lecture seule) ; v_responsables_a_reprendre liste
-- les affaires et projets dont le responsable reste à choisir. Le chargé d'affaires est l'axe d'origine du module
-- Rentabilité (affaires, puis chantiers par cha_charge_ind_id).
-- =============================================================================

ALTER TABLE affaire ADD COLUMN IF NOT EXISTS aff_responsable_ind_id BIGINT REFERENCES individu(ind_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_aff_responsable_ind ON affaire (aff_responsable_ind_id);
CREATE INDEX IF NOT EXISTS ix_cha_charge_ind ON chantier (cha_charge_ind_id);

WITH RECURSIVE structure AS (
    SELECT per_id FROM personne WHERE per_societe_base
    UNION SELECT p.per_id FROM personne p JOIN structure s ON p.per_parent_id = s.per_id),
candidats AS (
    SELECT a.aff_id, i.ind_id, count(*) OVER (PARTITION BY a.aff_id) AS nb
    FROM affaire a
    JOIN individu i ON lower(trim(a.aff_responsable)) IN (lower(concat_ws(' ', i.ind_prenom, i.ind_nom)), lower(concat_ws(' ', i.ind_nom, i.ind_prenom)))
    WHERE a.aff_responsable_ind_id IS NULL AND nullif(trim(a.aff_responsable), '') IS NOT NULL
      AND EXISTS (SELECT 1 FROM rattachement r JOIN structure s ON s.per_id = r.rat_per_id WHERE r.rat_ind_id = i.ind_id))
UPDATE affaire a SET aff_responsable_ind_id = x.ind_id FROM candidats x WHERE x.aff_id = a.aff_id AND x.nb = 1;

-- Responsables saisis en texte, pas encore rapprochés d'un individu (à choisir dans la fiche).
CREATE OR REPLACE VIEW v_responsables_a_reprendre AS
SELECT 'affaire'::text AS type_element, a.aff_id::bigint AS id, a.aff_code AS code, a.aff_libelle AS libelle, a.aff_responsable AS texte
FROM affaire a WHERE a.aff_responsable_ind_id IS NULL AND nullif(trim(a.aff_responsable), '') IS NOT NULL
UNION ALL
SELECT 'projet', p.prj_id::bigint, p.prj_code, p.prj_libelle, p.prj_responsable
FROM projet p WHERE p.prj_responsable_ind_id IS NULL AND nullif(trim(p.prj_responsable), '') IS NOT NULL;

COMMENT ON VIEW v_responsables_a_reprendre IS 'Affaires et projets dont le responsable saisi en texte n''est rapproché d''aucun individu';

CREATE OR REPLACE VIEW v_liste_affaires AS
SELECT a.aff_id AS id, 'affaire'::text AS type_element, a.aff_code AS code, a.aff_libelle AS libelle,
       CASE a.aff_nature WHEN 'G' THEN 'Gestion' ELSE 'Chantiers' END AS nature, t.per_raison_sociale AS client, a.aff_statut AS statut,
       a.aff_date_ouverture AS date_ouverture,
       coalesce((SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '')::varchar(100) FROM individu i WHERE i.ind_id = a.aff_responsable_ind_id), a.aff_responsable) AS responsable,
       (SELECT count(*) FROM chantier c WHERE c.cha_aff_id = a.aff_id) AS nb_chantiers,
       (SELECT coalesce(sum(m.mar_montant_ht), 0) FROM marche m JOIN chantier c ON c.cha_id = m.mar_cha_id WHERE c.cha_aff_id = a.aff_id) AS montant_marches,
       (SELECT coalesce(sum(f.facture_ht), 0) FROM v_facturation_document f
         WHERE f.ent_affaire_id = a.aff_id OR f.ent_chantier_id IN (SELECT c.cha_id FROM chantier c WHERE c.cha_aff_id = a.aff_id)) AS facture_ht,
       a.aff_responsable_ind_id AS responsable_ind_id
FROM affaire a LEFT JOIN personne t ON t.per_id = a.aff_tiers_id;

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT * FROM v_responsables_a_reprendre WHERE type_element = 'affaire' ORDER BY code LOOP
        RAISE NOTICE 'Affaire % : responsable « % » sans individu correspondant, à choisir dans la fiche', r.code, r.texte;
    END LOOP;
END $$;
