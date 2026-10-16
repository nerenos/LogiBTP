-- =============================================================================
-- Cœur LogiBTP – avancement des marchés, suite (CONCEPTION-ACHATS-MARCHES.md, Q26, Q29, 13.7, 13.11) :
-- - reprise d'avancement (V_REPRISE_AVT, non comptable) : cumul déjà facturé dans un autre logiciel, compté comme
--   précédent des factures d'avancement ;
-- - facture d'avancement à période négative → avoir (tyd_avoir_tyd_id) ; le facturé du marché compte l'avoir
--   d'avancement avec son signe ;
-- - document_deduction : documents précédents déduits d'une facture d'avancement (figés à sa validation).
-- Rejouable.
-- =============================================================================

INSERT INTO type_document (tyd_code, tyd_libelle, tyd_famille, tyd_sens, tyd_prefixe_numero, tyd_numerotation_continue, tyd_mouvemente_stock, tyd_handler)
SELECT 'V_REPRISE_AVT', 'Reprise d''avancement', 'V', 1, 'RA', FALSE, FALSE, NULL
WHERE NOT EXISTS (SELECT 1 FROM type_document WHERE tyd_code = 'V_REPRISE_AVT');
UPDATE type_document SET tyd_avancement = 'R' WHERE tyd_code = 'V_REPRISE_AVT';

INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.code, s.libelle, s.modifiable, s.terminal, s.ordre
FROM type_document t
CROSS JOIN (VALUES ('BROUILLON', 'Brouillon', TRUE, FALSE, 1), ('VALIDE', 'Validé', FALSE, TRUE, 2),
                   ('ANNULE', 'Annulé', FALSE, TRUE, 3)) AS s(code, libelle, modifiable, terminal, ordre)
WHERE t.tyd_code = 'V_REPRISE_AVT'
  AND NOT EXISTS (SELECT 1 FROM statut_document x WHERE x.std_tyd_id = t.tyd_id);

INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape, tra_vaut_etapes)
SELECT s.tyd_id, c.tyd_id, 'REPRISE', '{}'::varchar(20)[]
FROM type_document s, type_document c
WHERE s.tyd_code = 'V_COMMANDE' AND c.tyd_code = 'V_REPRISE_AVT'
ON CONFLICT DO NOTHING;

INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT p.profil, t.tyd_id, a.action
FROM type_document t
CROSS JOIN (VALUES ('ADMIN'), ('SAISIE')) AS p(profil)
CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('VALIDER'), ('TRANSFORMER'), ('SUPPRIMER')) AS a(action)
WHERE t.tyd_code = 'V_REPRISE_AVT' AND (p.profil = 'ADMIN' OR a.action IN ('CREER', 'MODIFIER', 'TRANSFORMER'))
ON CONFLICT DO NOTHING;

UPDATE type_document t SET tyd_avoir_tyd_id = a.tyd_id
FROM type_document a
WHERE (t.tyd_code, a.tyd_code) IN (('V_FACTURE_AVT', 'V_AVOIR'), ('A_FACTURE_AVT', 'A_AVOIR'));

-- Facturé : un avoir d'avancement (période négative) garde son signe ; un avoir ordinaire est déduit.
CREATE OR REPLACE VIEW v_facturation_document AS
SELECT d.ent_id, d.ent_projet_id, d.ent_affaire_id, d.ent_chantier_id, d.ent_marche_id,
       CASE WHEN t.tyd_code IN ('V_FACTURE','V_FACTURE_AVT') THEN d.ent_total_ht
            WHEN t.tyd_code = 'V_AVOIR' AND d.ent_nature_avoir = 'AVANCEMENT' THEN d.ent_total_ht
            WHEN t.tyd_code = 'V_AVOIR' THEN -d.ent_total_ht ELSE 0 END AS facture_ht
FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id
WHERE d.ent_verrouille;

CREATE TABLE IF NOT EXISTS document_deduction (
    ded_id            SERIAL         PRIMARY KEY,
    ded_ent_id        BIGINT         NOT NULL REFERENCES document(ent_id) ON DELETE CASCADE,
    ded_deduit_ent_id BIGINT         NOT NULL REFERENCES document(ent_id),
    ded_rang          INT,
    ded_montant_ht    NUMERIC(18,6)  NOT NULL,
    ded_montant_ttc   NUMERIC(18,6)  NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ded_document ON document_deduction (ded_ent_id);
