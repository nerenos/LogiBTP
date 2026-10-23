-- Module Exécution LogiBTP – étapes des ordres (ANALYSE-MODULE-EXECUTION.md § 13, E25 à E50) : catalogue des états
-- (global à la base : nature pour le planning, durée par défaut, service), états d'un type d'ordre (ordre, date
-- obligatoire, contrôle du N+1, statut documentaire déclenché), états des étapes de parcours (modèle et élément), étapes
-- d'un ordre (copie modifiable : dates prévisionnelles, validation, contrôle, ressource). Un type d'ordre est un code
-- fourni par l'application, un ordre un identifiant ; aucune clé étrangère vers l'application. Rejouable.

CREATE TABLE IF NOT EXISTS exe_etat_catalogue (
    etc_code         VARCHAR(30)   PRIMARY KEY,
    etc_libelle      VARCHAR(100)  NOT NULL,
    etc_couleur      VARCHAR(9),
    etc_nature       VARCHAR(8)    NOT NULL DEFAULT 'TACHE' CHECK (etc_nature IN ('TACHE', 'JALON', 'ATTENTE')),
    etc_duree        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (etc_duree >= 0),
    etc_unite        VARCHAR(3)    NOT NULL DEFAULT 'OUV' CHECK (etc_unite IN ('H', 'OUV', 'CAL')),
    etc_srv_id       INT,
    etc_ordre        INT           NOT NULL DEFAULT 0,
    etc_actif        BOOLEAN       NOT NULL DEFAULT TRUE,
    etc_maj_par      VARCHAR(50),
    etc_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- États d'un type d'ordre, dans l'ordre ; amonts NULL : l'état précédent (états parallèles par des amonts, E29).
CREATE TABLE IF NOT EXISTS exe_etat_type (
    ett_type_ordre        VARCHAR(20)   NOT NULL,
    ett_etc_code          VARCHAR(30)   NOT NULL REFERENCES exe_etat_catalogue(etc_code) ON UPDATE CASCADE,
    ett_ordre             INT           NOT NULL DEFAULT 0,
    ett_date_obligatoire  BOOLEAN       NOT NULL DEFAULT FALSE,
    ett_controle          BOOLEAN       NOT NULL DEFAULT FALSE,
    ett_controle_bloquant BOOLEAN       NOT NULL DEFAULT TRUE,
    ett_statut_document   VARCHAR(20)   CHECK (ett_statut_document IS NULL OR ett_statut_document IN ('ENVOYE', 'VALIDE')),
    ett_amonts            TEXT[],
    ett_duree             NUMERIC(10,2) CHECK (ett_duree IS NULL OR ett_duree >= 0),
    PRIMARY KEY (ett_type_ordre, ett_etc_code)
);

-- États retenus par une étape de parcours (E27) : [{ "code": "ETUDE", "duree": 5 }] dans l'ordre ; vide = ceux du type.
ALTER TABLE exe_parcours_etape ADD COLUMN IF NOT EXISTS pae_etats JSONB NOT NULL DEFAULT '[]';
ALTER TABLE exe_parcours_element_etape ADD COLUMN IF NOT EXISTS pee_etats JSONB NOT NULL DEFAULT '[]';

-- Étapes d'un ordre : copie des états de son type (ou de son étape de parcours) à sa création, modifiable.
CREATE TABLE IF NOT EXISTS exe_ordre_etape (
    ore_id                   BIGSERIAL     PRIMARY KEY,
    ore_ordre_id             BIGINT        NOT NULL,
    ore_code                 VARCHAR(30)   NOT NULL,
    ore_libelle              VARCHAR(100)  NOT NULL,
    ore_couleur              VARCHAR(9),
    ore_nature               VARCHAR(8)    NOT NULL DEFAULT 'TACHE' CHECK (ore_nature IN ('TACHE', 'JALON', 'ATTENTE')),
    ore_duree                NUMERIC(10,2) NOT NULL DEFAULT 0,
    ore_unite                VARCHAR(3)    NOT NULL DEFAULT 'OUV' CHECK (ore_unite IN ('H', 'OUV', 'CAL')),
    ore_srv_id               INT,
    ore_amonts               TEXT[],
    ore_ordre                INT           NOT NULL DEFAULT 0,
    ore_date_obligatoire     BOOLEAN       NOT NULL DEFAULT FALSE,
    ore_controle             BOOLEAN       NOT NULL DEFAULT FALSE,
    ore_controle_bloquant    BOOLEAN       NOT NULL DEFAULT TRUE,
    ore_statut_document      VARCHAR(20),
    ore_debut_le             DATE,
    ore_prevu_le             DATE,
    ore_prevu_impose         BOOLEAN       NOT NULL DEFAULT FALSE,
    ore_valide_le            DATE,
    ore_valide_par           VARCHAR(50),
    ore_controle_le          DATE,
    ore_controle_par         VARCHAR(50),
    ore_commentaire          TEXT,
    ore_ressource            JSONB,
    ore_tac_id               BIGINT,
    ore_maj_le               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (ore_ordre_id, ore_code)
);
CREATE INDEX IF NOT EXISTS ix_ore_prevu ON exe_ordre_etape (ore_prevu_le) WHERE ore_valide_le IS NULL;
