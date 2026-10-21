-- Module Notifications LogiBTP – centre de notifications (ANALYSE-MODULES-TRANSVERSE.md § 5) : une boîte par utilisateur
-- (code du compte), notifications publiées par les modules au travers de l'application (sources du planificateur de
-- fond, ou publication directe), préférences par module et par type (écran ; courriel avec le futur module Mail),
-- dernière exécution de chaque source par base. Une clé évite de notifier deux fois la même chose. Rejouable.

CREATE TABLE IF NOT EXISTS notification (
    ntf_id            BIGSERIAL     PRIMARY KEY,
    ntf_utilisateur   VARCHAR(50)   NOT NULL,
    ntf_module        VARCHAR(30)   NOT NULL,
    ntf_type          VARCHAR(40)   NOT NULL,
    ntf_niveau        VARCHAR(10)   NOT NULL DEFAULT 'INFO' CHECK (ntf_niveau IN ('INFO', 'ATTENTION', 'URGENT')),
    ntf_titre         VARCHAR(200)  NOT NULL,
    ntf_texte         TEXT,
    ntf_url           VARCHAR(300),
    ntf_type_element  VARCHAR(30),
    ntf_id_element    VARCHAR(50),
    ntf_cle           VARCHAR(200),
    ntf_cree_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ntf_lue_le        TIMESTAMPTZ,
    ntf_traitee_le    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_ntf_boite ON notification (lower(ntf_utilisateur), ntf_cree_le DESC) WHERE ntf_traitee_le IS NULL;
CREATE INDEX IF NOT EXISTS ix_ntf_traitee ON notification (ntf_traitee_le) WHERE ntf_traitee_le IS NOT NULL;
-- Même clé pour le même utilisateur : une seule notification (la source change la clé pour notifier de nouveau).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ntf_cle ON notification (lower(ntf_utilisateur), ntf_cle) WHERE ntf_cle IS NOT NULL;

-- Préférences (en base : elles servent au serveur) ; type '*' = tous les types du module ; sans préférence : écran oui.
CREATE TABLE IF NOT EXISTS notification_preference (
    npr_utilisateur   VARCHAR(50)   NOT NULL,
    npr_module        VARCHAR(30)   NOT NULL,
    npr_type          VARCHAR(40)   NOT NULL DEFAULT '*',
    npr_ecran         BOOLEAN       NOT NULL DEFAULT TRUE,
    npr_courriel      BOOLEAN       NOT NULL DEFAULT FALSE,
    PRIMARY KEY (npr_utilisateur, npr_module, npr_type)
);

-- Dernière exécution de chaque source du planificateur (par base).
CREATE TABLE IF NOT EXISTS notification_execution (
    nex_source        VARCHAR(60)   PRIMARY KEY,
    nex_derniere      TIMESTAMPTZ,
    nex_publiees      INT           NOT NULL DEFAULT 0,
    nex_erreur        TEXT
);
