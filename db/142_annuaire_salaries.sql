-- =============================================================================
-- Cœur LogiBTP – démonstration : chaque salarié est un individu de l'annuaire, rattaché à l'agence de notre société
-- (fonction = poste, service, date d'entrée) avec ses coordonnées professionnelles (e-mail, téléphone) sur le
-- rattachement. Les données privées (adresse, téléphone et e-mail personnels) restent confidentielles dans la fiche
-- salarié. Rôles : salarié ou intérimaire, conducteur de travaux, chef de chantier (chef d'équipe), chiffreur (métreur).
-- Identifiants : individu et rattachement = 1000 + sal_id ; coordonnées = 100000 + 2 × sal_id (+ 1).
-- =============================================================================

INSERT INTO individu (ind_id, ind_nom, ind_prenom, ind_date_naissance, ind_roles, ind_actif, ind_commentaire)
SELECT 1000 + sal_id, sal_nom, sal_prenom, sal_date_naissance,
       to_jsonb(array_remove(ARRAY[
           CASE WHEN sal_statut = 'INTERIM' THEN 'INTERIMAIRE' ELSE 'SALARIE' END,
           CASE sal_poste WHEN 'Conducteur de travaux' THEN 'CONDUCTEUR' WHEN 'Chef d''équipe' THEN 'CHEF_CHANTIER' WHEN 'Métreur' THEN 'CHIFFREUR' END], NULL)),
       sal_actif, 'Salarié ' || sal_matricule
FROM salarie;

INSERT INTO rattachement (rat_id, rat_ind_id, rat_per_id, rat_fonction, rat_service, rat_debut, rat_actif)
SELECT 1000 + s.sal_id, 1000 + s.sal_id, p.per_id, s.sal_poste || CASE WHEN s.sal_statut = 'INTERIM' THEN ' (intérim)' ELSE '' END,
       s.sal_service, s.sal_date_entree, s.sal_actif
FROM salarie s
JOIN personne p ON p.per_raison_sociale = CASE WHEN s.sal_agence = 'Lyon' THEN 'LogiBTP Démo' ELSE 'LogiBTP Démo – Agence de ' || s.sal_agence END;

INSERT INTO coordonnee (coo_id, coo_nature, coo_valeur, coo_modifie_par)
SELECT 100000 + 2 * sal_id, 'EMAIL', sal_email, 'demo' FROM salarie WHERE sal_email IS NOT NULL
UNION ALL
SELECT 100001 + 2 * sal_id, 'TELEPHONE', sal_telephone, 'demo' FROM salarie WHERE sal_telephone IS NOT NULL;

INSERT INTO usage_coordonnee (uco_coo_id, uco_rat_id, uco_usage, uco_principal, uco_ordre)
SELECT c.coo_id, 1000 + (c.coo_id - 100000) / 2, CASE c.coo_nature WHEN 'EMAIL' THEN 'PRO' ELSE 'PORTABLE' END, TRUE, 0
FROM coordonnee c
WHERE c.coo_id >= 100000 AND EXISTS (SELECT 1 FROM rattachement r WHERE r.rat_id = 1000 + (c.coo_id - 100000) / 2);

UPDATE salarie SET sal_ind_id = 1000 + sal_id;

SELECT setval(pg_get_serial_sequence('individu', 'ind_id'), (SELECT max(ind_id) FROM individu));
SELECT setval(pg_get_serial_sequence('rattachement', 'rat_id'), (SELECT max(rat_id) FROM rattachement));
SELECT setval(pg_get_serial_sequence('coordonnee', 'coo_id'), (SELECT max(coo_id) FROM coordonnee));
