-- =============================================================================
-- Cœur – module Exécution, lot 2c (modules/execution/db/085b ; ANALYSE-MODULE-EXECUTION.md § 13) : ressource principale
-- d'un ordre (`ent_ressource` : { type, id, libelle }, E32) ; catalogue des états et états des types d'ordres de
-- démonstration (E49, une fois) ; liste des ordres : étape en cours, prochaine date obligatoire, ressource, retard sur
-- une étape (E44). Rejouable.
-- =============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_ressource JSONB;

-- Catalogue de démonstration (une fois : rien n'est réécrit s'il existe déjà des états).
INSERT INTO exe_etat_catalogue (etc_code, etc_libelle, etc_couleur, etc_nature, etc_duree, etc_unite, etc_srv_id, etc_ordre)
SELECT x.code, x.libelle, x.couleur, x.nature, x.duree, x.unite, (SELECT srv_id FROM service WHERE srv_code = x.service), x.ordre
FROM (VALUES
    ('LANCEMENT', 'Lancement', '#2563eb', 'TACHE', 1, 'OUV', NULL, 10),
    ('PREPARATION', 'Préparation', '#64748b', 'TACHE', 2, 'OUV', NULL, 20),
    ('ETUDE', 'Étude', '#7c3aed', 'TACHE', 5, 'OUV', 'BE', 30),
    ('VISA', 'Visa (architecte, client)', '#f59e0b', 'ATTENTE', 5, 'OUV', NULL, 40),
    ('PLANS_BPE', 'Plans bons pour exécution', '#16a34a', 'JALON', 0, 'OUV', 'BE', 50),
    ('GAMME', 'Gamme de fabrication', '#0891b2', 'TACHE', 2, 'OUV', 'BM', 60),
    ('DEBIT', 'Débit', '#a16207', 'TACHE', 8, 'H', NULL, 70),
    ('FABRICATION', 'Fabrication', '#b45309', 'TACHE', 24, 'H', NULL, 80),
    ('SECHAGE', 'Séchage', '#f59e0b', 'ATTENTE', 3, 'CAL', NULL, 90),
    ('CONTROLE', 'Contrôle qualité', '#dc2626', 'TACHE', 2, 'H', NULL, 100),
    ('COLISAGE', 'Préparation des colis', '#0d9488', 'TACHE', 4, 'H', 'LOGISTIQUE', 110),
    ('CHARGEMENT', 'Chargement', '#0d9488', 'TACHE', 2, 'H', 'LOGISTIQUE', 120),
    ('LIVRAISON', 'Livraison', '#0f766e', 'TACHE', 1, 'OUV', 'LOGISTIQUE', 130),
    ('POSE', 'Pose', '#ea580c', 'TACHE', 3, 'OUV', 'POSE', 140),
    ('RECEPTION', 'Réception', '#16a34a', 'JALON', 0, 'OUV', NULL, 150),
    ('INTERVENTION', 'Intervention', '#ea580c', 'TACHE', 4, 'H', 'POSE', 160),
    ('SIGNATURE', 'Signature du client', '#16a34a', 'JALON', 0, 'OUV', NULL, 170),
    ('BESOIN', 'Expression du besoin', '#64748b', 'TACHE', 1, 'OUV', NULL, 180),
    ('CONSULTATION', 'Consultation', '#7c3aed', 'TACHE', 5, 'OUV', NULL, 190),
    ('ATTRIBUTION', 'Attribution', '#16a34a', 'JALON', 0, 'OUV', NULL, 200),
    ('COMMANDE', 'Commande passée', '#16a34a', 'JALON', 0, 'OUV', NULL, 210)
) AS x(code, libelle, couleur, nature, duree, unite, service, ordre)
WHERE NOT EXISTS (SELECT 1 FROM exe_etat_catalogue);

-- États des types de démonstration (une fois par type) : date obligatoire = colonne du tableau de l'entête.
INSERT INTO exe_etat_type (ett_type_ordre, ett_etc_code, ett_ordre, ett_date_obligatoire, ett_controle, ett_controle_bloquant, ett_statut_document)
SELECT x.type, x.code, x.ordre, x.obligatoire, x.controle, x.bloquant, x.statut
FROM (VALUES
    ('E_OE', 'LANCEMENT', 1, TRUE, TRUE, TRUE, 'ENVOYE'), ('E_OE', 'PREPARATION', 2, FALSE, FALSE, TRUE, NULL),
    ('E_BE', 'ETUDE', 1, TRUE, TRUE, TRUE, NULL), ('E_BE', 'VISA', 2, TRUE, FALSE, TRUE, NULL), ('E_BE', 'PLANS_BPE', 3, TRUE, FALSE, TRUE, NULL),
    ('E_BM', 'GAMME', 1, TRUE, FALSE, TRUE, NULL),
    ('E_OF', 'DEBIT', 1, FALSE, FALSE, TRUE, NULL), ('E_OF', 'FABRICATION', 2, TRUE, FALSE, TRUE, NULL), ('E_OF', 'SECHAGE', 3, FALSE, FALSE, TRUE, NULL),
    ('E_OF', 'CONTROLE', 4, TRUE, TRUE, FALSE, NULL),
    ('E_CO', 'COLISAGE', 1, TRUE, FALSE, TRUE, NULL), ('E_CO', 'CHARGEMENT', 2, FALSE, FALSE, TRUE, NULL),
    ('E_LI', 'CHARGEMENT', 1, FALSE, FALSE, TRUE, NULL), ('E_LI', 'LIVRAISON', 2, TRUE, FALSE, TRUE, NULL),
    ('E_PO', 'PREPARATION', 1, FALSE, FALSE, TRUE, NULL), ('E_PO', 'POSE', 2, TRUE, FALSE, TRUE, NULL), ('E_PO', 'RECEPTION', 3, TRUE, TRUE, TRUE, NULL),
    ('E_SAV', 'INTERVENTION', 1, TRUE, FALSE, TRUE, NULL), ('E_SAV', 'SIGNATURE', 2, TRUE, FALSE, TRUE, NULL),
    ('E_OST', 'CONSULTATION', 1, TRUE, FALSE, TRUE, NULL), ('E_OST', 'ATTRIBUTION', 2, TRUE, TRUE, TRUE, NULL),
    ('E_DAP', 'BESOIN', 1, TRUE, FALSE, TRUE, NULL), ('E_DAP', 'COMMANDE', 2, TRUE, FALSE, TRUE, NULL),
    ('E_DAC', 'CONSULTATION', 1, TRUE, FALSE, TRUE, NULL), ('E_DAC', 'COMMANDE', 2, TRUE, FALSE, TRUE, NULL)
) AS x(type, code, ordre, obligatoire, controle, bloquant, statut)
WHERE EXISTS (SELECT 1 FROM exe_etat_catalogue c WHERE c.etc_code = x.code)
  AND NOT EXISTS (SELECT 1 FROM exe_etat_type t WHERE t.ett_type_ordre = x.type);

-- Liste des ordres (reprise de 197) : colonnes des étapes à la fin ; en retard : fin prévue ou étape dépassée.
CREATE OR REPLACE VIEW v_liste_ordres AS
SELECT v.*, d.ent_exe_etat AS etat_execution, m.mot_libelle AS motif, sv.srv_libelle AS service, sv.srv_id AS service_id,
       concat_ws(' ', r.ind_prenom, r.ind_nom) AS responsable, d.ent_debut_prevu AS debut_prevu, d.ent_fin_prevue AS fin_prevue,
       (SELECT sum(h.heures) FROM v_heures_lignes h WHERE h.ent_id = d.ent_id) AS heures_budget,
       CASE WHEN s.std_code IN ('ANNULE', 'REMPLACE', 'SOLDE') OR coalesce(d.ent_exe_etat, '') = 'TERMINE' THEN FALSE
            WHEN d.ent_fin_prevue < current_date THEN TRUE
            WHEN EXISTS (SELECT 1 FROM exe_ordre_etape e WHERE e.ore_ordre_id = d.ent_id AND e.ore_valide_le IS NULL AND e.ore_prevu_le < current_date) THEN TRUE
            ELSE FALSE END AS en_retard,
       (SELECT e.ore_libelle FROM exe_ordre_etape e WHERE e.ore_ordre_id = d.ent_id AND e.ore_valide_le IS NULL ORDER BY e.ore_ordre LIMIT 1) AS etape_en_cours,
       (SELECT min(e.ore_prevu_le) FROM exe_ordre_etape e WHERE e.ore_ordre_id = d.ent_id AND e.ore_valide_le IS NULL AND e.ore_date_obligatoire) AS prochaine_date,
       d.ent_ressource ->> 'libelle' AS ressource
FROM v_liste_documents v
JOIN document d ON d.ent_id = v.id
JOIN statut_document s ON s.std_id = d.ent_std_id
LEFT JOIN motif m ON m.mot_id = d.ent_exe_motif_id
LEFT JOIN service sv ON sv.srv_id = d.ent_srv_id
LEFT JOIN individu r ON r.ind_id = d.ent_responsable_id
WHERE v.famille = 'E';
