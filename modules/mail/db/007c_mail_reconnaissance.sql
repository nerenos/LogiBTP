-- Module Mail, lot 4 : reconnaissance automatique des courriels reçus (règles, propositions, nature). Rejouable.
-- Règles répliquées entre js/src/reconnaissance.js et ReconnaissanceMail.cs (jeu tests/cas/01_reconnaissance.json).

ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS mme_nature VARCHAR(30);

-- Règles : nature, mots cherchés (sans casse ni accents, mots entiers) dans les zones choisies (objet, texte, pieces ;
-- aucune = toutes), expéditeur par suffixe (adresse ou @domaine), action (ALERTER : rattacher et prévenir le service,
-- RATTACHER : sans alerte, IGNORER), service à prévenir (code), compte (null : tous), ordre.
CREATE TABLE IF NOT EXISTS mail_regle (
    mrg_id          BIGSERIAL     PRIMARY KEY,
    mrg_code        VARCHAR(30)   NOT NULL UNIQUE,
    mrg_libelle     VARCHAR(100)  NOT NULL,
    mrg_nature      VARCHAR(30)   NOT NULL,
    mrg_mots        TEXT[]        NOT NULL DEFAULT '{}',
    mrg_dans        TEXT[]        NOT NULL DEFAULT '{}',
    mrg_expediteur  VARCHAR(200),
    mrg_service     VARCHAR(20),
    mrg_mco_id      BIGINT        REFERENCES mail_compte(mco_id) ON DELETE CASCADE,
    mrg_action      VARCHAR(10)   NOT NULL DEFAULT 'ALERTER' CHECK (mrg_action IN ('ALERTER', 'RATTACHER', 'IGNORER')),
    mrg_ordre       INT           NOT NULL DEFAULT 100,
    mrg_actif       BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Propositions de la reconnaissance (score et indices), gardées pour la liste « À rapprocher ».
CREATE TABLE IF NOT EXISTS mail_proposition (
    mpr_mme_id       BIGINT        NOT NULL REFERENCES mail_message(mme_id) ON DELETE CASCADE,
    mpr_type_element VARCHAR(50)   NOT NULL,
    mpr_id_element   VARCHAR(50)   NOT NULL,
    mpr_score        INT           NOT NULL,
    mpr_indices      TEXT[]        NOT NULL DEFAULT '{}',
    PRIMARY KEY (mpr_mme_id, mpr_type_element, mpr_id_element)
);

INSERT INTO mail_parametre (mpa_cle, mpa_valeur) VALUES ('seuil_haut', '80'), ('seuil_bas', '40') ON CONFLICT (mpa_cle) DO NOTHING;

INSERT INTO mail_regle (mrg_code, mrg_libelle, mrg_nature, mrg_mots, mrg_dans, mrg_service, mrg_action, mrg_ordre) VALUES
 ('ARC', 'Accusé de réception de commande', 'ARC',
  '{"accusé de réception","accuse de reception","ARC","confirmation de commande","order confirmation"}', '{objet,pieces}', 'ACHAT', 'ALERTER', 10),
 ('DEVIS', 'Réponse à un devis', 'REPONSE_DEVIS',
  '{"bon pour accord","devis signé","devis accepté","acceptation","accord","refus","refusé"}', '{objet,texte}', 'VENTE', 'ALERTER', 20),
 ('FACTURE', 'Facture fournisseur', 'FACTURE_FOURNISSEUR', '{"facture","invoice"}', '{objet,pieces}', 'ADMIN', 'ALERTER', 30),
 ('BL', 'Bon de livraison, expédition', 'BL', '{"bon de livraison","avis d''expédition","avis d''expedition","expédition"}', '{objet,pieces}', 'ACHAT', 'ALERTER', 40),
 ('RELANCE', 'Relance', 'RELANCE', '{"relance","rappel","impayé"}', '{objet}', NULL, 'ALERTER', 50)
ON CONFLICT (mrg_code) DO NOTHING;
