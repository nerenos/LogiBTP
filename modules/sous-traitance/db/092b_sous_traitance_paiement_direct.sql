-- Module Sous-traitance LogiBTP – paiement direct (ANALYSE-MODULE-SOUS-TRAITANCE.md § 5.5, ST14 à ST16) : demande de
-- paiement d'une facture de sous-traitance (facture du sous-traitant, facture client qui porte la déduction), délai
-- d'acceptation, montant accepté (refus total ou partiel motivé), transmission au maître d'ouvrage, paiement constaté.
-- Mode DIRECT (marché public : déduction de notre facture au client) ou DELEGATION (marché privé, ST14 : suivi seul,
-- sans déduction). Les factures sont des identifiants fournis par l'application. Rejouable.

CREATE TABLE IF NOT EXISTS stt_paiement_direct (
    spd_id                 BIGSERIAL     PRIMARY KEY,
    spd_facture_id         BIGINT        NOT NULL UNIQUE,
    spd_facture_client_id  BIGINT,
    spd_marche_id          INT           NOT NULL,
    spd_mode               VARCHAR(10)   NOT NULL DEFAULT 'DIRECT' CHECK (spd_mode IN ('DIRECT', 'DELEGATION')),
    spd_montant_demande    NUMERIC(18,2) NOT NULL,
    spd_montant_accepte    NUMERIC(18,2),
    spd_etat               VARCHAR(10)   NOT NULL DEFAULT 'RECUE'
                           CHECK (spd_etat IN ('RECUE', 'ACCEPTEE', 'PARTIELLE', 'REFUSEE', 'TRANSMISE', 'PAYEE')),
    spd_recue_le           DATE          NOT NULL,
    spd_motif              TEXT,
    spd_accepte_le         DATE,
    spd_transmise_le       DATE,
    spd_payee_le           DATE,
    spd_maj_par            VARCHAR(50)   NOT NULL,
    spd_maj_le             TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_spd_marche ON stt_paiement_direct (spd_marche_id);
CREATE INDEX IF NOT EXISTS ix_spd_client ON stt_paiement_direct (spd_facture_client_id) WHERE spd_facture_client_id IS NOT NULL;
