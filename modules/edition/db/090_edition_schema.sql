-- =============================================================================
-- Module Édition – modèles d'édition, blocs réutilisables, chartes graphiques, modèles par défaut (Q16).
-- Les modèles sont du JSON versionné (format décrit dans modules/edition/js/src/modele.js) ; le moteur d'édition
-- (même script JS dans le navigateur et dans Jint) les lit tels quels. Rejouable (IF NOT EXISTS).
-- =============================================================================

-- Charte graphique : couleurs, styles de texte, traits, marges nommés (Q11). Une charte par défaut.
CREATE TABLE IF NOT EXISTS charte_edition (
    che_code        VARCHAR(50)   PRIMARY KEY,
    che_libelle     VARCHAR(200)  NOT NULL,
    che_contenu     JSONB         NOT NULL DEFAULT '{}'::jsonb,
    che_defaut      BOOLEAN       NOT NULL DEFAULT FALSE,
    che_modifie_le  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    che_modifie_par VARCHAR(50)   NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_che_defaut ON charte_edition (che_defaut) WHERE che_defaut;

-- Modèle d'édition : rapport (édition complète) ou bloc (morceau réutilisable, lié ou copié).
--   med_cible : DOCUMENT, FICHE, LISTE, VUE (rapport) ; NULL pour un bloc.
--   med_types : types concernés (codes de type de document, types de fiche, thèmes de liste) ; vide = tous.
--   med_niveau_acces : confidentialité de la GED (PUBLIC, INTERNE, CONFIDENTIEL, SECRET) reprise par les PDF déposés ;
--   med_acces_profils : profils autorisés en plus (vide = tous selon le niveau) (Q18, § 3.12).
--   med_fourni : modèle livré par l'application (réécrit par les mises à jour tant qu'il n'est pas modifié localement).
CREATE TABLE IF NOT EXISTS modele_edition (
    med_id            BIGSERIAL     PRIMARY KEY,
    med_code          VARCHAR(80)   NOT NULL UNIQUE,
    med_libelle       VARCHAR(200)  NOT NULL,
    med_genre         VARCHAR(10)   NOT NULL DEFAULT 'RAPPORT' CHECK (med_genre IN ('RAPPORT', 'BLOC')),
    med_cible         VARCHAR(20)   CHECK (med_cible IN ('DOCUMENT', 'FICHE', 'LISTE', 'VUE')),
    med_source        VARCHAR(50),
    med_types         TEXT[]        NOT NULL DEFAULT '{}',
    med_contenu       JSONB         NOT NULL,
    med_version       INTEGER       NOT NULL DEFAULT 1,
    med_niveau_acces  VARCHAR(20)   NOT NULL DEFAULT 'INTERNE' CHECK (med_niveau_acces IN ('PUBLIC', 'INTERNE', 'CONFIDENTIEL', 'SECRET')),
    med_acces_profils TEXT[]        NOT NULL DEFAULT '{}',
    med_charte        VARCHAR(50)   REFERENCES charte_edition (che_code),
    med_ordre         INTEGER       NOT NULL DEFAULT 0,
    med_fourni        BOOLEAN       NOT NULL DEFAULT FALSE,
    med_modifie_local BOOLEAN       NOT NULL DEFAULT FALSE,
    med_actif         BOOLEAN       NOT NULL DEFAULT TRUE,
    med_cree_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    med_cree_par      VARCHAR(50)   NOT NULL DEFAULT '',
    med_modifie_le    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    med_modifie_par   VARCHAR(50)   NOT NULL DEFAULT '',
    CONSTRAINT ck_med_cible CHECK ((med_genre = 'BLOC') = (med_cible IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_med_cible ON modele_edition (med_cible, med_source) WHERE med_actif;

-- Versions précédentes du contenu d'un modèle (historique par déclencheur, comme les prix de la bibliothèque).
CREATE TABLE IF NOT EXISTS modele_edition_version (
    mev_id       BIGSERIAL    PRIMARY KEY,
    mev_med_id   BIGINT       NOT NULL REFERENCES modele_edition (med_id) ON DELETE CASCADE,
    mev_version  INTEGER      NOT NULL,
    mev_contenu  JSONB        NOT NULL,
    mev_le       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    mev_par      VARCHAR(50)  NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_mev_modele ON modele_edition_version (mev_med_id, mev_version);

CREATE OR REPLACE FUNCTION fn_modele_edition_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.med_contenu IS DISTINCT FROM OLD.med_contenu THEN
        INSERT INTO modele_edition_version (mev_med_id, mev_version, mev_contenu, mev_le, mev_par)
        VALUES (OLD.med_id, OLD.med_version, OLD.med_contenu, OLD.med_modifie_le, OLD.med_modifie_par);
        NEW.med_version := OLD.med_version + 1;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_modele_edition_version ON modele_edition;
CREATE TRIGGER tr_modele_edition_version BEFORE UPDATE ON modele_edition FOR EACH ROW EXECUTE FUNCTION fn_modele_edition_version();

-- Dépendances d'un modèle (graphe : blocs liés, sous-rapports, ressources images) : tenues par le service à chaque
-- enregistrement ; servent au refus des cycles, au refus de supprimer un bloc utilisé et à la liste des rapports
-- impactés par une modification (§ 3.6, Q5).
CREATE TABLE IF NOT EXISTS modele_edition_lien (
    mel_med_id  BIGINT       NOT NULL REFERENCES modele_edition (med_id) ON DELETE CASCADE,
    mel_genre   VARCHAR(10)  NOT NULL CHECK (mel_genre IN ('BLOC', 'RAPPORT', 'RESSOURCE')),
    mel_code    VARCHAR(80)  NOT NULL,
    PRIMARY KEY (mel_med_id, mel_genre, mel_code)
);
CREATE INDEX IF NOT EXISTS ix_mel_code ON modele_edition_lien (mel_genre, mel_code);

-- Modèle par défaut d'un type (Q12, Q13) : cible + type (code de type de document, type de fiche, thème de liste).
CREATE TABLE IF NOT EXISTS modele_edition_defaut (
    mdd_cible   VARCHAR(20)  NOT NULL,
    mdd_type    VARCHAR(80)  NOT NULL,
    mdd_med_id  BIGINT       NOT NULL REFERENCES modele_edition (med_id) ON DELETE CASCADE,
    PRIMARY KEY (mdd_cible, mdd_type)
);
