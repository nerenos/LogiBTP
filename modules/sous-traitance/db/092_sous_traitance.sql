-- Module Sous-traitance LogiBTP – pièces exigées (ANALYSE-MODULE-SOUS-TRAITANCE.md § 5.3, ST12, ST13, ST18) : liste
-- paramétrable des pièces (portée sous-traitant ou marché, catégorie GED, obligatoire, durée de validité, rappel,
-- actions bloquées, conditions) et ajustements par élément (pièce ajoutée ou dispensée sur un marché ou un
-- sous-traitant, motif). Les pièces fournies sont des documents de la GED, lus par la spécialisation de l'application.
-- Aucune clé étrangère vers l'application. Rejouable.

CREATE TABLE IF NOT EXISTS stt_piece_type (
    spt_code             VARCHAR(40)   PRIMARY KEY,
    spt_libelle          VARCHAR(150)  NOT NULL,
    spt_portee           VARCHAR(6)    NOT NULL CHECK (spt_portee IN ('TIERS', 'MARCHE')),
    spt_categorie        VARCHAR(50),
    spt_obligatoire      BOOLEAN       NOT NULL DEFAULT TRUE,
    spt_duree_mois       INT           CHECK (spt_duree_mois IS NULL OR spt_duree_mois > 0),
    spt_rappel_jours     INT           NOT NULL DEFAULT 0 CHECK (spt_rappel_jours >= 0),
    spt_bloquant         TEXT[]        NOT NULL DEFAULT '{}',
    spt_cond_public      BOOLEAN,
    spt_cond_garantie    VARCHAR(20),
    spt_cond_montant_min NUMERIC(18,2),
    spt_modele_edition   VARCHAR(50),
    spt_ordre            INT           NOT NULL DEFAULT 0,
    spt_actif            BOOLEAN       NOT NULL DEFAULT TRUE,
    spt_maj_par          VARCHAR(50),
    spt_maj_le           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stt_piece_element (
    spe_type_element VARCHAR(30)   NOT NULL,
    spe_id_element   VARCHAR(50)   NOT NULL,
    spe_code         VARCHAR(40)   NOT NULL REFERENCES stt_piece_type(spt_code) ON UPDATE CASCADE ON DELETE CASCADE,
    spe_mode         VARCHAR(10)   NOT NULL CHECK (spe_mode IN ('AJOUTEE', 'DISPENSEE')),
    spe_motif        TEXT,
    spe_par          VARCHAR(50)   NOT NULL,
    spe_le           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (spe_type_element, spe_id_element, spe_code)
);

-- Pièces fournies par défaut (ST12), une fois : la liste se complète librement.
INSERT INTO stt_piece_type (spt_code, spt_libelle, spt_portee, spt_categorie, spt_obligatoire, spt_duree_mois, spt_rappel_jours, spt_bloquant,
                            spt_cond_public, spt_cond_garantie, spt_ordre)
SELECT * FROM (VALUES
    ('kbis', 'Extrait Kbis (ou D1)', 'TIERS', 'kbis', TRUE, 3, 15, ARRAY['PAIEMENT'], NULL::boolean, NULL, 10),
    ('urssaf', 'Attestation de vigilance URSSAF', 'TIERS', 'attestation_urssaf', TRUE, 6, 30, ARRAY['PAIEMENT'], NULL, NULL, 20),
    ('lnte', 'Liste des salariés étrangers (LNTE)', 'TIERS', 'lnte', TRUE, 6, 30, ARRAY[]::text[], NULL, NULL, 30),
    ('fiscale', 'Attestation de régularité fiscale', 'TIERS', 'attestation_fiscale', TRUE, 6, 30, ARRAY[]::text[], TRUE, NULL, 40),
    ('rc', 'Attestation d''assurance responsabilité civile', 'TIERS', 'attestation_assurance', TRUE, 12, 30, ARRAY[]::text[], NULL, NULL, 50),
    ('decennale', 'Attestation d''assurance décennale', 'TIERS', 'assurance_decennale', TRUE, 12, 30, ARRAY[]::text[], NULL, NULL, 60),
    ('rib', 'RIB', 'TIERS', 'rib', FALSE, NULL, 0, ARRAY[]::text[], NULL, NULL, 70),
    ('dc4', 'Déclaration de sous-traitance (DC4)', 'MARCHE', 'dc4', TRUE, NULL, 0, ARRAY[]::text[], TRUE, NULL, 110),
    ('acte_special', 'Acte spécial', 'MARCHE', 'acte_special', FALSE, NULL, 0, ARRAY[]::text[], TRUE, NULL, 120),
    ('contrat', 'Contrat de sous-traitance', 'MARCHE', 'contrat_sous_traitance', TRUE, NULL, 0, ARRAY[]::text[], NULL, NULL, 130),
    ('agrement', 'Agrément du maître d''ouvrage', 'MARCHE', 'agrement_moa', TRUE, NULL, 0, ARRAY[]::text[], NULL, 'PAIEMENT_DIRECT', 140),
    ('caution', 'Caution bancaire', 'MARCHE', 'caution', TRUE, NULL, 30, ARRAY[]::text[], NULL, 'CAUTION', 150),
    ('delegation', 'Délégation de paiement', 'MARCHE', 'delegation_paiement', TRUE, NULL, 0, ARRAY[]::text[], NULL, 'DELEGATION', 160)
) AS x(code, libelle, portee, categorie, obligatoire, duree, rappel, bloquant, cond_public, cond_garantie, ordre)
WHERE NOT EXISTS (SELECT 1 FROM stt_piece_type);
