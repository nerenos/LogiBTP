-- =============================================================================
-- Cœur LogiBTP – module Comptabilité, base, lot 1 (ANALYSE-MODULE-COMPTABILITE.md § 4.1 à 4.3) :
--  * plan comptable de départ (comptes usuels du BTP, six chiffres comme les comptes déjà en place), type et sens
--    d'usage des comptes existants (classe 6 : achat, classe 7 : vente) ;
--  * collectifs par type de tiers (client professionnel, client particulier, fournisseur, sous-traitant) et préfixes
--    des comptes de tiers proposés ;
--  * fiche personne : surcharge du collectif par relation, compte auxiliaire propre du sous-traitant (sinon celui du
--    fournisseur, C4) ;
--  * taux de TVA : catégorie, comptes de TVA collectée, collectée à encaisser, déductible et autoliquidée ; mentions
--    réglementaires des taux réduits (textes à faire relire par l'expert-comptable, C9).
-- Rejouable.
-- =============================================================================

INSERT INTO compte_comptable (cpt_code, cpt_libelle, cpt_type, cpt_sens, cpt_lettrable) VALUES
 ('401100', 'Fournisseurs', 'COLLECTIF', 'ACHAT', TRUE),
 ('401200', 'Fournisseurs – sous-traitants', 'COLLECTIF', 'ACHAT', TRUE),
 ('401700', 'Fournisseurs – retenues de garantie', 'COLLECTIF', 'ACHAT', TRUE),
 ('409100', 'Fournisseurs – avances et acomptes versés', 'GENERAL', 'ACHAT', TRUE),
 ('411100', 'Clients professionnels', 'COLLECTIF', 'VENTE', TRUE),
 ('411200', 'Clients particuliers', 'COLLECTIF', 'VENTE', TRUE),
 ('411700', 'Clients – retenues de garantie', 'COLLECTIF', 'VENTE', TRUE),
 ('419100', 'Clients – avances et acomptes reçus', 'GENERAL', 'VENTE', TRUE),
 ('445200', 'TVA due intracommunautaire et autoliquidée', 'TVA', 'ACHAT', FALSE),
 ('445620', 'TVA déductible sur immobilisations', 'TVA', 'ACHAT', FALSE),
 ('445660', 'TVA déductible sur autres biens et services', 'TVA', 'ACHAT', FALSE),
 ('445710', 'TVA collectée', 'TVA', 'VENTE', FALSE),
 ('445740', 'TVA collectée à encaisser', 'TVA', 'VENTE', FALSE),
 ('512000', 'Banque', 'TRESORERIE', 'AUCUN', FALSE),
 ('609000', 'Rabais, remises et ristournes obtenus sur achats', 'GENERAL', 'ACHAT', FALSE),
 ('658000', 'Charges diverses de gestion courante (écarts d''arrondi)', 'GENERAL', 'LES_DEUX', FALSE),
 ('709000', 'Rabais, remises et ristournes accordés', 'GENERAL', 'VENTE', FALSE),
 ('758000', 'Produits divers de gestion courante (écarts d''arrondi)', 'GENERAL', 'LES_DEUX', FALSE)
ON CONFLICT (cpt_code) DO NOTHING;

-- Comptes antérieurs (db/166) jamais modifiés : sens d'usage selon la classe.
UPDATE compte_comptable SET cpt_sens = CASE left(cpt_code, 1) WHEN '6' THEN 'ACHAT' ELSE 'VENTE' END
WHERE cpt_maj_par IS NULL AND cpt_type = 'GENERAL' AND cpt_sens = 'AUCUN' AND left(cpt_code, 1) IN ('6', '7');

INSERT INTO collectif_tiers (col_code, col_libelle, col_cpt_code, col_ordre) VALUES
 ('CLIENT_PRO', 'Clients professionnels', '411100', 10),
 ('CLIENT_PRIVE', 'Clients particuliers', '411200', 20),
 ('FOURNISSEUR', 'Fournisseurs', '401100', 30),
 ('SOUS_TRAITANT', 'Sous-traitants', '401200', 40)
ON CONFLICT (col_code) DO NOTHING;

-- Préfixes des comptes de tiers proposés, par type de compte (C3).
UPDATE parametre_comptabilite SET pcp_valeur = '{"CLIENT":"C","FOURNISSEUR":"F","SOUS_TRAITANT":"S"}'
WHERE pcp_cle = 'prefixes_tiers' AND pcp_valeur = '{}'::jsonb;

-- Fiche personne : collectif surchargé par relation (vide = collectif du type), compte propre du sous-traitant.
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_cli_collectif VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_fou_collectif VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_st_collectif VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_st_compte VARCHAR(20);
CREATE INDEX IF NOT EXISTS ix_per_cli_compte ON personne (per_cli_compte) WHERE per_cli_compte IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_per_fou_compte ON personne (per_fou_compte) WHERE per_fou_compte IS NOT NULL;

-- Catégories de TVA de départ (C9 : textes à faire relire).
INSERT INTO categorie_tva (ctv_code, ctv_libelle, ctv_comportement, ctv_mention, ctv_ordre) VALUES
 ('NORMAL', 'Taux normal', 'N', NULL, 10),
 ('REDUIT_RENOVATION', 'Taux intermédiaire – travaux d''amélioration de logements', 'N',
  'TVA au taux de 10 % : travaux d''amélioration, de transformation, d''aménagement ou d''entretien de locaux d''habitation achevés depuis plus de deux ans (article 279-0 bis du CGI), sur attestation du client', 20),
 ('REDUIT_ENERGIE', 'Taux réduit – rénovation énergétique', 'N',
  'TVA au taux de 5,5 % : travaux d''amélioration de la qualité énergétique de locaux d''habitation achevés depuis plus de deux ans (article 278-0 bis A du CGI), sur attestation du client', 30),
 ('AUTOLIQ_BTP', 'Autoliquidation – sous-traitance BTP', 'A', 'Autoliquidation – TVA due par le preneur (article 283-2 nonies du CGI)', 40),
 ('INTRACOM', 'Intracommunautaire', 'I', 'Autoliquidation intracommunautaire (article 283-2 du CGI)', 50),
 ('EXPORT', 'Exportation', 'E', 'Exonération de TVA – exportation (article 262 I du CGI)', 60),
 ('EXONERE', 'Exonérée', 'E', 'Exonération de TVA (article 262 ter I du CGI)', 70),
 ('HORS_CHAMP', 'Hors du champ de la TVA', 'E', 'Opération hors du champ d''application de la TVA', 80)
ON CONFLICT (ctv_code) DO NOTHING;

-- Taux de TVA : catégorie et comptes.
ALTER TABLE taux_tva ADD COLUMN IF NOT EXISTS ttv_ctv_code VARCHAR(20) REFERENCES categorie_tva(ctv_code) ON UPDATE CASCADE;
ALTER TABLE taux_tva ADD COLUMN IF NOT EXISTS ttv_cpt_collectee VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;
ALTER TABLE taux_tva ADD COLUMN IF NOT EXISTS ttv_cpt_collectee_encaissement VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;
ALTER TABLE taux_tva ADD COLUMN IF NOT EXISTS ttv_cpt_deductible VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;
ALTER TABLE taux_tva ADD COLUMN IF NOT EXISTS ttv_cpt_autoliquidee VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;

UPDATE taux_tva t SET ttv_ctv_code = x.cat,
       ttv_cpt_collectee = x.collectee, ttv_cpt_collectee_encaissement = x.encaissement,
       ttv_cpt_deductible = x.deductible, ttv_cpt_autoliquidee = x.autoliquidee
FROM (VALUES
    ('T20', 'NORMAL', '445710', '445740', '445660', NULL),
    ('T10', 'REDUIT_RENOVATION', '445710', '445740', '445660', NULL),
    ('T55', 'REDUIT_ENERGIE', '445710', '445740', '445660', NULL),
    ('AL20', 'AUTOLIQ_BTP', NULL, NULL, '445660', '445200'),
    ('IC20', 'INTRACOM', NULL, NULL, '445660', '445200'),
    ('EXO', 'EXONERE', NULL, NULL, NULL, NULL)
) AS x(code, cat, collectee, encaissement, deductible, autoliquidee)
WHERE t.ttv_code = x.code AND t.ttv_ctv_code IS NULL;

-- Taux réduits sans mention : celle de leur catégorie (imprimée sur les pièces par document_tva.tva_mention).
UPDATE taux_tva t SET ttv_mention = c.ctv_mention
FROM categorie_tva c
WHERE c.ctv_code = t.ttv_ctv_code AND coalesce(t.ttv_mention, '') = '' AND c.ctv_mention IS NOT NULL;
