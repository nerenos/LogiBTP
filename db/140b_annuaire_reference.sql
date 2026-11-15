-- =============================================================================
-- Cœur LogiBTP – annuaire : référentiels (niveaux, casquettes, types de lien, rôles), hors données de démonstration
-- (extrait de 141_annuaire_demo.sql).
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/annuaire/donnees.js : ne pas modifier.
-- =============================================================================

INSERT INTO niveau_personne (niv_code, niv_libelle, niv_icone, niv_morale, niv_ordre, niv_actif) VALUES
 ('GROUPE', 'Groupe', '🏛️', TRUE, 10, TRUE),
 ('SOCIETE', 'Société', '🏢', TRUE, 20, TRUE),
 ('COLLECTIVITE', 'Collectivité, administration', '🏛', TRUE, 25, TRUE),
 ('ASSOCIATION', 'Association', '🤝', TRUE, 27, TRUE),
 ('ETABLISSEMENT', 'Établissement', '🏬', TRUE, 30, TRUE),
 ('AGENCE', 'Agence', '🏪', TRUE, 40, TRUE),
 ('DEPOT', 'Dépôt', '🏭', TRUE, 50, TRUE),
 ('SERVICE', 'Service', '🗂️', TRUE, 60, TRUE),
 ('PARTICULIER', 'Particulier', '🏠', FALSE, 90, TRUE);

INSERT INTO casquette (cas_code, cas_libelle, cas_icone, cas_groupes, cas_ordre, cas_actif) VALUES
 ('CLIENT', 'Client', '💶', '["client"]'::jsonb, 10, TRUE),
 ('PROSPECT', 'Prospect', '🎯', '[]'::jsonb, 15, TRUE),
 ('FOURNISSEUR', 'Fournisseur', '📦', '["fournisseur"]'::jsonb, 20, TRUE),
 ('LOUEUR', 'Loueur de matériel', '🚜', '["fournisseur"]'::jsonb, 25, TRUE),
 ('SOUS_TRAITANT', 'Sous-traitant', '🤝', '["sous_traitant"]'::jsonb, 30, TRUE),
 ('COTRAITANT', 'Cotraitant', '🔗', '[]'::jsonb, 35, TRUE),
 ('INTERIM', 'Agence d''intérim', '👷', '["interim"]'::jsonb, 40, TRUE),
 ('ARCHITECTE', 'Architecte', '📐', '["architecte"]'::jsonb, 50, TRUE),
 ('MOE', 'Maître d''œuvre', '🧭', '[]'::jsonb, 55, TRUE),
 ('BE', 'Bureau d''études', '📊', '[]'::jsonb, 60, TRUE),
 ('BC', 'Bureau de contrôle', '✅', '["controle"]'::jsonb, 65, TRUE),
 ('MOA', 'Maître d''ouvrage', '🏗️', '[]'::jsonb, 70, TRUE),
 ('BANQUE', 'Banque', '🏦', '[]'::jsonb, 80, TRUE),
 ('ASSURANCE', 'Assureur', '🛡️', '[]'::jsonb, 85, TRUE),
 ('RESTAURANT', 'Restaurant', '🍽', '[]'::jsonb, 90, TRUE);

INSERT INTO type_lien (tli_code, tli_libelle, tli_libelle_inverse, tli_ordre, tli_actif) VALUES
 ('FACTURER_A', 'Facturer à', 'Payeur pour', 10, TRUE),
 ('LIVRER_A', 'Livrer à', 'Reçoit les livraisons de', 20, TRUE),
 ('MANDATAIRE', 'A pour mandataire', 'Mandataire de', 30, TRUE),
 ('FACTOR', 'Affacturé par', 'Factor de', 40, TRUE),
 ('BANQUE', 'A pour banque', 'Banque de', 50, TRUE),
 ('ASSURE_PAR', 'Assuré par', 'Assureur de', 60, TRUE),
 ('PARTENAIRE', 'Partenaire de', 'Partenaire de', 70, TRUE);

INSERT INTO role_individu (rol_code, rol_libelle, rol_icone, rol_ordre, rol_actif) VALUES
 ('DIRIGEANT', 'Dirigeant', '🎩', 5, TRUE),
 ('SALARIE', 'Salarié', '👷', 10, TRUE),
 ('CHARGE_AFFAIRES', 'Chargé d''affaires', '💼', 20, TRUE),
 ('CHIFFREUR', 'Chiffreur', '🧮', 30, TRUE),
 ('CONDUCTEUR', 'Conducteur de travaux', '🦺', 40, TRUE),
 ('CHEF_CHANTIER', 'Chef de chantier', '🏗️', 45, TRUE),
 ('INTERIMAIRE', 'Intérimaire', '⏱️', 50, TRUE),
 ('UTILISATEUR', 'Utilisateur LogiBTP', '🔑', 60, TRUE);
