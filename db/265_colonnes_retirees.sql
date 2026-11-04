-- =============================================================================
-- Cœur – colonnes retirées (TODO, interface : salariés et projet du lot 6). Rejouable.
--
-- salarie.sal_matricule : recopie du code depuis db/251, n'est plus lu ; la colonne « matricule » des vues de liste
-- (vues enregistrées, exports) est gardée et lit le code (sal_code, 10 caractères).
-- projet.prj_responsable : ancien texte du responsable, remplacé par prj_responsable_ind_id (db/236) ; un texte qui
-- n'a été rapproché d'aucun individu est gardé à la fin du commentaire du projet (« Responsable (ancienne saisie) »).
-- Les vues qui les lisaient sont redéfinies d'abord (dernières définitions : 228, 200, 236, 256), puis les colonnes retirées.
-- =============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'projet' AND column_name = 'prj_responsable') THEN
        EXECUTE $q$UPDATE projet SET prj_commentaire = concat_ws(E'
', nullif(prj_commentaire, ''), 'Responsable (ancienne saisie) : ' || trim(prj_responsable))
                   WHERE prj_responsable_ind_id IS NULL AND nullif(trim(prj_responsable), '') IS NOT NULL$q$;
    END IF;
END $$;

-- Champ « Responsable (ancienne saisie) » retiré de la définition de la fiche projet (une base qui ne rejoue pas 131).
UPDATE type_fiche
   SET tyf_definition = jsonb_set(jsonb_set(tyf_definition,
           '{champs}', (SELECT coalesce(jsonb_agg(c ORDER BY o), '[]'::jsonb) FROM jsonb_array_elements(tyf_definition->'champs') WITH ORDINALITY AS t(c, o) WHERE c->>'colonne' IS DISTINCT FROM 'prj_responsable')),
           '{sections}', (SELECT jsonb_agg(jsonb_set(s, '{groupes}', (SELECT jsonb_agg(jsonb_set(g, '{champs}', (g->'champs') - 'responsable') ORDER BY og)
                                                                        FROM jsonb_array_elements(s->'groupes') WITH ORDINALITY AS u(g, og))) ORDER BY os)
                          FROM jsonb_array_elements(tyf_definition->'sections') WITH ORDINALITY AS v(s, os)))
 WHERE tyf_code = 'projet'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(tyf_definition->'champs') c WHERE c->>'colonne' = 'prj_responsable');

CREATE OR REPLACE VIEW v_liste_salaries AS
SELECT s.sal_id AS id, CASE WHEN s.sal_statut = 'INTERIM' THEN 'interim' ELSE 'salarie' END AS type_element, s.sal_code::varchar(10) AS matricule,
       s.sal_nom AS nom, s.sal_prenom AS prenom,
       coalesce((SELECT sv.srv_libelle FROM service sv WHERE sv.srv_code = s.sal_service), s.sal_service)::text AS service, s.sal_poste AS poste,
       s.sal_statut AS statut, s.sal_date_entree AS date_entree, s.sal_salaire AS salaire_brut, s.sal_heures_mois AS heures_mois,
       s.sal_actif AS actif, s.sal_commentaire AS commentaire, s.sal_code AS code, s.sal_matricule_paie AS matricule_paie,
       s.sal_service AS service_code, s.sal_usage AS usage
FROM salarie s;

CREATE OR REPLACE VIEW v_liste_pointages AS
SELECT p.poi_id AS id, 'pointage'::text AS type_element, p.poi_date AS date_pointage,
       s.sal_nom || ' ' || s.sal_prenom AS salarie, s.sal_code::varchar(10) AS matricule, s.sal_id AS salarie_id,
       (s.sal_statut = 'INTERIM') AS interimaire, sv.srv_libelle AS service, sv.srv_id AS service_id,
       c.cha_code AS chantier, c.cha_libelle AS chantier_libelle, c.cha_id AS chantier_id, c.cha_interne AS interne,
       d.ent_numero AS ordre, n.nat_libelle AS type_mo, st.pst_libelle AS sous_type, coalesce(st.pst_productif, TRUE) AS productif,
       round(p.poi_minutes / 60.0, 2) AS heures, p.poi_couche AS couche, p.poi_motif AS motif, p.poi_commentaire AS commentaire,
       p.poi_saisi_par AS saisi_par, p.poi_saisi_le AS saisi_le,
       date_trunc('week', p.poi_date)::date AS semaine,
       p.poi_taux AS taux, p.poi_cout AS cout, p.poi_valorisation AS valorisation
FROM poi_pointage p
JOIN salarie s ON s.sal_id = p.poi_sal_id
JOIN chantier c ON c.cha_id = p.poi_cha_id
LEFT JOIN nature_element n ON n.nat_id = p.poi_type_mo
LEFT JOIN poi_sous_type st ON st.pst_code = p.poi_sous_type
LEFT JOIN document d ON d.ent_id = p.poi_ent_id
LEFT JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
LEFT JOIN service sv ON sv.srv_id = sm.sme_srv_id
WHERE f_module_actif('pointage');

CREATE OR REPLACE VIEW v_liste_projets AS
SELECT p.prj_id AS id, 'projet'::text AS type_element, p.prj_code AS code, p.prj_libelle AS libelle,
       coalesce(t.per_raison_sociale, p.prj_client_libre::varchar(150)) AS client, p.prj_statut AS statut, p.prj_date_remise AS date_remise, p.prj_date_decision AS date_decision,
       p.prj_montant_estime AS montant_estime, p.prj_ville AS ville,
       (SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '')::varchar(100) FROM individu i WHERE i.ind_id = p.prj_responsable_ind_id) AS responsable,
       (SELECT string_agg(c.cha_code, ', ' ORDER BY c.cha_code) FROM chantier c WHERE c.cha_prj_id = p.prj_id) AS chantier,
       (SELECT count(*) FROM document d WHERE d.ent_projet_id = p.prj_id) AS nb_documents,
       (SELECT l.lva_libelle FROM liste_valeur l WHERE l.lva_liste = 'PRIORITE_PROJET' AND l.lva_code = p.prj_priorite)::text AS priorite,
       (SELECT l.lva_libelle FROM liste_valeur l WHERE l.lva_liste = 'EVALUATION_PROJET' AND l.lva_code = p.prj_evaluation)::text AS evaluation,
       (SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '')::text FROM individu i WHERE i.ind_id = p.prj_metreur_ind_id) AS metreur,
       p.prj_debut_prevu AS debut_prevu, p.prj_fin_prevue AS fin_prevue,
       CASE WHEN p.prj_duree_estimee IS NULL THEN NULL ELSE p.prj_duree_estimee::text || CASE p.prj_duree_unite WHEN 'J' THEN ' j' ELSE ' h' END END AS duree_estimee,
       p.prj_zone AS zone, (t.per_provisoire IS TRUE) AS prospect
FROM projet p LEFT JOIN personne t ON t.per_id = p.prj_tiers_id;

-- Responsables à reprendre : les affaires seules (même définition que db/256).
CREATE OR REPLACE VIEW v_responsables_a_reprendre AS
SELECT 'affaire'::text AS type_element, a.aff_id::bigint AS id, a.aff_code AS code, a.aff_libelle AS libelle, a.aff_responsable AS texte
FROM affaire a WHERE a.aff_responsable_ind_id IS NULL AND nullif(trim(a.aff_responsable), '') IS NOT NULL;

-- Nom court de l'agence recopié à chaque écriture, sans le matricule (même définition que db/251).
CREATE OR REPLACE FUNCTION f_salarie_agence_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.sal_agence_per_id IS NULL THEN
        NEW.sal_agence := NULL;
    ELSE
        NEW.sal_agence := (SELECT left(coalesce(nullif(trim(per_nom_commercial), ''), per_raison_sociale), 30)
                           FROM personne WHERE per_id = NEW.sal_agence_per_id);
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_salarie_agence_code ON salarie;
CREATE TRIGGER tr_salarie_agence_code BEFORE INSERT OR UPDATE OF sal_agence_per_id, sal_agence ON salarie
    FOR EACH ROW EXECUTE FUNCTION f_salarie_agence_code();

ALTER TABLE projet DROP COLUMN IF EXISTS prj_responsable;
ALTER TABLE salarie DROP COLUMN IF EXISTS sal_matricule;
