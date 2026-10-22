-- =============================================================================
-- Cœur – module Pointage, lot 1 (modules/pointage/db/086) : activation par société, clés étrangères des pointages
-- (salarié, chantier, ordre, type de MO = nature), chantiers internes (frais généraux, atelier, formation, dépôt :
-- le pointage est toujours rattaché à un chantier, M13), vue de liste des pointages. Rejouable.
-- =============================================================================

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_ordre) VALUES
 ('pointage', 'Pointage MO', 'Heures de main-d''œuvre des salariés et intérimaires par chantier, synthèse, validation et variables de paie', 40)
ON CONFLICT (mod_code) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_poi_salarie') THEN
        ALTER TABLE poi_pointage ADD CONSTRAINT fk_poi_salarie FOREIGN KEY (poi_sal_id) REFERENCES salarie (sal_id);
        ALTER TABLE poi_pointage ADD CONSTRAINT fk_poi_chantier FOREIGN KEY (poi_cha_id) REFERENCES chantier (cha_id);
        ALTER TABLE poi_pointage ADD CONSTRAINT fk_poi_ordre FOREIGN KEY (poi_ent_id) REFERENCES document (ent_id) ON DELETE SET NULL;
        ALTER TABLE poi_pointage ADD CONSTRAINT fk_poi_nature FOREIGN KEY (poi_type_mo) REFERENCES nature_element (nat_id);
    END IF;
END $$;

-- Chantiers internes : temps hors chantier (frais généraux, atelier, formation, dépôt) ; jamais clos.
ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_interne BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN chantier.cha_interne IS 'Chantier interne (frais généraux, atelier, formation, dépôt) : pointage hors chantier client';
INSERT INTO chantier (cha_code, cha_libelle, cha_interne, cha_commentaire)
SELECT x.code, x.libelle, TRUE, 'Chantier interne (pointage du temps hors chantier)'
FROM (VALUES ('INT-FG', 'Frais généraux'), ('INT-ATELIER', 'Atelier (entretien, rangement)'), ('INT-FORMATION', 'Formation'), ('INT-DEPOT', 'Dépôt'))
     AS x(code, libelle)
WHERE NOT EXISTS (SELECT 1 FROM chantier c WHERE c.cha_code = x.code);

-- Liste des pointages (couche saisie et couche validée), masquée si le module est désactivé.
CREATE OR REPLACE VIEW v_liste_pointages AS
SELECT p.poi_id AS id, 'pointage'::text AS type_element, p.poi_date AS date_pointage,
       s.sal_nom || ' ' || s.sal_prenom AS salarie, s.sal_matricule AS matricule, s.sal_id AS salarie_id,
       (s.sal_statut = 'INTERIM') AS interimaire, sv.srv_libelle AS service, sv.srv_id AS service_id,
       c.cha_code AS chantier, c.cha_libelle AS chantier_libelle, c.cha_id AS chantier_id, c.cha_interne AS interne,
       d.ent_numero AS ordre, n.nat_libelle AS type_mo, st.pst_libelle AS sous_type, coalesce(st.pst_productif, TRUE) AS productif,
       round(p.poi_minutes / 60.0, 2) AS heures, p.poi_couche AS couche, p.poi_motif AS motif, p.poi_commentaire AS commentaire,
       p.poi_saisi_par AS saisi_par, p.poi_saisi_le AS saisi_le,
       date_trunc('week', p.poi_date)::date AS semaine
FROM poi_pointage p
JOIN salarie s ON s.sal_id = p.poi_sal_id
JOIN chantier c ON c.cha_id = p.poi_cha_id
LEFT JOIN nature_element n ON n.nat_id = p.poi_type_mo
LEFT JOIN poi_sous_type st ON st.pst_code = p.poi_sous_type
LEFT JOIN document d ON d.ent_id = p.poi_ent_id
LEFT JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
LEFT JOIN service sv ON sv.srv_id = sm.sme_srv_id
WHERE f_module_actif('pointage');
