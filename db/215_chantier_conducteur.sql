-- Cœur LogiBTP – conducteur de travaux du chantier = individu de notre structure (annuaire : rattaché à notre société
-- ou à l'un de ses niveaux inférieurs, agences comprises), au lieu d'un texte libre. Bases existantes : colonne
-- ajoutée, texte rapproché d'un individu de la structure (prénom et nom, sans casse ; un seul candidat, les conducteurs
-- de travaux d'abord), vue de la liste des chantiers relue, ancienne colonne supprimée. Rejouable.

ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_conducteur_ind_id BIGINT REFERENCES individu(ind_id) ON DELETE SET NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chantier' AND column_name = 'cha_conducteur') THEN
        WITH RECURSIVE structure AS (
            SELECT per_id FROM personne WHERE per_societe_base
            UNION SELECT p.per_id FROM personne p JOIN structure s ON p.per_parent_id = s.per_id),
        candidats AS (
            SELECT c.cha_id, i.ind_id,
                   row_number() OVER (PARTITION BY c.cha_id ORDER BY (i.ind_roles ? 'CONDUCTEUR') DESC, i.ind_id) AS rang,
                   count(*) OVER (PARTITION BY c.cha_id, (i.ind_roles ? 'CONDUCTEUR')) AS nb
            FROM chantier c
            JOIN individu i ON lower(trim(c.cha_conducteur)) IN (lower(concat_ws(' ', i.ind_prenom, i.ind_nom)), lower(concat_ws(' ', i.ind_nom, i.ind_prenom)))
            WHERE c.cha_conducteur_ind_id IS NULL AND nullif(trim(c.cha_conducteur), '') IS NOT NULL
              AND EXISTS (SELECT 1 FROM rattachement r JOIN structure s ON s.per_id = r.rat_per_id WHERE r.rat_ind_id = i.ind_id))
        UPDATE chantier c SET cha_conducteur_ind_id = x.ind_id FROM candidats x WHERE x.cha_id = c.cha_id AND x.rang = 1 AND x.nb = 1;
        -- Texte non rapproché : gardé dans le commentaire du chantier.
        UPDATE chantier SET cha_commentaire = concat_ws(E'\n', cha_commentaire, 'Conducteur (ancienne saisie) : ' || cha_conducteur)
        WHERE cha_conducteur_ind_id IS NULL AND nullif(trim(cha_conducteur), '') IS NOT NULL;
    END IF;
END $$;

CREATE OR REPLACE VIEW v_liste_chantiers AS
SELECT c.cha_id AS id, 'chantier'::text AS type_element, c.cha_code AS code, c.cha_libelle AS libelle,
       a.aff_code AS affaire, p.prj_code AS projet, t.per_raison_sociale AS client, c.cha_ville AS ville, c.cha_statut AS statut,
       c.cha_date_ouverture AS date_ouverture, c.cha_date_fin_prevue AS date_fin_prevue,
       (SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '')::varchar(100) FROM individu i WHERE i.ind_id = c.cha_conducteur_ind_id) AS conducteur,
       (SELECT count(*) FROM marche m WHERE m.mar_cha_id = c.cha_id) AS nb_marches,
       (SELECT coalesce(sum(m.mar_montant_ht), 0) FROM marche m WHERE m.mar_cha_id = c.cha_id) AS montant_marches,
       (SELECT coalesce(sum(f.facture_ht), 0) FROM v_facturation_document f WHERE f.ent_chantier_id = c.cha_id) AS facture_ht
FROM chantier c
LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
LEFT JOIN projet p ON p.prj_id = c.cha_prj_id
LEFT JOIN personne t ON t.per_id = c.cha_tiers_id;

ALTER TABLE chantier DROP COLUMN IF EXISTS cha_conducteur;
