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

-- Paramétrage d'une borne (rejouable) : salariés proposés filtrés par services (service principal ou service parent)
-- et par fonctions (poste du salarié, fourni par l'application), types de main-d'œuvre proposés ; vide = tous.
-- L'ancien service unique (pap_service) est repris dans pap_services puis retiré.
ALTER TABLE poi_appareil ADD COLUMN IF NOT EXISTS pap_services  INT[];
ALTER TABLE poi_appareil ADD COLUMN IF NOT EXISTS pap_fonctions TEXT[];
ALTER TABLE poi_appareil ADD COLUMN IF NOT EXISTS pap_types_mo  INT[];
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'poi_appareil' AND column_name = 'pap_service') THEN
        UPDATE poi_appareil SET pap_services = ARRAY[pap_service] WHERE pap_service IS NOT NULL AND pap_services IS NULL;
        ALTER TABLE poi_appareil DROP COLUMN pap_service;
    END IF;
END $$;
