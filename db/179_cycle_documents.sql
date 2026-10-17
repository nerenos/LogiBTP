-- =============================================================================
-- Cœur LogiBTP – statuts du cycle de vie des documents (CONCEPTION-REGLES-DOCUMENTS.md, P1, P4, P17 à P25) :
-- BROUILLON, APPROUVE (validation interne facultative), ENVOYE (validé par l'entreprise), VALIDE (validé par le tiers),
-- SOLDE, FACTURATION, FACTURE (statuts automatiques), PAYE_PARTIEL, PAYE (module Règlements), ANNULE, REMPLACE
-- (ancienne version d'un document dévalidé). ACCEPTE est retiré (même sens que VALIDE). Terminaux : FACTURE, PAYE,
-- ANNULE, REMPLACE. Droits APPROUVER, DEVALIDER, FORCER (administrateur, en attendant le module de gestion des droits).
-- Rejouable.
-- =============================================================================

-- Statuts communs à tous les types.
INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.code, s.libelle, FALSE, s.terminal, s.ordre
FROM type_document t
CROSS JOIN (VALUES ('APPROUVE', 'Approuvé', FALSE, 2), ('ENVOYE', 'Envoyé', FALSE, 3), ('REMPLACE', 'Remplacé', TRUE, 12)) AS s(code, libelle, terminal, ordre)
WHERE NOT EXISTS (SELECT 1 FROM statut_document x WHERE x.std_tyd_id = t.tyd_id AND x.std_code = s.code);

-- Facturation des devis, commandes et BL (ventes et achats).
INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.code, s.libelle, FALSE, s.terminal, s.ordre
FROM type_document t
CROSS JOIN (VALUES ('FACTURATION', 'En facturation', FALSE, 7), ('FACTURE', 'Facturé', TRUE, 8)) AS s(code, libelle, terminal, ordre)
WHERE t.tyd_code IN ('V_DEVIS', 'V_COMMANDE', 'V_RECEPTION', 'A_DEVIS', 'A_COMMANDE', 'A_RECEPTION')
  AND NOT EXISTS (SELECT 1 FROM statut_document x WHERE x.std_tyd_id = t.tyd_id AND x.std_code = s.code);

-- Paiement des pièces comptables à régler.
INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.code, s.libelle, FALSE, s.terminal, s.ordre
FROM type_document t
CROSS JOIN (VALUES ('PAYE_PARTIEL', 'Payé partiellement', FALSE, 9), ('PAYE', 'Payé', TRUE, 10)) AS s(code, libelle, terminal, ordre)
WHERE t.tyd_code IN ('V_FACTURE', 'V_AVOIR', 'V_FACTURE_AVT', 'V_FACTURE_ACOMPTE', 'A_FACTURE', 'A_AVOIR', 'A_FACTURE_AVT')
  AND NOT EXISTS (SELECT 1 FROM statut_document x WHERE x.std_tyd_id = t.tyd_id AND x.std_code = s.code);

-- Ordre et fin de vie : VALIDE, SOLDE, FACTURATION ne sont plus terminaux.
UPDATE statut_document SET std_ordre = 4, std_terminal = FALSE WHERE std_code = 'VALIDE';
UPDATE statut_document SET std_ordre = 6, std_terminal = FALSE WHERE std_code = 'SOLDE';
UPDATE statut_document SET std_ordre = 8, std_terminal = TRUE WHERE std_code = 'FACTURE';
UPDATE statut_document SET std_ordre = 11, std_terminal = TRUE WHERE std_code = 'ANNULE';

-- ACCEPTE retiré : les documents acceptés sont validés par le tiers.
UPDATE document d SET ent_std_id = v.std_id, ent_valide_tiers_le = coalesce(d.ent_valide_tiers_le, now())
FROM statut_document a JOIN statut_document v ON v.std_tyd_id = a.std_tyd_id AND v.std_code = 'VALIDE'
WHERE a.std_code = 'ACCEPTE' AND d.ent_std_id = a.std_id;
DELETE FROM statut_document s WHERE s.std_code = 'ACCEPTE' AND NOT EXISTS (SELECT 1 FROM document d WHERE d.ent_std_id = s.std_id);

-- Droits du cycle de vie (administrateur).
INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT 'ADMIN', t.tyd_id, a.action FROM type_document t
CROSS JOIN (VALUES ('APPROUVER'), ('DEVALIDER'), ('FORCER')) AS a(action)
ON CONFLICT DO NOTHING;
