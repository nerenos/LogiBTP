-- Module Authentification LogiBTP – comptes, sessions, journal des connexions, paramètres (ANALYSE-MODULE-AUTHENTIFICATION.md,
-- lot 0). Sans clé étrangère vers l'application : la personne liée à un compte est un couple (type_element, id_element)
-- décrit par la spécialisation (le cœur : individu d'un salarié ou d'un intérimaire). Aucun compte de personne par
-- défaut (A3) ; seuls les comptes de service nommés (profil SERVICE, sans connexion interactive, A12). Rejouable.

-- Paramètres de la société (une ligne par clé, valeur JSON).
CREATE TABLE IF NOT EXISTS parametre_authentification (
    pau_cle        VARCHAR(40)   PRIMARY KEY,
    pau_valeur     JSONB         NOT NULL,
    pau_maj_par    VARCHAR(50),
    pau_maj_le     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

INSERT INTO parametre_authentification (pau_cle, pau_valeur) VALUES
 -- Session : inactivité maximale (heures) ; « Rester connecté » : durée maximale (jours) ; réglables par société (A6).
 ('session', '{"inactivite_heures": 10, "rester_connecte_jours": 7, "rester_connecte": true}'),
 -- Verrouillage temporaire après N échecs consécutifs.
 ('verrouillage', '{"echecs": 5, "minutes": 15}'),
 -- Politique de mot de passe : longueur minimale, refus des plus courants (comparaison sans casse).
 ('mot_de_passe', '{"longueur_min": 12, "courants": ["123456789012", "1234567890123", "azertyuiopqs", "azertyuiop123", "qwertyuiop123",
   "motdepasse123", "motdepasse1234", "password1234", "password12345", "passwordpassword", "000000000000", "111111111111",
   "azerty123456", "azertyazerty", "soleil123456", "bonjour123456", "iloveyou1234", "changeme1234", "administrateur", "logibtp12345",
   "logibtplogibtp", "btpbtpbtpbtp", "chantier1234", "abcdefghijkl", "abc123abc123", "qwerty123456", "welcome12345", "letmein12345"]}'),
 -- Pseudos réservés, refusés à la création d'un compte de personne (A13).
 ('pseudos_reserves', '["demo", "admin", "administrateur", "administrator", "system", "systeme", "root", "service", "test", "invite", "guest", "anonyme", "support"]')
ON CONFLICT (pau_cle) DO NOTHING;

-- Compte : pseudo unique (sans casse), type PERSONNE (lié à un élément, ou administrateur de l'installation sans
-- élément) ou SERVICE (tâches de fond, jamais de connexion interactive), profil unique (A2).
CREATE TABLE IF NOT EXISTS compte (
    cpt_id                   BIGSERIAL     PRIMARY KEY,
    cpt_code                 VARCHAR(50)   NOT NULL,
    cpt_type                 VARCHAR(10)   NOT NULL DEFAULT 'PERSONNE' CHECK (cpt_type IN ('PERSONNE', 'SERVICE')),
    cpt_libelle              VARCHAR(120),
    cpt_type_element         VARCHAR(30),
    cpt_id_element           VARCHAR(50),
    cpt_hash                 TEXT,
    cpt_mdp_provisoire       BOOLEAN       NOT NULL DEFAULT FALSE,
    cpt_profil               VARCHAR(30)   NOT NULL DEFAULT 'SAISIE',
    cpt_actif                BOOLEAN       NOT NULL DEFAULT TRUE,
    cpt_valide_jusqu_au      DATE,
    cpt_echecs               INT           NOT NULL DEFAULT 0,
    cpt_verrouille_jusqu_au  TIMESTAMPTZ,
    cpt_derniere_connexion   TIMESTAMPTZ,
    cpt_cree_par             VARCHAR(50)   NOT NULL,
    cpt_cree_le              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    cpt_maj_par              VARCHAR(50),
    cpt_maj_le               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_cpt_service CHECK (cpt_type = 'PERSONNE' OR (cpt_hash IS NULL AND cpt_type_element IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cpt_code ON compte (lower(cpt_code));
-- Une personne liée n'a qu'un compte.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cpt_element ON compte (cpt_type_element, cpt_id_element) WHERE cpt_type_element IS NOT NULL;

-- Sessions : jeton aléatoire du cookie, jamais conservé en clair (empreinte SHA-256).
CREATE TABLE IF NOT EXISTS session_utilisateur (
    ses_id           BIGSERIAL     PRIMARY KEY,
    ses_jeton_hache  VARCHAR(64)   NOT NULL UNIQUE,
    ses_cpt_id       BIGINT        NOT NULL REFERENCES compte(cpt_id) ON DELETE CASCADE,
    ses_cree_le      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ses_vu_le        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ses_expire_le    TIMESTAMPTZ   NOT NULL,
    ses_persistante  BOOLEAN       NOT NULL DEFAULT FALSE,
    ses_adresse      VARCHAR(64),
    ses_navigateur   VARCHAR(300),
    ses_fermee_le    TIMESTAMPTZ
);
-- Session de test (développement, sans mot de passe) : jamais soumise au changement du mot de passe provisoire.
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_test BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS ix_ses_compte ON session_utilisateur (ses_cpt_id) WHERE ses_fermee_le IS NULL;

-- Journal des connexions (réussies, échouées, verrouillages, déconnexions, mots de passe).
CREATE TABLE IF NOT EXISTS journal_connexion (
    jco_id          BIGSERIAL     PRIMARY KEY,
    jco_code        VARCHAR(50)   NOT NULL,
    jco_evenement   VARCHAR(20)   NOT NULL CHECK (jco_evenement IN ('CONNEXION', 'ECHEC', 'VERROUILLAGE', 'DECONNEXION', 'MDP_CHANGE',
                                                                    'MDP_REINITIALISE', 'EXPIRE', 'REFUS', 'DEVERROUILLAGE', 'COMPTE')),
    jco_detail      VARCHAR(200),
    jco_le          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    jco_adresse     VARCHAR(64),
    jco_navigateur  VARCHAR(300),
    jco_par         VARCHAR(50)
);
CREATE INDEX IF NOT EXISTS ix_jco_code ON journal_connexion (lower(jco_code), jco_le DESC);

-- Comptes de service nommés (A12) : tâches de fond, chacun tracé sous son propre code.
INSERT INTO compte (cpt_code, cpt_type, cpt_libelle, cpt_profil, cpt_cree_par) VALUES
 ('archivage_ged', 'SERVICE', 'Archivage automatique de la GED', 'SERVICE', 'installation'),
 ('editions_fond', 'SERVICE', 'Éditions produites en fond', 'SERVICE', 'installation')
ON CONFLICT DO NOTHING;
