-- =============================================================================
-- Acomptes des marchés (CONCEPTION-MARCHES-REGLEMENTS.md, Q10 à Q13, 11.1, 11.2).
-- Mode de la société (parametre_document « acomptes ») : TRESORERIE (avance de trésorerie : demande puis reçu non
-- comptable, sans TVA, déduction TTC dans le pied global) ou CA (chiffre d'affaires : demande puis facture d'acompte
-- avec TVA, comptée dans le facturé ; déduction HT dans le pied de chaque commande, au prorata de sa période).
-- Un acompte appartient au marché (marche_acompte, mode figé à sa création) ; déduction PREMIERE, DERNIERE ou
-- LINEAIRE (au prorata de l'avancement cumulé) calculée à la validation des factures d'avancement ; déductions des
-- pièces validées dans acompte_deduction (une pièce annulée ne compte plus).
-- Rejouable.
-- =============================================================================

INSERT INTO type_document (tyd_code, tyd_libelle, tyd_famille, tyd_sens, tyd_prefixe_numero, tyd_numerotation_continue, tyd_mouvemente_stock, tyd_handler)
SELECT x.code, x.libelle, 'V', 1, x.prefixe, x.continue, FALSE, NULL
FROM (VALUES ('V_DEMANDE_ACOMPTE', 'Demande d''acompte', 'DAC', FALSE),
             ('V_FACTURE_ACOMPTE', 'Facture d''acompte', 'FAC', TRUE),
             ('V_RECU_ACOMPTE', 'Reçu d''acompte', 'RAC', FALSE)) AS x(code, libelle, prefixe, continue)
WHERE NOT EXISTS (SELECT 1 FROM type_document t WHERE t.tyd_code = x.code);

INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.code, s.libelle, s.modifiable, s.terminal, s.ordre
FROM type_document t
CROSS JOIN (VALUES ('BROUILLON', 'Brouillon', TRUE, FALSE, 1), ('VALIDE', 'Validé', FALSE, TRUE, 2),
                   ('ANNULE', 'Annulé', FALSE, TRUE, 3)) AS s(code, libelle, modifiable, terminal, ordre)
WHERE t.tyd_code IN ('V_DEMANDE_ACOMPTE', 'V_FACTURE_ACOMPTE', 'V_RECU_ACOMPTE')
  AND NOT EXISTS (SELECT 1 FROM statut_document x WHERE x.std_tyd_id = t.tyd_id);

INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape, tra_vaut_etapes)
SELECT s.tyd_id, c.tyd_id, 'ACOMPTE', '{}'::varchar(20)[]
FROM type_document s, type_document c
WHERE s.tyd_code = 'V_DEMANDE_ACOMPTE' AND c.tyd_code IN ('V_FACTURE_ACOMPTE', 'V_RECU_ACOMPTE')
ON CONFLICT DO NOTHING;

INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT p.profil, t.tyd_id, a.action
FROM type_document t
CROSS JOIN (VALUES ('ADMIN'), ('SAISIE')) AS p(profil)
CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('VALIDER'), ('TRANSFORMER'), ('SUPPRIMER')) AS a(action)
WHERE t.tyd_code IN ('V_DEMANDE_ACOMPTE', 'V_FACTURE_ACOMPTE', 'V_RECU_ACOMPTE') AND (p.profil = 'ADMIN' OR a.action IN ('CREER', 'MODIFIER', 'TRANSFORMER'))
ON CONFLICT DO NOTHING;

-- Avoir d'une facture d'acompte : avoir de vente.
UPDATE type_document t SET tyd_avoir_tyd_id = a.tyd_id
FROM type_document a WHERE t.tyd_code = 'V_FACTURE_ACOMPTE' AND a.tyd_code = 'V_AVOIR';

INSERT INTO parametre_document (pdo_cle, pdo_valeur) VALUES ('acomptes', '{"mode":"TRESORERIE"}')
ON CONFLICT (pdo_cle) DO NOTHING;

CREATE TABLE IF NOT EXISTS marche_acompte (
    mac_id            SERIAL        PRIMARY KEY,
    mac_mar_id        INT           NOT NULL REFERENCES marche (mar_id) ON DELETE CASCADE,
    mac_rang          SMALLINT      NOT NULL,
    mac_libelle       VARCHAR(150)  NOT NULL,
    mac_mode          VARCHAR(10)   NOT NULL CHECK (mac_mode IN ('TRESORERIE','CA')),     -- mode de la société à la création
    mac_saisie        CHAR(1)       NOT NULL DEFAULT 'M' CHECK (mac_saisie IN ('P','M')),   -- % du marché HT ou montant
    mac_valeur        NUMERIC(18,6) NOT NULL,
    mac_montant       NUMERIC(18,6) NOT NULL,                                               -- TTC (trésorerie) ou HT (CA)
    mac_deduction     VARCHAR(10)   NOT NULL DEFAULT 'LINEAIRE' CHECK (mac_deduction IN ('PREMIERE','DERNIERE','LINEAIRE')),
    mac_demande_ent_id BIGINT       REFERENCES document (ent_id) ON DELETE SET NULL,
    mac_piece_ent_id  BIGINT        REFERENCES document (ent_id) ON DELETE SET NULL,      -- facture ou reçu
    mac_cree_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (mac_mar_id, mac_rang)
);

CREATE TABLE IF NOT EXISTS acompte_deduction (
    acd_id       SERIAL        PRIMARY KEY,
    acd_mac_id   INT           NOT NULL REFERENCES marche_acompte (mac_id) ON DELETE CASCADE,
    acd_ent_id   BIGINT        NOT NULL REFERENCES document (ent_id) ON DELETE CASCADE,
    acd_montant  NUMERIC(18,6) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_acd_acompte ON acompte_deduction (acd_mac_id);

-- Facturé : la facture d'acompte (mode chiffre d'affaires) en fait partie ; sa déduction (HT) le retire.
CREATE OR REPLACE VIEW v_facturation_document AS
SELECT d.ent_id, d.ent_projet_id, d.ent_affaire_id, d.ent_chantier_id, d.ent_marche_id,
       CASE WHEN t.tyd_code IN ('V_FACTURE','V_FACTURE_AVT','V_FACTURE_ACOMPTE') THEN d.ent_total_ht
            WHEN t.tyd_code = 'V_AVOIR' AND d.ent_nature_avoir = 'AVANCEMENT' THEN d.ent_total_ht
            WHEN t.tyd_code = 'V_AVOIR' THEN -d.ent_total_ht ELSE 0 END AS facture_ht
FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id
WHERE d.ent_verrouille;
