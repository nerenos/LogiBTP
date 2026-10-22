-- =============================================================================
-- Module Pointage, lot 4 : bornes d'atelier (appareils enregistrés par un administrateur : jeton haché, service,
-- PIN exigé ou non), PIN des salariés (haché, essais limités), saisie par équipe (poi_groupe des pointages créés
-- ensemble, lot 1). La borne n'ouvre pas de session utilisateur (M8). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS poi_appareil (
    pap_id          SERIAL PRIMARY KEY,
    pap_libelle     VARCHAR(80) NOT NULL,
    pap_jeton_hache VARCHAR(64) NOT NULL UNIQUE,
    pap_service     INT,
    pap_pin_exige   BOOLEAN     NOT NULL DEFAULT TRUE,
    pap_actif       BOOLEAN     NOT NULL DEFAULT TRUE,
    pap_cree_par    VARCHAR(50) NOT NULL,
    pap_cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
    pap_vu_le       TIMESTAMPTZ
);
COMMENT ON COLUMN poi_appareil.pap_jeton_hache IS 'SHA-256 du jeton remis une fois à l''enregistrement (en-tête X-Borne-Jeton)';

CREATE TABLE IF NOT EXISTS poi_pin (
    ppn_sal_id       INT PRIMARY KEY,
    ppn_hache        VARCHAR(200) NOT NULL,
    ppn_essais       SMALLINT     NOT NULL DEFAULT 0,
    ppn_bloque_jusqu TIMESTAMPTZ,
    ppn_maj_par      VARCHAR(50)  NOT NULL,
    ppn_maj_le       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
