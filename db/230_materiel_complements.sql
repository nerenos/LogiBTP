-- =============================================================================
-- Cœur – fiche matériel et type de chantier (analyse des demandes du 25/10/2026, lot 5a : A5, A6, A20). Rejouable.
--
-- materiel : modèle, immatriculation, dates d'entrée, de sortie, de mise en service et de fin de garantie, énergie
--   (liste ENERGIE, db/227), poids (kg) et dimensions (m) ; location : loueur (personne de l'annuaire), commande de
--   location (document), fin de location ; chantier de suivi des coûts du matériel (mat_cha_id, lot 5c).
-- Type de chantier (f_type_chantier, déduit, jamais saisi) : DOTATION (chantier de dotation d'un salarié), MATERIEL
--   (chantier de suivi d'un matériel), DEPOT (dépôt géré), INTERNE (chantier interne), CHANTIER (travaux) ;
--   colonne type_chantier de v_liste_chantiers.
-- =============================================================================

ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_modele VARCHAR(60);
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_immatriculation VARCHAR(20);
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_date_entree DATE;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_date_sortie DATE;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_date_mise_service DATE;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_fin_garantie DATE;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_energie VARCHAR(30);
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_poids NUMERIC(12,3);
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_largeur NUMERIC(10,3);
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_longueur NUMERIC(10,3);
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_hauteur NUMERIC(10,3);
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_loueur_id BIGINT REFERENCES personne(per_id) ON DELETE SET NULL;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_location_ent_id BIGINT REFERENCES document(ent_id) ON DELETE SET NULL;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_fin_location DATE;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_cha_id INT REFERENCES chantier(cha_id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mat_immatriculation ON materiel (upper(mat_immatriculation)) WHERE mat_immatriculation IS NOT NULL;

-- Date d'entrée reprise de la date d'achat (une fois : seulement là où rien n'est saisi).
UPDATE materiel SET mat_date_entree = mat_date_achat WHERE mat_date_entree IS NULL AND mat_date_achat IS NOT NULL;

-- Énergies (liste de valeurs du cœur, db/227), une seule fois.
INSERT INTO liste_valeur (lva_liste, lva_code, lva_libelle, lva_ordre)
SELECT 'ENERGIE', v.code, v.libelle, v.ordre
FROM (VALUES ('GAZOLE', 'Gazole', 10), ('GNR', 'GNR', 20), ('ESSENCE', 'Essence', 30), ('ELECTRIQUE', 'Électrique', 40),
             ('HYBRIDE', 'Hybride', 50), ('GPL', 'GPL', 60), ('HYDROGENE', 'Hydrogène', 70), ('MANUEL', 'Sans énergie (manuel)', 80))
     AS v(code, libelle, ordre)
WHERE NOT EXISTS (SELECT 1 FROM liste_valeur WHERE lva_liste = 'ENERGIE');

CREATE OR REPLACE FUNCTION f_type_chantier(p_cha_id INT) RETURNS varchar LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM salarie WHERE sal_cha_dotation_id = c.cha_id) THEN 'DOTATION'
        WHEN EXISTS (SELECT 1 FROM materiel WHERE mat_cha_id = c.cha_id) THEN 'MATERIEL'
        WHEN c.cha_depot THEN 'DEPOT'
        WHEN c.cha_interne THEN 'INTERNE'
        ELSE 'CHANTIER' END
    FROM chantier c WHERE c.cha_id = p_cha_id
$$;

-- Chantier de suivi d'un matériel : jamais proposé comme chantier de travaux (comme un chantier de dotation).
CREATE OR REPLACE FUNCTION f_chantier_dotation(p_cha_id INT) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM salarie WHERE sal_cha_dotation_id = p_cha_id)
        OR EXISTS (SELECT 1 FROM materiel WHERE mat_cha_id = p_cha_id)
$$;

CREATE OR REPLACE VIEW v_liste_chantiers AS
SELECT c.cha_id AS id, 'chantier'::text AS type_element, c.cha_code AS code, c.cha_libelle AS libelle,
       a.aff_code AS affaire, p.prj_code AS projet, t.per_raison_sociale AS client, c.cha_ville AS ville, c.cha_statut AS statut,
       c.cha_date_ouverture AS date_ouverture, c.cha_date_fin_prevue AS date_fin_prevue,
       (SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '')::varchar(100) FROM individu i WHERE i.ind_id = c.cha_conducteur_ind_id) AS conducteur,
       (SELECT count(*) FROM marche m WHERE m.mar_cha_id = c.cha_id) AS nb_marches,
       (SELECT coalesce(sum(m.mar_montant_ht), 0) FROM marche m WHERE m.mar_cha_id = c.cha_id) AS montant_marches,
       (SELECT coalesce(sum(f.facture_ht), 0) FROM v_facturation_document f WHERE f.ent_chantier_id = c.cha_id) AS facture_ht,
       f_type_chantier(c.cha_id) AS type_chantier
FROM chantier c
LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
LEFT JOIN projet p ON p.prj_id = c.cha_prj_id
LEFT JOIN personne t ON t.per_id = c.cha_tiers_id;

CREATE OR REPLACE VIEW v_liste_materiels AS
SELECT m.mat_id AS id, m.mat_code AS code, m.mat_designation AS designation,
       coalesce((SELECT l.lva_libelle FROM liste_valeur l WHERE l.lva_liste = 'TYPE_MATERIEL' AND l.lva_code = m.mat_famille), m.mat_famille)::text AS famille,
       m.mat_etat AS etat, m.mat_chantier AS chantier, m.mat_valeur_achat AS valeur_achat, m.mat_date_achat AS date_achat,
       m.mat_heures AS heures_utilisation, m.mat_heures_revision AS heures_revision, m.mat_controle_ok AS controle_ok,
       m.mat_observations AS observations, m.mat_famille AS famille_code, m.mat_usage AS usage,
       m.mat_marque AS marque, m.mat_modele AS modele, m.mat_numero_serie AS numero_serie, m.mat_immatriculation AS immatriculation,
       m.mat_energie AS energie, m.mat_fin_garantie AS fin_garantie, m.mat_fin_location AS fin_location,
       (SELECT p.per_raison_sociale FROM personne p WHERE p.per_id = m.mat_loueur_id) AS loueur
FROM materiel m;

-- Vues de liste par défaut déjà modifiées (121 ne remplace que celles jamais modifiées) : segment Type des chantiers,
-- segment Activité des personnes (db/229), ajoutés s'ils manquent.
UPDATE vue_liste v
   SET vli_definition = jsonb_set(v.vli_definition, '{segments}', '[{"titre": "Type", "colonne": "type_chantier"}]'::jsonb || coalesce(v.vli_definition->'segments', '[]'))
 WHERE v.vli_definition->'source'->>'vue' = 'chantiers' AND v.vli_proprietaire = 'admin'
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v.vli_definition->'segments', '[]')) s WHERE s->>'colonne' = 'type_chantier');
UPDATE vue_liste v
   SET vli_definition = jsonb_set(v.vli_definition, '{segments}', coalesce(v.vli_definition->'segments', '[]') || '[{"titre": "Activité", "colonne": "activites"}]'::jsonb)
 WHERE v.vli_definition->'source'->>'vue' = 'personnes' AND v.vli_proprietaire = 'admin'
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v.vli_definition->'segments', '[]')) s WHERE s->>'colonne' = 'activites');
