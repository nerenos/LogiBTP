-- =============================================================================
-- Cœur – module Pointage, lot 3 (modules/pointage/db/088) : profil de paie du salarié (par défaut : intérim pour les
-- intérimaires, ETAM pour les services administratifs et d'études, ouvriers sinon), clés étrangères des zones et des
-- saisies, coût réel de la main-d'œuvre par chantier et par nature (pointages retenus valorisés), colonnes de coût de la
-- liste des pointages. Rejouable.
-- =============================================================================

ALTER TABLE salarie ADD COLUMN IF NOT EXISTS sal_ppf_id INT REFERENCES poi_profil_paie (ppf_id);
COMMENT ON COLUMN salarie.sal_ppf_id IS 'Profil de paie (module Pointage) : rubriques et règles des variables de paie';
UPDATE salarie s SET sal_ppf_id = (SELECT ppf_id FROM poi_profil_paie WHERE ppf_code = CASE
        WHEN s.sal_statut = 'INTERIM' THEN 'INTERIM'
        WHEN EXISTS (SELECT 1 FROM service_membre sm JOIN service sv ON sv.srv_id = sm.sme_srv_id
                     WHERE sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal AND sv.srv_nature IN ('ADMINISTRATIF', 'ETUDE')) THEN 'ETAM'
        ELSE 'OUVRIER' END)
WHERE s.sal_ppf_id IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pzc_chantier') THEN
        ALTER TABLE poi_zone_chantier ADD CONSTRAINT fk_pzc_chantier FOREIGN KEY (pzc_cha_id) REFERENCES chantier (cha_id) ON DELETE CASCADE;
        ALTER TABLE poi_valeur ADD CONSTRAINT fk_pva_salarie FOREIGN KEY (pva_sal_id) REFERENCES salarie (sal_id);
    END IF;
END $$;

-- Coût réel de la main-d'œuvre : pointages retenus (couche validée des semaines corrigées, sinon saisie) valorisés.
CREATE OR REPLACE VIEW v_cout_mo_chantier AS
SELECT p.poi_cha_id AS chantier_id, p.poi_type_mo AS nature_id, p.poi_ent_id AS ordre_id,
       sum(p.poi_minutes) AS minutes, sum(p.poi_cout) AS cout, count(*) FILTER (WHERE p.poi_cout IS NULL) AS non_valorises
FROM poi_pointage p
WHERE p.poi_couche = CASE WHEN EXISTS (SELECT 1 FROM poi_semaine s WHERE s.psm_sal_id = p.poi_sal_id AND s.psm_lundi = date_trunc('week', p.poi_date)::date)
                          THEN 'VALIDE' ELSE 'SAISIE' END
GROUP BY p.poi_cha_id, p.poi_type_mo, p.poi_ent_id;

CREATE OR REPLACE VIEW v_liste_pointages AS
SELECT p.poi_id AS id, 'pointage'::text AS type_element, p.poi_date AS date_pointage,
       s.sal_nom || ' ' || s.sal_prenom AS salarie, s.sal_matricule AS matricule, s.sal_id AS salarie_id,
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
