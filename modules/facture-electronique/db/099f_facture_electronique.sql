-- =============================================================================
-- Module Facturation électronique, lot 8 (plans/facturation-electronique.md) : paramètres de la société, flux émis et
-- reçus (file avec reprises), fichiers, statuts du cycle de vie, erreurs, journal des étapes chaîné, curseurs de relève,
-- état de la plateforme simulée et du dépôt manuel. Rejouable.
--
-- Sans métier : le module ne connaît ni les pièces, ni les tiers ; l'élément lié à un flux (ffl_type_element,
-- ffl_id_element), les documents de la GED (*_ged_*_id) et la connexion OAuth (fpa_connexion_oauth) sont des
-- identifiants de l'application, sans clé étrangère. Codes : Codes.cs ↔ js/src/codes.js (EtatFlux, EvenementFe,
-- ActeurFe, SensStatut, SensFlux, TypeFlux, Syntaxe, ProfilFacture, EtatAccuse, DecoupageEreporting).
-- Journal fe_evenement : ajout seul (UPDATE, DELETE et TRUNCATE refusés, comme le coffre de la GED), chaîné par
-- empreinte (JournalFe.cs recalcule la chaîne : même texte que fn_fe_evenement_chainer).
-- =============================================================================

-- Paramètres de la société (une ligne) : connecteur (ConnecteurFe ou code d'une PA), connexion OAuth, adresses du Flow
-- Service et du Directory Service, Organization-Id, adresse électronique de la société (BT-34 / BT-49), format et
-- profil par défaut, fréquence de relève (minutes), découpage de l'e-reporting (Q20).
CREATE TABLE IF NOT EXISTS fe_parametre (
    fpa_id                  SMALLINT     PRIMARY KEY DEFAULT 1,
    fpa_actif               BOOLEAN      NOT NULL DEFAULT FALSE,
    fpa_connecteur          VARCHAR(30)  NOT NULL DEFAULT 'MANUEL',
    fpa_connexion_oauth     BIGINT,
    fpa_adresse_flux        VARCHAR(500),
    fpa_adresse_annuaire    VARCHAR(500),
    fpa_organisation        VARCHAR(64),
    fpa_adresse_electronique VARCHAR(255),
    fpa_schema_adresse      VARCHAR(10)  NOT NULL DEFAULT '0225',
    fpa_syntaxe             VARCHAR(20)  NOT NULL DEFAULT 'Factur-X',
    fpa_profil              VARCHAR(20)  NOT NULL DEFAULT 'CIUS',
    fpa_frequence_releve    INT          NOT NULL DEFAULT 15,
    fpa_delai_secondes      INT          NOT NULL DEFAULT 100,
    fpa_decoupage_ereporting VARCHAR(20) NOT NULL DEFAULT 'UNIQUE',
    fpa_modifie_le          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    fpa_modifie_par         VARCHAR(50)  NOT NULL DEFAULT ''
);
ALTER TABLE fe_parametre DROP CONSTRAINT IF EXISTS fe_parametre_unique_check;
ALTER TABLE fe_parametre ADD CONSTRAINT fe_parametre_unique_check CHECK (fpa_id = 1);
ALTER TABLE fe_parametre DROP CONSTRAINT IF EXISTS fe_parametre_syntaxe_check;
ALTER TABLE fe_parametre ADD CONSTRAINT fe_parametre_syntaxe_check CHECK (fpa_syntaxe IN ('CII','UBL','Factur-X'));
ALTER TABLE fe_parametre DROP CONSTRAINT IF EXISTS fe_parametre_profil_check;
ALTER TABLE fe_parametre ADD CONSTRAINT fe_parametre_profil_check CHECK (fpa_profil IN ('Basic','CIUS','Extended-CTC-FR'));
ALTER TABLE fe_parametre DROP CONSTRAINT IF EXISTS fe_parametre_releve_check;
ALTER TABLE fe_parametre ADD CONSTRAINT fe_parametre_releve_check CHECK (fpa_frequence_releve BETWEEN 1 AND 1440);
ALTER TABLE fe_parametre DROP CONSTRAINT IF EXISTS fe_parametre_delai_check;
ALTER TABLE fe_parametre ADD CONSTRAINT fe_parametre_delai_check CHECK (fpa_delai_secondes BETWEEN 5 AND 600);
ALTER TABLE fe_parametre DROP CONSTRAINT IF EXISTS fe_parametre_decoupage_check;
ALTER TABLE fe_parametre ADD CONSTRAINT fe_parametre_decoupage_check CHECK (fpa_decoupage_ereporting IN ('UNIQUE','PLUSIEURS'));
INSERT INTO fe_parametre (fpa_id) VALUES (1) ON CONFLICT (fpa_id) DO NOTHING;

-- Flux émis (Out) ou reçus (In) : type (flowType), syntaxe, profil, règle de traitement et son origine, identifiant de
-- suivi (trackingId, unique), identifiant de la plateforme (flowId, unique), empreinte SHA-256 de l'original, documents
-- de la GED, élément de l'application, numéro de facture lu ; file : état (EtatFlux), accusé, essais et prochain essai
-- (reprises 1, 5, 15, 60 min), dernière erreur ; curseur de la relève qui l'a lu.
CREATE TABLE IF NOT EXISTS fe_flux (
    ffl_id               BIGSERIAL     PRIMARY KEY,
    ffl_sens             VARCHAR(3)    NOT NULL,
    ffl_type             VARCHAR(50)   NOT NULL,
    ffl_syntaxe          VARCHAR(20)   NOT NULL,
    ffl_profil           VARCHAR(20),
    ffl_regle            VARCHAR(20),
    ffl_origine_regle    VARCHAR(10),
    ffl_nom              VARCHAR(255)  NOT NULL,
    ffl_numero           VARCHAR(100),
    ffl_id_suivi         VARCHAR(64),
    ffl_id_flux          VARCHAR(64),
    ffl_connecteur       VARCHAR(30)   NOT NULL,
    ffl_empreinte        CHAR(64)      NOT NULL,
    ffl_ged_original_id  BIGINT,
    ffl_ged_converti_id  BIGINT,
    ffl_ged_lisible_id   BIGINT,
    ffl_type_element     VARCHAR(50),
    ffl_id_element       VARCHAR(64),
    ffl_etat             VARCHAR(20)   NOT NULL,
    ffl_accuse           VARCHAR(10),
    ffl_accuse_details   JSONB,
    ffl_essais           INT           NOT NULL DEFAULT 0,
    ffl_prochain_essai   TIMESTAMPTZ,
    ffl_derniere_erreur  TEXT,
    ffl_curseur          VARCHAR(500),
    ffl_depose_le        TIMESTAMPTZ,
    ffl_modifie_pa_le    TIMESTAMPTZ,
    ffl_cree_le          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ffl_cree_par         VARCHAR(50)   NOT NULL DEFAULT '',
    ffl_modifie_le       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
ALTER TABLE fe_flux DROP CONSTRAINT IF EXISTS fe_flux_sens_check;
ALTER TABLE fe_flux ADD CONSTRAINT fe_flux_sens_check CHECK (ffl_sens IN ('In','Out'));
ALTER TABLE fe_flux DROP CONSTRAINT IF EXISTS fe_flux_syntaxe_check;
ALTER TABLE fe_flux ADD CONSTRAINT fe_flux_syntaxe_check CHECK (ffl_syntaxe IN ('CII','UBL','Factur-X','CDAR','FRR'));
ALTER TABLE fe_flux DROP CONSTRAINT IF EXISTS fe_flux_etat_check;
ALTER TABLE fe_flux ADD CONSTRAINT fe_flux_etat_check
    CHECK (ffl_etat IN ('A_ENVOYER','ENVOYE','ACQUITTE','ERREUR','RECU','TRAITE','ABANDONNE'));
ALTER TABLE fe_flux DROP CONSTRAINT IF EXISTS fe_flux_accuse_check;
ALTER TABLE fe_flux ADD CONSTRAINT fe_flux_accuse_check CHECK (ffl_accuse IS NULL OR ffl_accuse IN ('Pending','Ok','Error'));
ALTER TABLE fe_flux DROP CONSTRAINT IF EXISTS fe_flux_element_check;
ALTER TABLE fe_flux ADD CONSTRAINT fe_flux_element_check CHECK ((ffl_type_element IS NULL) = (ffl_id_element IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS ux_fe_flux_suivi ON fe_flux (ffl_id_suivi) WHERE ffl_id_suivi IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fe_flux_id_flux ON fe_flux (ffl_connecteur, ffl_id_flux) WHERE ffl_id_flux IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fe_flux_file ON fe_flux (ffl_prochain_essai, ffl_id) WHERE ffl_etat = 'A_ENVOYER';
CREATE INDEX IF NOT EXISTS ix_fe_flux_element ON fe_flux (ffl_type_element, ffl_id_element) WHERE ffl_type_element IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fe_flux_numero ON fe_flux (ffl_numero, ffl_sens) WHERE ffl_numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fe_flux_liste ON fe_flux (ffl_sens, ffl_etat, ffl_id DESC);

-- Fichiers d'un flux (Original, Converted, ReadableView) : le dépôt dû se fait depuis l'original gardé ici, que la
-- spécialisation l'ait rangé en GED ou non.
CREATE TABLE IF NOT EXISTS fe_fichier (
    ffi_ffl_id      BIGINT       NOT NULL REFERENCES fe_flux (ffl_id),
    ffi_document    VARCHAR(20)  NOT NULL,
    ffi_nom         VARCHAR(255) NOT NULL,
    ffi_type_mime   VARCHAR(100) NOT NULL,
    ffi_empreinte   CHAR(64)     NOT NULL,
    ffi_contenu     BYTEA        NOT NULL,
    ffi_cree_le     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (ffi_ffl_id, ffi_document)
);
ALTER TABLE fe_fichier DROP CONSTRAINT IF EXISTS fe_fichier_document_check;
ALTER TABLE fe_fichier ADD CONSTRAINT fe_fichier_document_check CHECK (ffi_document IN ('Original','Converted','ReadableView'));

-- Statuts du cycle de vie d'une facture (flux de la facture, ou numéro si la facture est inconnue) : code (StatutCdv),
-- motif, action, montant et taux (Encaissée), émetteur (EmetteurStatut), sens reçu / posé (SensStatut), flux CDAR
-- porteur et son document de la GED, date du statut, erreurs du contrôle et détails (JSON).
CREATE TABLE IF NOT EXISTS fe_statut (
    fst_id             BIGSERIAL     PRIMARY KEY,
    fst_ffl_id         BIGINT        REFERENCES fe_flux (ffl_id),
    fst_numero_facture VARCHAR(100)  NOT NULL,
    fst_sens_facture   CHAR(1)       NOT NULL,
    fst_code           VARCHAR(3)    NOT NULL,
    fst_motif          VARCHAR(20),
    fst_action         VARCHAR(10),
    fst_montant        NUMERIC(18,6),
    fst_taux           NUMERIC(9,6),
    fst_emetteur       VARCHAR(20),
    fst_sens           VARCHAR(10)   NOT NULL,
    fst_ffl_cdar_id    BIGINT        REFERENCES fe_flux (ffl_id),
    fst_ged_cdar_id    BIGINT,
    fst_date           TIMESTAMPTZ   NOT NULL,
    fst_erreurs        JSONB         NOT NULL DEFAULT '[]',
    fst_detail         JSONB,
    fst_cree_le        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    fst_cree_par       VARCHAR(50)   NOT NULL DEFAULT ''
);
ALTER TABLE fe_statut DROP CONSTRAINT IF EXISTS fe_statut_sens_check;
ALTER TABLE fe_statut ADD CONSTRAINT fe_statut_sens_check CHECK (fst_sens IN ('RECU','POSE'));
ALTER TABLE fe_statut DROP CONSTRAINT IF EXISTS fe_statut_sens_facture_check;
ALTER TABLE fe_statut ADD CONSTRAINT fe_statut_sens_facture_check CHECK (fst_sens_facture IN ('E','R'));
CREATE INDEX IF NOT EXISTS ix_fe_statut_flux ON fe_statut (fst_ffl_id, fst_date, fst_id);
CREATE INDEX IF NOT EXISTS ix_fe_statut_numero ON fe_statut (fst_numero_facture) WHERE fst_ffl_id IS NULL;

-- Erreurs d'un flux : refus de la plateforme (motif de l'accusé), échec d'un appel (ErreurFe, statut HTTP,
-- Request-Id), lecture impossible. Jamais de jeton.
CREATE TABLE IF NOT EXISTS fe_erreur (
    fer_id          BIGSERIAL     PRIMARY KEY,
    fer_ffl_id      BIGINT        NOT NULL REFERENCES fe_flux (ffl_id),
    fer_code        VARCHAR(60)   NOT NULL,
    fer_niveau      VARCHAR(10),
    fer_element     VARCHAR(100),
    fer_message     TEXT,
    fer_statut_http INT,
    fer_request_id  VARCHAR(100),
    fer_essai       INT           NOT NULL DEFAULT 0,
    fer_cree_le     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fe_erreur_flux ON fe_erreur (fer_ffl_id, fer_id);

-- Journal des étapes (trace complète, demande du 09/11/2026) : une ligne par étape et par changement d'état d'un flux
-- ou d'un élément ; type (EvenementFe), états avant / après, acteur (ActeurFe) et utilisateur, détail JSON.
-- Rang, horodatage et empreintes posés par fn_fe_evenement_chainer sous verrou : fev_empreinte =
-- SHA-256(fev_empreinte_precedente | rang | horodatage | type | flux | type d'élément | élément | avant | après | acteur |
-- utilisateur | détail::text), précédente de la première entrée = 64 zéros.
CREATE TABLE IF NOT EXISTS fe_evenement (
    fev_id                   BIGSERIAL     PRIMARY KEY,
    fev_rang                 BIGINT        NOT NULL UNIQUE,
    fev_ffl_id               BIGINT        REFERENCES fe_flux (ffl_id),
    fev_type_element         VARCHAR(50),
    fev_id_element           VARCHAR(64),
    fev_type                 VARCHAR(30)   NOT NULL,
    fev_etat_avant           VARCHAR(20),
    fev_etat_apres           VARCHAR(20),
    fev_acteur               VARCHAR(20)   NOT NULL,
    fev_utilisateur          VARCHAR(50),
    fev_detail               JSONB,
    fev_horodatage           TIMESTAMPTZ   NOT NULL,
    fev_empreinte_precedente CHAR(64)      NOT NULL,
    fev_empreinte            CHAR(64)      NOT NULL UNIQUE
);
ALTER TABLE fe_evenement DROP CONSTRAINT IF EXISTS fe_evenement_type_check;
ALTER TABLE fe_evenement ADD CONSTRAINT fe_evenement_type_check CHECK (fev_type IN ('PRODUCTION','CONTROLE','DEPOT','ACCUSE',
    'RECEPTION','STATUT_RECU','STATUT_POSE','ERREUR','REPRISE','ACTION_UTILISATEUR','AVOIR_INTERNE','RATTACHEMENT','IMPORT_MANUEL'));
ALTER TABLE fe_evenement DROP CONSTRAINT IF EXISTS fe_evenement_acteur_check;
ALTER TABLE fe_evenement ADD CONSTRAINT fe_evenement_acteur_check CHECK (fev_acteur IN ('UTILISATEUR','SYSTEME','PLATEFORME'));
CREATE INDEX IF NOT EXISTS ix_fe_evenement_flux ON fe_evenement (fev_ffl_id, fev_rang) WHERE fev_ffl_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fe_evenement_element ON fe_evenement (fev_type_element, fev_id_element, fev_rang)
    WHERE fev_type_element IS NOT NULL;

-- Chaînage à l'insertion : verrou de transaction (une chaîne sans fourche), rang suivant, horodatage du serveur à la
-- milliseconde, empreinte. Les valeurs fournies pour ces colonnes sont ignorées.
CREATE OR REPLACE FUNCTION fn_fe_evenement_chainer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_precedente CHAR(64);
    v_rang       BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('fe_evenement'));
    SELECT fev_empreinte, fev_rang INTO v_precedente, v_rang FROM fe_evenement ORDER BY fev_rang DESC LIMIT 1;
    NEW.fev_empreinte_precedente := COALESCE(v_precedente, repeat('0', 64));
    NEW.fev_rang := COALESCE(v_rang, 0) + 1;
    NEW.fev_horodatage := date_trunc('milliseconds', clock_timestamp());
    NEW.fev_empreinte := encode(sha256(convert_to(
        NEW.fev_empreinte_precedente || '|' || NEW.fev_rang::text || '|'
        || to_char(NEW.fev_horodatage AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|'
        || NEW.fev_type || '|' || COALESCE(NEW.fev_ffl_id::text, '') || '|' || COALESCE(NEW.fev_type_element, '') || '|'
        || COALESCE(NEW.fev_id_element, '') || '|' || COALESCE(NEW.fev_etat_avant, '') || '|' || COALESCE(NEW.fev_etat_apres, '') || '|'
        || NEW.fev_acteur || '|' || COALESCE(NEW.fev_utilisateur, '') || '|' || COALESCE(NEW.fev_detail::text, ''), 'UTF8')), 'hex');
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_fe_evenement_immuable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Le journal de la facturation électronique ne peut être ni modifié ni supprimé';
END $$;

DROP TRIGGER IF EXISTS tr_fe_evenement_chainer ON fe_evenement;
CREATE TRIGGER tr_fe_evenement_chainer BEFORE INSERT ON fe_evenement FOR EACH ROW EXECUTE FUNCTION fn_fe_evenement_chainer();
DROP TRIGGER IF EXISTS tr_fe_evenement_immuable ON fe_evenement;
CREATE TRIGGER tr_fe_evenement_immuable BEFORE UPDATE OR DELETE ON fe_evenement FOR EACH ROW EXECUTE FUNCTION fn_fe_evenement_immuable();
-- TRUNCATE ne déclenche pas les triggers par ligne : interdit sur le journal et sur les flux qu'il référence.
DROP TRIGGER IF EXISTS tr_fe_evenement_vidage ON fe_evenement;
CREATE TRIGGER tr_fe_evenement_vidage BEFORE TRUNCATE ON fe_evenement FOR EACH STATEMENT EXECUTE FUNCTION fn_fe_evenement_immuable();
DROP TRIGGER IF EXISTS tr_fe_flux_vidage ON fe_flux;
CREATE TRIGGER tr_fe_flux_vidage BEFORE TRUNCATE ON fe_flux FOR EACH STATEMENT EXECUTE FUNCTION fn_fe_evenement_immuable();

-- Relève par curseur (Q11), une ligne par sens de flux : curseur à reprendre, dernière relève, dernier succès, erreur.
CREATE TABLE IF NOT EXISTS fe_releve (
    fre_sens            VARCHAR(3)    PRIMARY KEY,
    fre_curseur         VARCHAR(500),
    fre_derniere_releve TIMESTAMPTZ,
    fre_dernier_succes  TIMESTAMPTZ,
    fre_derniere_erreur TEXT,
    fre_nombre          INT           NOT NULL DEFAULT 0
);
ALTER TABLE fe_releve DROP CONSTRAINT IF EXISTS fe_releve_sens_check;
ALTER TABLE fe_releve ADD CONSTRAINT fe_releve_sens_check CHECK (fre_sens IN ('In','Out'));
INSERT INTO fe_releve (fre_sens) VALUES ('In'), ('Out') ON CONFLICT (fre_sens) DO NOTHING;

-- État local de la plateforme simulée et du dépôt manuel (IMagasinFlux) : un flux par identifiant de la plateforme
-- (magasin SIMULE ou MANUEL), rang de la dernière modification (curseur « rang:N »), métadonnées et échéances (JSON),
-- original.
CREATE SEQUENCE IF NOT EXISTS fe_magasin_rang;
CREATE TABLE IF NOT EXISTS fe_magasin (
    fma_magasin   VARCHAR(30)   NOT NULL,
    fma_id_flux   VARCHAR(64)   NOT NULL,
    fma_rang      BIGINT        NOT NULL,
    fma_etat      JSONB         NOT NULL,
    fma_original  BYTEA         NOT NULL,
    fma_modifie_le TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (fma_magasin, fma_id_flux)
);
CREATE INDEX IF NOT EXISTS ix_fe_magasin_rang ON fe_magasin (fma_magasin, fma_rang);
