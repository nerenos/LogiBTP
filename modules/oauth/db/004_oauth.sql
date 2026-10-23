-- Module OAuth : connexions sortantes de l'application à des services externes (jetons OAuth 2.0 chiffrés, renouvelés,
-- échéances rappelées). Analyse : documentation/conception/ANALYSE-MODULE-OAUTH.md. Rejouable.
-- Tout ce qui identifie ou ouvre l'accès est chiffré par l'application (valeurs « chiffre:v1: » du socle) : client,
-- jetons, compte connecté ; en clair : nom d'usage, fournisseur, flux, portées, état, dates d'échéance.

-- Fournisseurs (modèles livrés, complétables) : points de terminaison et paramètres de la demande d'autorisation.
CREATE TABLE IF NOT EXISTS oauth_fournisseur (
    ofo_code             VARCHAR(30)   PRIMARY KEY,
    ofo_libelle          VARCHAR(80)   NOT NULL,
    ofo_url_autorisation VARCHAR(300)  NOT NULL,
    ofo_url_jeton        VARCHAR(300)  NOT NULL,
    ofo_url_revocation   VARCHAR(300),
    ofo_portees          VARCHAR(500)  NOT NULL DEFAULT '',     -- portées proposées par défaut (séparées par des espaces)
    ofo_parametres       JSONB         NOT NULL DEFAULT '{}',   -- paramètres ajoutés à la demande d'autorisation
    ofo_rafraichissement_test_jours INT,                        -- durée du jeton de rafraîchissement d'une application en mode test
    ofo_actif            BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO oauth_fournisseur (ofo_code, ofo_libelle, ofo_url_autorisation, ofo_url_jeton, ofo_url_revocation, ofo_portees, ofo_parametres, ofo_rafraichissement_test_jours)
VALUES ('GOOGLE', 'Google (Gmail)', 'https://accounts.google.com/o/oauth2/v2/auth', 'https://oauth2.googleapis.com/token',
        'https://oauth2.googleapis.com/revoke', 'openid email https://mail.google.com/',
        '{"access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"}', 7)
ON CONFLICT (ofo_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS oauth_connexion (
    oco_id                         BIGSERIAL     PRIMARY KEY,
    oco_code                       VARCHAR(30)   NOT NULL UNIQUE,
    oco_nom                        VARCHAR(100)  NOT NULL,                       -- nom d'usage dans l'application, jamais l'adresse
    oco_ofo_code                   VARCHAR(30)   NOT NULL REFERENCES oauth_fournisseur(ofo_code),
    oco_flux                       VARCHAR(20)   NOT NULL DEFAULT 'CODE_PKCE' CHECK (oco_flux IN ('CODE_PKCE', 'CLIENT', 'COMPTE_SERVICE')),
    oco_portees                    VARCHAR(500)  NOT NULL DEFAULT '',
    oco_mode_test                  BOOLEAN       NOT NULL DEFAULT TRUE,          -- application du fournisseur non vérifiée (jetons courts)
    oco_client                     TEXT,                                         -- chiffré : { identifiant_client, secret, locataire }
    oco_jetons                     TEXT,                                         -- chiffré : { acces, rafraichissement, type }
    oco_compte                     TEXT,                                         -- chiffré : compte connecté (adresse)
    oco_compte_empreinte           CHAR(64),                                     -- HMAC du compte (comparaisons sans déchiffrer)
    oco_acces_expire_le            TIMESTAMPTZ,
    oco_rafraichissement_expire_le TIMESTAMPTZ,
    oco_secret_expire_le           TIMESTAMPTZ,
    oco_etat                       VARCHAR(20)   NOT NULL DEFAULT 'A_CONNECTER' CHECK (oco_etat IN ('A_CONNECTER', 'OK', 'A_RECONNECTER', 'DESACTIVEE')),
    oco_derniere_erreur            VARCHAR(500),
    oco_renouvele_le               TIMESTAMPTZ,
    oco_connecte_le                TIMESTAMPTZ,
    oco_connecte_par               VARCHAR(50),
    oco_droits                     TEXT[]        NOT NULL DEFAULT '{}',          -- profils (« ADMIN ») ou services (« service:<code> ») autorisés à reconnecter
    oco_rappels_jours              INT[],                                        -- délais de rappel propres (null : paramètre global)
    oco_utilisateur                VARCHAR(50),                                  -- second temps : connexion personnelle
    oco_cree_par                   VARCHAR(50)   NOT NULL DEFAULT 'demo',
    oco_cree_le                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    oco_maj_par                    VARCHAR(50),
    oco_maj_le                     TIMESTAMPTZ
);

-- Paramètres globaux du module.
CREATE TABLE IF NOT EXISTS oauth_parametre (
    opa_cle    VARCHAR(50) PRIMARY KEY,
    opa_valeur JSONB       NOT NULL
);
INSERT INTO oauth_parametre (opa_cle, opa_valeur) VALUES ('rappels_jours', '[30, 7, 1]') ON CONFLICT (opa_cle) DO NOTHING;

-- Rappels d'échéance déjà émis (une fois par connexion, échéance et délai).
CREATE TABLE IF NOT EXISTS oauth_rappel (
    ora_oco_id    BIGINT       NOT NULL REFERENCES oauth_connexion(oco_id) ON DELETE CASCADE,
    ora_echeance  VARCHAR(20)  NOT NULL,          -- SECRET | RAFRAICHISSEMENT
    ora_date      TIMESTAMPTZ  NOT NULL,
    ora_delai     INT          NOT NULL,
    ora_emis_le   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (ora_oco_id, ora_echeance, ora_date, ora_delai)
);

-- Journal : connexion, reconnexion, renouvellement en échec, révocation, modification du client, lecture de jetons
-- (une ligne par jour et module) ; jamais de valeur secrète.
CREATE TABLE IF NOT EXISTS oauth_journal (
    ojo_id         BIGSERIAL    PRIMARY KEY,
    ojo_oco_id     BIGINT       REFERENCES oauth_connexion(oco_id) ON DELETE SET NULL,
    ojo_evenement  VARCHAR(30)  NOT NULL,
    ojo_detail     VARCHAR(500),
    ojo_utilisateur VARCHAR(50),
    ojo_le         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ojo_connexion ON oauth_journal (ojo_oco_id, ojo_le DESC);

-- Demandes d'autorisation en cours (flux par code + PKCE) : state à usage unique, vérificateur chiffré, 10 minutes.
CREATE TABLE IF NOT EXISTS oauth_autorisation (
    oau_state       VARCHAR(100) PRIMARY KEY,
    oau_oco_id      BIGINT       NOT NULL REFERENCES oauth_connexion(oco_id) ON DELETE CASCADE,
    oau_verificateur TEXT        NOT NULL,
    oau_utilisateur VARCHAR(50)  NOT NULL,
    oau_origine     VARCHAR(200) NOT NULL,       -- adresse de l'application de la société (retour de la fenêtre)
    oau_autre_compte BOOLEAN     NOT NULL DEFAULT FALSE, -- reconnexion confirmée avec un compte différent du précédent
    oau_expire_le   TIMESTAMPTZ  NOT NULL
);
