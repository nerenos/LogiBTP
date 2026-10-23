-- Module Mail : comptes de messagerie système (SMTP / IMAP), envoi par file d'attente avec limitations et journal.
-- Analyse : documentation/conception/ANALYSE-MODULE-MAIL.md. Rejouable.
-- L'identité (adresse, nom affiché) et la connexion (serveurs, identifiant, mot de passe) d'un compte sont chiffrées par
-- l'application (« chiffre:v1: » du socle) ; l'application désigne un compte par ses alias (mail_alias).

CREATE TABLE IF NOT EXISTS mail_compte (
    mco_id                 BIGSERIAL     PRIMARY KEY,
    mco_code               VARCHAR(30)   NOT NULL UNIQUE,
    mco_identite           TEXT          NOT NULL,                     -- chiffré : { adresse, nom_affiche }
    mco_adresse_empreinte  CHAR(64)      NOT NULL UNIQUE,              -- HMAC de l'adresse (doublons, reconnaissance de nos boîtes)
    mco_genre              VARCHAR(15)   NOT NULL DEFAULT 'SYSTEME' CHECK (mco_genre IN ('SYSTEME', 'UTILISATEUR')),
    mco_compte_utilisateur VARCHAR(50),                                -- second temps : boîte d'un utilisateur
    mco_envoi              BOOLEAN       NOT NULL DEFAULT TRUE,
    mco_reception          BOOLEAN       NOT NULL DEFAULT FALSE,
    mco_authentification   VARCHAR(15)   NOT NULL DEFAULT 'MOT_DE_PASSE' CHECK (mco_authentification IN ('MOT_DE_PASSE', 'OAUTH2')),
    mco_connexion          TEXT          NOT NULL,                     -- chiffré : { smtp: { hote, port, securite, identifiant, mot_de_passe }, imap: { … } }
    mco_oco_id             BIGINT,                                     -- connexion du module OAuth (clé étrangère posée par le cœur)
    mco_repondre_a_mco_id  BIGINT        REFERENCES mail_compte(mco_id) ON DELETE SET NULL,
    mco_signature_html     TEXT,
    mco_hebergeur          VARCHAR(15)   NOT NULL DEFAULT 'AUTRE' CHECK (mco_hebergeur IN ('GMAIL', 'OVH', 'AUTRE')),
    mco_limites            JSONB         NOT NULL DEFAULT '{}',        -- limitations d'envoi (défauts de l'hébergeur complétés)
    mco_copie_envoyes      BOOLEAN       NOT NULL DEFAULT TRUE,        -- copie des envois dans « Envoyés » (IMAP)
    mco_dossiers           JSONB         NOT NULL DEFAULT '[]',        -- lot 3 : dossiers relevés et rôles
    mco_options            JSONB         NOT NULL DEFAULT '{}',        -- lot 3 : marquer lus, après rattachement, intervalle de relève
    mco_services           TEXT[]        NOT NULL DEFAULT '{}',        -- services qui voient la boîte (vide : administrateurs)
    mco_actif              BOOLEAN       NOT NULL DEFAULT TRUE,
    mco_etat               VARCHAR(15)   NOT NULL DEFAULT 'A_VERIFIER' CHECK (mco_etat IN ('A_VERIFIER', 'OK', 'ERREUR', 'SUSPENDU')),
    mco_derniere_erreur    VARCHAR(500),
    mco_verifie_le         TIMESTAMPTZ,
    mco_suspendu_le        TIMESTAMPTZ,
    mco_cree_par           VARCHAR(50)   NOT NULL DEFAULT 'demo',
    mco_cree_le            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    mco_maj_par            VARCHAR(50),
    mco_maj_le             TIMESTAMPTZ
);

-- Table de correspondance : nom d'un compte dans l'application (jamais l'adresse) ; un alias principal par compte.
CREATE TABLE IF NOT EXISTS mail_alias (
    mal_id        BIGSERIAL     PRIMARY KEY,
    mal_nom       VARCHAR(80)   NOT NULL UNIQUE,
    mal_mco_id    BIGINT        NOT NULL REFERENCES mail_compte(mco_id) ON DELETE CASCADE,
    mal_principal BOOLEAN       NOT NULL DEFAULT FALSE,
    mal_actif     BOOLEAN       NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mal_principal ON mail_alias (mal_mco_id) WHERE mal_principal;

-- Usages : quel alias pour quel envoi (surcharge par type d'élément, ex. type de document, ou par service).
CREATE TABLE IF NOT EXISTS mail_usage (
    mus_id       BIGSERIAL    PRIMARY KEY,
    mus_usage    VARCHAR(30)  NOT NULL,          -- NOTIFICATION, AUTHENTIFICATION, DOCUMENT_VENTE, DOCUMENT_ACHAT, RELANCE, SAV, PAIE, CRM…
    mus_portee   VARCHAR(50)  NOT NULL DEFAULT '', -- vide : défaut ; « type:<code> » ou « service:<code> »
    mus_mal_id   BIGINT       NOT NULL REFERENCES mail_alias(mal_id) ON DELETE CASCADE,
    UNIQUE (mus_usage, mus_portee)
);

-- Modèles d'objet et de corps (HTML à variables {{…}}) par usage et type d'élément ; un par défaut par couple.
CREATE TABLE IF NOT EXISTS mail_modele (
    mmo_id         BIGSERIAL     PRIMARY KEY,
    mmo_code       VARCHAR(30)   NOT NULL UNIQUE,
    mmo_libelle    VARCHAR(100)  NOT NULL,
    mmo_usage      VARCHAR(30)   NOT NULL,
    mmo_type       VARCHAR(50)   NOT NULL DEFAULT '',   -- type d'élément (code du type de document…), vide : tous
    mmo_objet      VARCHAR(300)  NOT NULL,
    mmo_corps_html TEXT          NOT NULL,
    mmo_defaut     BOOLEAN       NOT NULL DEFAULT FALSE,
    mmo_actif      BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Envois groupés (une action qui produit plusieurs messages).
CREATE TABLE IF NOT EXISTS mail_lot (
    mlo_id            BIGSERIAL    PRIMARY KEY,
    mlo_origine       VARCHAR(50)  NOT NULL,
    mlo_libelle       VARCHAR(200),
    mlo_auteur        VARCHAR(50)  NOT NULL,
    mlo_messages      INT          NOT NULL DEFAULT 0,
    mlo_destinataires INT          NOT NULL DEFAULT 0,
    mlo_envoyes       INT          NOT NULL DEFAULT 0,
    mlo_erreurs       INT          NOT NULL DEFAULT 0,
    mlo_fin_estimee   TIMESTAMPTZ,
    mlo_avertissement VARCHAR(500),                     -- texte de l'avertissement accepté
    mlo_accepte_par   VARCHAR(50),
    mlo_accepte_le    TIMESTAMPTZ,
    mlo_cree_le       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_message (
    mme_id             BIGSERIAL     PRIMARY KEY,
    mme_mco_id         BIGINT        NOT NULL REFERENCES mail_compte(mco_id),
    mme_mal_id         BIGINT        REFERENCES mail_alias(mal_id) ON DELETE SET NULL,
    mme_expediteur     VARCHAR(80),                                   -- nom de l'alias au moment de l'envoi
    mme_sens           CHAR(1)       NOT NULL CHECK (mme_sens IN ('E', 'R')),
    mme_etat           VARCHAR(15)   NOT NULL CHECK (mme_etat IN ('BROUILLON', 'A_ENVOYER', 'EN_COURS', 'ENVOYE', 'ERREUR', 'ANNULE', 'SUSPENDU',
                                                                  'RECU', 'RAPPROCHE', 'A_RAPPROCHER', 'PROPOSE', 'IGNORE')),
    mme_priorite       VARCHAR(10)   NOT NULL DEFAULT 'NORMALE' CHECK (mme_priorite IN ('HAUTE', 'NORMALE', 'BASSE')),
    mme_mlo_id         BIGINT        REFERENCES mail_lot(mlo_id) ON DELETE SET NULL,
    mme_usage          VARCHAR(30),
    mme_type_element   VARCHAR(50),
    mme_id_element     VARCHAR(50),
    mme_message_id     VARCHAR(300),
    mme_in_reply_to    VARCHAR(300),
    mme_references     TEXT,
    mme_objet          VARCHAR(500)  NOT NULL DEFAULT '',
    mme_de             VARCHAR(300),                                  -- reçu : expéditeur ; envoyé : vide (alias)
    mme_corps_html     TEXT,
    mme_extrait        VARCHAR(500),
    mme_date           TIMESTAMPTZ,
    mme_empreinte      CHAR(64),                                      -- SHA-256 du .eml
    mme_dge_id         BIGINT,                                        -- document GED du courriel (posé par le cœur)
    mme_uid            BIGINT,
    mme_dossier        VARCHAR(200),
    mme_tentatives     INT           NOT NULL DEFAULT 0,
    mme_prochain_essai TIMESTAMPTZ,
    mme_attente        VARCHAR(200),                                  -- cause de l'attente : limite, connexion, file
    mme_erreur         VARCHAR(1000),
    mme_auto           BOOLEAN       NOT NULL DEFAULT FALSE,
    mme_copie_moi      BOOLEAN       NOT NULL DEFAULT FALSE,
    mme_cree_par       VARCHAR(50)   NOT NULL,
    mme_cree_le        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    mme_envoye_le      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_mme_file ON mail_message (mme_mco_id, mme_prochain_essai) WHERE mme_etat = 'A_ENVOYER';
CREATE INDEX IF NOT EXISTS ix_mme_element ON mail_message (mme_type_element, mme_id_element);
CREATE INDEX IF NOT EXISTS ix_mme_message_id ON mail_message (mme_message_id);

CREATE TABLE IF NOT EXISTS mail_destinataire (
    mde_id       BIGSERIAL     PRIMARY KEY,
    mde_mme_id   BIGINT        NOT NULL REFERENCES mail_message(mme_id) ON DELETE CASCADE,
    mde_role     VARCHAR(3)    NOT NULL CHECK (mde_role IN ('DE', 'A', 'CC', 'CCI')),
    mde_adresse  VARCHAR(300)  NOT NULL,
    mde_nom      VARCHAR(200),
    mde_per_id   BIGINT,
    mde_ind_id   BIGINT,
    mde_non_remis VARCHAR(500)                                         -- cause de la non-remise (avis rapproché)
);
CREATE INDEX IF NOT EXISTS ix_mde_message ON mail_destinataire (mde_mme_id);

-- Pièces d'un envoi : référence fournie par l'application (« ged:<id> »), contenu lu au moment de l'envoi.
CREATE TABLE IF NOT EXISTS mail_piece (
    mpi_id         BIGSERIAL     PRIMARY KEY,
    mpi_mme_id     BIGINT        NOT NULL REFERENCES mail_message(mme_id) ON DELETE CASCADE,
    mpi_reference  VARCHAR(100)  NOT NULL,
    mpi_nom        VARCHAR(300)  NOT NULL,
    mpi_type       VARCHAR(150),
    mpi_taille     BIGINT        NOT NULL DEFAULT 0
);

-- Rattachements d'un message à des éléments de l'application.
CREATE TABLE IF NOT EXISTS mail_lien (
    mli_id           BIGSERIAL     PRIMARY KEY,
    mli_mme_id       BIGINT        NOT NULL REFERENCES mail_message(mme_id) ON DELETE CASCADE,
    mli_type_element VARCHAR(50)   NOT NULL,
    mli_id_element   VARCHAR(50)   NOT NULL,
    mli_origine      VARCHAR(10)   NOT NULL CHECK (mli_origine IN ('ENVOI', 'FIL', 'REGLE', 'MANUEL')),
    mli_score        INT,
    mli_regle        VARCHAR(50),
    mli_par          VARCHAR(50)   NOT NULL,
    mli_le           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    mli_retire_le    TIMESTAMPTZ,
    mli_retire_par   VARCHAR(50),
    UNIQUE (mli_mme_id, mli_type_element, mli_id_element)
);
CREATE INDEX IF NOT EXISTS ix_mli_element ON mail_lien (mli_type_element, mli_id_element) WHERE mli_retire_le IS NULL;

-- Journal des envois : une ligne par tentative ; source des compteurs des limitations (destinataires de chaque courriel).
CREATE TABLE IF NOT EXISTS mail_journal (
    mjo_id            BIGSERIAL     PRIMARY KEY,
    mjo_mme_id        BIGINT        REFERENCES mail_message(mme_id) ON DELETE SET NULL,
    mjo_mlo_id        BIGINT,
    mjo_mco_id        BIGINT        NOT NULL REFERENCES mail_compte(mco_id) ON DELETE CASCADE,
    mjo_alias         VARCHAR(80),
    mjo_utilisateur   VARCHAR(50)   NOT NULL,
    mjo_origine       VARCHAR(100),
    mjo_destinataires INT           NOT NULL DEFAULT 0,
    mjo_nouveaux      INT           NOT NULL DEFAULT 0,      -- destinataires jamais écrits par ce compte
    mjo_domaines      TEXT[]        NOT NULL DEFAULT '{}',
    mjo_adresses      TEXT[]        NOT NULL DEFAULT '{}',   -- preuve d'envoi (destinataires seulement)
    mjo_taille        BIGINT        NOT NULL DEFAULT 0,
    mjo_resultat      VARCHAR(10)   NOT NULL CHECK (mjo_resultat IN ('OK', 'ECHEC', 'REPORT')),
    mjo_code          VARCHAR(20),
    mjo_reponse       VARCHAR(1000),
    mjo_duree_ms      INT,
    mjo_le            TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mjo_compte ON mail_journal (mjo_mco_id, mjo_le DESC);

CREATE TABLE IF NOT EXISTS mail_parametre (
    mpa_cle    VARCHAR(50) PRIMARY KEY,
    mpa_valeur JSONB       NOT NULL
);
INSERT INTO mail_parametre (mpa_cle, mpa_valeur) VALUES
 ('seuil_envoi_groupe', '50'),            -- confirmation au-delà de ce nombre de destinataires
 ('seuil_quota_pct', '80'),               -- avertissement à ce pourcentage du quota journalier
 ('seuil_non_remise_pct', '5'),           -- suspension des envois groupés au-delà (sur une heure)
 ('seuil_utilisateur_heure', '100'),      -- volume inhabituel d'un utilisateur (courriels par heure)
 ('reserve_prioritaire_pct', '20'),       -- part du quota réservée aux priorités haute et normale
 ('taille_max_mo', '20'),                 -- pièces jointes d'un courriel
 ('journal_mois', '13')
ON CONFLICT (mpa_cle) DO NOTHING;
