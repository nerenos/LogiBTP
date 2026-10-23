-- Module Mail, lot 3 : réception IMAP (dossiers relevés et état de synchronisation par UID). Rejouable.
-- Options d'un compte (mco_options) : intervalle_minutes (60), marquer_lus (non), apres_rattachement (RIEN | DEPLACER |
-- RETIRER_DRAPEAU), dossier_traites, drapeau_a_suivre (non). Dossiers (mco_dossiers) : [{ nom, role : RECEPTION | A_TRAITER }].

ALTER TABLE mail_compte ADD COLUMN IF NOT EXISTS mco_releve_le TIMESTAMPTZ;
ALTER TABLE mail_compte ADD COLUMN IF NOT EXISTS mco_releve_erreur VARCHAR(500);

CREATE TABLE IF NOT EXISTS mail_dossier (
    mdo_mco_id       BIGINT        NOT NULL REFERENCES mail_compte(mco_id) ON DELETE CASCADE,
    mdo_nom          VARCHAR(200)  NOT NULL,
    mdo_uidvalidity  BIGINT,
    mdo_dernier_uid  BIGINT        NOT NULL DEFAULT 0,
    mdo_releve_le    TIMESTAMPTZ,
    mdo_releves      INT           NOT NULL DEFAULT 0,
    mdo_erreur       VARCHAR(500),
    PRIMARY KEY (mdo_mco_id, mdo_nom)
);

-- Un courriel reçu n'est enregistré qu'une fois par compte (même contenu relevé deux fois).
CREATE UNIQUE INDEX IF NOT EXISTS ux_mme_recu ON mail_message (mme_mco_id, mme_empreinte) WHERE mme_sens = 'R';

INSERT INTO mail_parametre (mpa_cle, mpa_valeur) VALUES
 ('conservation_non_rapproches_jours', '90'),  -- courriels reçus non rapprochés ou ignorés : purgés ensuite
 ('premiere_releve_jours', '30'),              -- première relève d'un dossier : courriels de ces derniers jours
 ('taille_reception_mo', '25')                 -- au-delà : en-têtes seuls
ON CONFLICT (mpa_cle) DO NOTHING;
