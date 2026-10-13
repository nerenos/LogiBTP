-- =============================================================================
-- Cœur LogiBTP – vues de colonnes de la grille des lignes : vue par défaut par modèle de saisie, vue de débogage.
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/vues-document.js : ne pas modifier.
-- =============================================================================

INSERT INTO vue_document (vdo_id, vdo_nom, vdo_tyd_id, vdo_mod_code, vdo_proprietaire, vdo_par_defaut, vdo_definition, vdo_modifie_par) VALUES
 (1, 'Complet', NULL, 'COMPLET', NULL, TRUE, '{"colonnes":[{"cle":"num"},{"cle":"type"},{"cle":"code"},{"cle":"libelle"},{"cle":"nature"},{"cle":"qte"},{"cle":"unite"},{"cle":"pa"},{"cle":"fg"},{"cle":"benef"},{"cle":"pv"},{"cle":"remise"},{"cle":"pvnet"},{"cle":"montant"},{"cle":"tva"}],"debogage":false,"systeme":[]}'::jsonb, 'systeme'),
 (2, 'Chiffrage', NULL, 'CHIFFRAGE', NULL, TRUE, '{"colonnes":[{"cle":"num"},{"cle":"type"},{"cle":"code"},{"cle":"libelle"},{"cle":"nature"},{"cle":"qte"},{"cle":"unite"},{"cle":"pa"},{"cle":"fg"},{"cle":"benef"},{"cle":"pv"},{"cle":"pvnet"},{"cle":"montant"}],"debogage":false,"systeme":[]}'::jsonb, 'systeme'),
 (3, 'À la volée', NULL, 'VOLEE', NULL, TRUE, '{"colonnes":[{"cle":"num"},{"cle":"code"},{"cle":"libelle"},{"cle":"nature"},{"cle":"qte"},{"cle":"unite"},{"cle":"pv"},{"cle":"montant"},{"cle":"tva"}],"debogage":false,"systeme":[]}'::jsonb, 'systeme'),
 (4, 'Débogage', NULL, NULL, NULL, FALSE, '{"colonnes":[{"cle":"num"},{"cle":"type"},{"cle":"code"},{"cle":"libelle"},{"cle":"nature"},{"cle":"qte"},{"cle":"pv"},{"cle":"montant"},{"cle":"tva"}],"debogage":true,"systeme":["_controles","lig_id","lig_parent_id","lig_ordre","lig_tyl_id","lig_type_prix","lig_variante_de_id","lig_st_depuis_id","lig_pied_mode","lig_pied_base","lig_pied_base_id","lig_base_calcul","lig_qte_totale","lig_montant_pr","lig_etiquette"]}'::jsonb, 'systeme')
ON CONFLICT (vdo_id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('vue_document', 'vdo_id'), (SELECT max(vdo_id) FROM vue_document));
