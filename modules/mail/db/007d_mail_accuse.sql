-- Module Mail, plan ar-courriel lot 2 : accusé de réception de commande reconnu dans un courriel reçu. Rejouable.
-- Proposition conservée sur le message (numéro d'AR, livraison annoncée) ; le cœur la rapproche d'une commande et ne
-- l'applique qu'après validation par l'utilisateur. Règle répliquée : js/src/reconnaissance.js (reconnaitreAccuse).

ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS mme_ar_motif     VARCHAR(100);
ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS mme_ar_numeros   TEXT[];
ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS mme_ar_numero    VARCHAR(100);
ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS mme_ar_date      DATE;
ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS mme_ar_semaine   SMALLINT;
ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS mme_ar_precision VARCHAR(10);
