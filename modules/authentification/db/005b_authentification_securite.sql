-- Module Authentification : sécurité de la connexion demandée par le module Droits (ANALYSE-MODULE-DROITS.md) ; rejouable.

-- Usurpation (D14, D27 : administrateur seulement, jamais un autre administrateur) : la session de l'administrateur
-- agit pour le compte usurpé jusqu'à la fin indiquée ; motif obligatoire ; chaque écriture est journalisée.
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_usurpe_cpt_id BIGINT REFERENCES compte(cpt_id) ON DELETE SET NULL;
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_usurpation_fin TIMESTAMPTZ;
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_usurpation_motif VARCHAR(200);

INSERT INTO parametre_authentification (pau_cle, pau_valeur) VALUES
 -- Usurpation : durée maximale (minutes), notification au compte usurpé.
 ('usurpation', '{"minutes": 60, "notifier": true}')
ON CONFLICT (pau_cle) DO NOTHING;

ALTER TABLE journal_connexion DROP CONSTRAINT IF EXISTS journal_connexion_jco_evenement_check;
ALTER TABLE journal_connexion ADD CONSTRAINT journal_connexion_jco_evenement_check CHECK (jco_evenement IN ('CONNEXION', 'ECHEC', 'VERROUILLAGE',
    'DECONNEXION', 'MDP_CHANGE', 'MDP_REINITIALISE', 'EXPIRE', 'REFUS', 'DEVERROUILLAGE', 'COMPTE', 'MDP_OUBLI',
    'USURPATION', 'USURPATION_FIN', 'USURPATION_ACTION'));

-- Lot 3 du module Droits (D1 à D4, D15, D19 à D21) ---------------------------------------------------------------

-- Identifiants non consécutifs (D17) et identifiants d'API (D15) : type API, secret haché, adresses permises.
ALTER TABLE compte ADD COLUMN IF NOT EXISTS cpt_uuid UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS ux_cpt_uuid ON compte (cpt_uuid);
ALTER TABLE compte DROP CONSTRAINT IF EXISTS compte_cpt_type_check;
ALTER TABLE compte ADD CONSTRAINT compte_cpt_type_check CHECK (cpt_type IN ('PERSONNE', 'SERVICE', 'API'));
ALTER TABLE compte DROP CONSTRAINT IF EXISTS ck_cpt_service;
ALTER TABLE compte ADD CONSTRAINT ck_cpt_service CHECK ((cpt_type <> 'SERVICE' OR (cpt_hash IS NULL AND cpt_type_element IS NULL))
                                                       AND (cpt_type <> 'API' OR cpt_type_element IS NULL));
ALTER TABLE compte ADD COLUMN IF NOT EXISTS cpt_adresses TEXT[];
-- Double facteur demandé par l'utilisateur lui-même (en plus de la règle de la société).
ALTER TABLE compte ADD COLUMN IF NOT EXISTS cpt_double_facteur BOOLEAN NOT NULL DEFAULT FALSE;

-- Session = famille de jetons : jeton de rafraîchissement courant (empreinte), fin absolue, machine connue, API.
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_uuid UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS ux_ses_uuid ON session_utilisateur (ses_uuid);
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_absolue_le TIMESTAMPTZ;
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_mac_id BIGINT;
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_api BOOLEAN NOT NULL DEFAULT FALSE;

-- Jetons de rafraîchissement remplacés : une réutilisation au-delà de 30 s = vol présumé, la session est fermée.
CREATE TABLE IF NOT EXISTS jeton_remplace (
    jre_empreinte    CHAR(64)      PRIMARY KEY,
    jre_ses_id       BIGINT        NOT NULL REFERENCES session_utilisateur(ses_id) ON DELETE CASCADE,
    jre_remplace_le  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_jre_session ON jeton_remplace (jre_ses_id);

-- Machines connues (D4) : jeton d'appareil de longue durée (cookie), empreinte seule conservée, nommable, révocable.
CREATE TABLE IF NOT EXISTS machine_connue (
    mac_id           BIGSERIAL     PRIMARY KEY,
    mac_uuid         UUID          NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    mac_cpt_id       BIGINT        NOT NULL REFERENCES compte(cpt_id) ON DELETE CASCADE,
    mac_empreinte    CHAR(64)      NOT NULL UNIQUE,
    mac_nom          VARCHAR(120),
    mac_cree_le      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    mac_vu_le        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    mac_adresse      VARCHAR(64),
    mac_revoquee_le  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_mac_compte ON machine_connue (mac_cpt_id) WHERE mac_revoquee_le IS NULL;

-- Double facteur par courriel (D3) : étape de connexion (jeton haché) et code à 6 chiffres haché, 10 min, 5 essais.
CREATE TABLE IF NOT EXISTS code_connexion (
    cco_id           BIGSERIAL     PRIMARY KEY,
    cco_cpt_id       BIGINT        NOT NULL REFERENCES compte(cpt_id) ON DELETE CASCADE,
    cco_etape        CHAR(64)      NOT NULL UNIQUE,
    cco_code         CHAR(64)      NOT NULL,
    cco_cree_le      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    cco_expire_le    TIMESTAMPTZ   NOT NULL,
    cco_essais       INT           NOT NULL DEFAULT 0,
    cco_utilise_le   TIMESTAMPTZ,
    cco_rester       BOOLEAN       NOT NULL DEFAULT FALSE,
    cco_adresse      VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS ix_cco_compte ON code_connexion (cco_cpt_id, cco_cree_le DESC);

-- Exclusion d'une adresse IP (D19 à D21, par base) : trop d'échecs sur la fenêtre → exclusion de durée croissante.
CREATE TABLE IF NOT EXISTS ip_exclue (
    ipe_id           BIGSERIAL     PRIMARY KEY,
    ipe_prefixe      VARCHAR(64)   NOT NULL,
    ipe_debut        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ipe_fin          TIMESTAMPTZ   NOT NULL,
    ipe_echecs       INT           NOT NULL,
    ipe_levee_par    VARCHAR(50),
    ipe_levee_le     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_ipe_prefixe ON ip_exclue (ipe_prefixe, ipe_fin DESC);

INSERT INTO parametre_authentification (pau_cle, pau_valeur) VALUES
 -- Double facteur : AUCUN, ADMIN (profils à tous les droits) ou TOUS ; jamais depuis une adresse de confiance ni une machine connue.
 ('double_facteur', '{"mode": "ADMIN"}'),
 -- Exclusion d'adresse : échecs sur la fenêtre (minutes), durées successives (minutes) en cas de récidive sur 24 h.
 ('exclusion_ip', '{"echecs": 20, "minutes": 10, "durees": [15, 60, 1440]}')
ON CONFLICT (pau_cle) DO NOTHING;
-- Session : durée absolue sans machine connue (D2 : un jour), avec machine connue (« Rester connecté » : 7 jours).
UPDATE parametre_authentification SET pau_valeur = pau_valeur || '{"duree_max_heures": 24}'::jsonb
WHERE pau_cle = 'session' AND NOT pau_valeur ? 'duree_max_heures';

ALTER TABLE journal_connexion DROP CONSTRAINT IF EXISTS journal_connexion_jco_evenement_check;
ALTER TABLE journal_connexion ADD CONSTRAINT journal_connexion_jco_evenement_check CHECK (jco_evenement IN ('CONNEXION', 'ECHEC', 'VERROUILLAGE',
    'DECONNEXION', 'MDP_CHANGE', 'MDP_REINITIALISE', 'EXPIRE', 'REFUS', 'DEVERROUILLAGE', 'COMPTE', 'MDP_OUBLI',
    'USURPATION', 'USURPATION_FIN', 'USURPATION_ACTION', 'DOUBLE_FACTEUR', 'EXCLUSION_IP', 'VOL_PRESUME', 'MACHINE', 'SESSION_FERMEE',
    'JETON_API'));
