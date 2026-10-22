-- =============================================================================
-- Cœur – module Exécution, lot 2 (modules/execution/db/085) : services de démonstration des parcours (méthodes,
-- fabrication bois et métal sous l'atelier, logistique, pose sous le chantier) et modèles de parcours fournis
-- (menuiserie, pose seule, gros œuvre, dépannage), services désignés par leur code. Une fois. Rejouable.
-- =============================================================================

INSERT INTO service (srv_code, srv_libelle, srv_nature, srv_ordre) VALUES
 ('BM', 'Bureau des méthodes', 'ETUDE', 55),
 ('LOGISTIQUE', 'Logistique (colisage, livraison)', 'LOGISTIQUE', 65)
ON CONFLICT (srv_code) DO NOTHING;
INSERT INTO service (srv_code, srv_libelle, srv_nature, srv_ordre, srv_parent_id)
SELECT x.code, x.libelle, 'PRODUCTION', x.ordre, (SELECT srv_id FROM service WHERE srv_code = x.parent)
FROM (VALUES ('FAB_BOIS', 'Fabrication bois', 61, 'ATELIER'), ('FAB_METAL', 'Fabrication métal', 62, 'ATELIER'), ('POSE', 'Pose', 71, 'CHANTIER'))
     AS x(code, libelle, ordre, parent)
ON CONFLICT (srv_code) DO NOTHING;
UPDATE service s SET srv_cal_id = c.cal_id FROM calendrier c
WHERE s.srv_cal_id IS NULL AND s.srv_code IN ('BM', 'LOGISTIQUE', 'FAB_BOIS', 'FAB_METAL', 'POSE')
  AND c.cal_code = CASE WHEN s.srv_code = 'BM' THEN 'BUREAU' ELSE 'STANDARD' END;

INSERT INTO exe_parcours_modele (pam_code, pam_libelle, pam_description, pam_ordre) VALUES
 ('MENUISERIE', 'Menuiserie (études, fabrication, livraison, pose)', 'Ordre d''exécution, bureau d''études, méthodes, fabrications bois et métal en parallèle, colisage, livraison, pose', 10),
 ('POSE', 'Pose seule', 'Ordre d''exécution puis pose sur chantier', 20),
 ('GROS_OEUVRE', 'Gros œuvre', 'Ordre d''exécution, plans d''exécution du bureau d''études, travaux', 30),
 ('DEPANNAGE', 'Dépannage (SAV)', 'Intervention de dépannage ou d''entretien', 40)
ON CONFLICT (pam_code) DO NOTHING;

INSERT INTO exe_parcours_etape (pae_pam_id, pae_code, pae_libelle, pae_srv_id, pae_type_ordre, pae_amonts, pae_ordre)
SELECT m.pam_id, e.code, e.libelle, (SELECT srv_id FROM service WHERE srv_code = e.service), e.type, e.amonts::text[], e.ordre
FROM exe_parcours_modele m
JOIN (VALUES
    ('MENUISERIE', 'OE', 'Ordre d''exécution', 'CHANTIER', 'E_OE', '{}', 1),
    ('MENUISERIE', 'BE', 'Bureau d''études', 'BE', 'E_BE', '{OE}', 2),
    ('MENUISERIE', 'BM', 'Méthodes', 'BM', 'E_BM', '{BE}', 3),
    ('MENUISERIE', 'OF_BOIS', 'Fabrication bois', 'FAB_BOIS', 'E_OF', '{BM}', 4),
    ('MENUISERIE', 'OF_METAL', 'Fabrication métal', 'FAB_METAL', 'E_OF', '{BM}', 5),
    ('MENUISERIE', 'CO', 'Colisage', 'LOGISTIQUE', 'E_CO', '{OF_BOIS,OF_METAL}', 6),
    ('MENUISERIE', 'LI', 'Livraison', 'LOGISTIQUE', 'E_LI', '{CO}', 7),
    ('MENUISERIE', 'PO', 'Pose', 'POSE', 'E_PO', '{LI}', 8),
    ('POSE', 'OE', 'Ordre d''exécution', 'CHANTIER', 'E_OE', '{}', 1),
    ('POSE', 'PO', 'Pose', 'POSE', 'E_PO', '{OE}', 2),
    ('GROS_OEUVRE', 'OE', 'Ordre d''exécution', 'CHANTIER', 'E_OE', '{}', 1),
    ('GROS_OEUVRE', 'BE', 'Plans d''exécution', 'BE', 'E_BE', '{OE}', 2),
    ('GROS_OEUVRE', 'TRAVAUX', 'Travaux', 'POSE', 'E_PO', '{BE}', 3),
    ('DEPANNAGE', 'SAV', 'Intervention', 'POSE', 'E_SAV', '{}', 1)
) AS e(modele, code, libelle, service, type, amonts, ordre) ON e.modele = m.pam_code
WHERE NOT EXISTS (SELECT 1 FROM exe_parcours_etape x WHERE x.pae_pam_id = m.pam_id);
