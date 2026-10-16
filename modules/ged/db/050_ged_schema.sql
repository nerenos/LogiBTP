-- =============================================================================
-- Module GED – documents stockés sur le serveur (fichiers rangés par empreinte SHA-256), versions, coffre-fort.
-- Versions de deux genres : « etape » (validation, envoi, signature…) toutes conservées, « edition » (dépôts et
-- modifications) dont seules les N dernières sont gardées. Suppression = masquage ; purge définitive par un
-- administrateur, jamais pour un document du coffre-fort. Coffre-fort : journal chaîné (empreinte du document,
-- horodatage, empreinte de l'entrée précédente) que la base interdit de modifier.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;                         -- recherche sans accent (ServiceGed.Lister)

-- Contenus : un fichier par empreinte (dépôts identiques partagés), chemin relatif au répertoire de stockage.
CREATE TABLE contenu_ged (
    cge_empreinte   CHAR(64)      PRIMARY KEY,                     -- SHA-256 hexadécimal
    cge_taille      BIGINT        NOT NULL,
    cge_chemin      VARCHAR(200)  NOT NULL,
    cge_cree_le     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE document_ged (
    dge_id              BIGSERIAL     PRIMARY KEY,
    dge_titre           VARCHAR(300)  NOT NULL,
    dge_categorie       VARCHAR(50),                               -- devis_signe, facture_recue, photo…
    dge_nature          VARCHAR(10)   NOT NULL DEFAULT 'fichier' CHECK (dge_nature IN ('fichier','mail')),
    dge_type_element    VARCHAR(50),                               -- élément lié (salarie, materiel, V_DEVIS…)
    dge_id_element      VARCHAR(100),
    dge_auteur          VARCHAR(100),                              -- auteur du document (expéditeur d'un mail…)
    dge_date_document   DATE,
    dge_parent_id       BIGINT        REFERENCES document_ged(dge_id), -- pièce jointe d'un mail
    dge_mail            JSONB,                                     -- { objet, de, a, cc, date, message, sens }
    dge_resume          TEXT,                                      -- saisi par l'utilisateur (agent IA local plus tard)
    dge_notes           TEXT,
    dge_etat            VARCHAR(30),                               -- dernière étape (VALIDE, ENVOYE, SIGNE…)
    dge_coffre          BOOLEAN       NOT NULL DEFAULT FALSE,
    dge_a_envoyer       BOOLEAN       NOT NULL DEFAULT FALSE,      -- pièce jointe à envoyer (module Mail) avec l'élément lié
    dge_coffre_le       TIMESTAMPTZ,
    dge_supprime        BOOLEAN       NOT NULL DEFAULT FALSE,
    dge_supprime_le     TIMESTAMPTZ,
    dge_supprime_par    VARCHAR(50),
    dge_cree_le         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    dge_cree_par        VARCHAR(50)   NOT NULL,
    dge_modifie_le      TIMESTAMPTZ
);
CREATE INDEX ix_dge_element ON document_ged (dge_type_element, dge_id_element) WHERE NOT dge_supprime;
CREATE INDEX ix_dge_parent ON document_ged (dge_parent_id);

CREATE TABLE version_ged (
    vge_id          BIGSERIAL     PRIMARY KEY,
    vge_document    BIGINT        NOT NULL REFERENCES document_ged(dge_id),
    vge_numero      INT           NOT NULL,
    vge_genre       VARCHAR(10)   NOT NULL CHECK (vge_genre IN ('edition','etape')),
    vge_etape       VARCHAR(30),                                   -- VALIDATION, ENVOI, SIGNATURE, RECEPTION…
    vge_etat        VARCHAR(30),
    vge_empreinte   CHAR(64)      NOT NULL REFERENCES contenu_ged(cge_empreinte),
    vge_nom_fichier VARCHAR(300)  NOT NULL,
    vge_type_mime   VARCHAR(150),
    vge_taille      BIGINT        NOT NULL,
    vge_auteur      VARCHAR(50)   NOT NULL,
    vge_date        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    vge_commentaire TEXT,
    UNIQUE (vge_document, vge_numero)
);

-- Coffre-fort : journal chaîné, en ajout seul.
CREATE TABLE coffre_ged (
    cof_id                  BIGSERIAL     PRIMARY KEY,
    cof_document            BIGINT        NOT NULL REFERENCES document_ged(dge_id),
    cof_version             BIGINT        NOT NULL REFERENCES version_ged(vge_id),
    cof_empreinte_document  CHAR(64)      NOT NULL,
    cof_horodatage          TIMESTAMPTZ   NOT NULL,
    cof_utilisateur         VARCHAR(50)   NOT NULL,
    cof_motif               VARCHAR(200),
    cof_empreinte_precedente CHAR(64)     NOT NULL,                -- 64 zéros pour la première entrée
    cof_empreinte_entree    CHAR(64)      NOT NULL UNIQUE          -- SHA-256 de l'entrée (voir ChaineCoffre)
);

CREATE FUNCTION fn_coffre_immuable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Le journal du coffre-fort ne peut être ni modifié ni supprimé';
END $$;
CREATE TRIGGER tr_coffre_immuable BEFORE UPDATE OR DELETE ON coffre_ged FOR EACH ROW EXECUTE FUNCTION fn_coffre_immuable();

-- Document du coffre-fort : ni suppression physique, ni sortie du coffre, ni version supprimée.
CREATE FUNCTION fn_document_coffre() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.dge_coffre THEN
        RAISE EXCEPTION 'Un document du coffre-fort ne peut pas être supprimé définitivement';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.dge_coffre AND NOT NEW.dge_coffre THEN
        RAISE EXCEPTION 'Un document ne peut pas sortir du coffre-fort';
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER tr_document_coffre BEFORE UPDATE OR DELETE ON document_ged FOR EACH ROW EXECUTE FUNCTION fn_document_coffre();

CREATE FUNCTION fn_version_coffre() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM document_ged WHERE dge_id = OLD.vge_document AND dge_coffre) THEN
        RAISE EXCEPTION 'Les versions d''un document du coffre-fort sont conservées';
    END IF;
    RETURN OLD;
END $$;
CREATE TRIGGER tr_version_coffre BEFORE DELETE ON version_ged FOR EACH ROW EXECUTE FUNCTION fn_version_coffre();

-- TRUNCATE ne déclenche pas les triggers par ligne : interdit sur le journal et sur les tables qu'il protège.
CREATE TRIGGER tr_coffre_vidage BEFORE TRUNCATE ON coffre_ged FOR EACH STATEMENT EXECUTE FUNCTION fn_coffre_immuable();
CREATE TRIGGER tr_document_vidage BEFORE TRUNCATE ON document_ged FOR EACH STATEMENT EXECUTE FUNCTION fn_coffre_immuable();
CREATE TRIGGER tr_version_vidage BEFORE TRUNCATE ON version_ged FOR EACH STATEMENT EXECUTE FUNCTION fn_coffre_immuable();

-- Paramètres : adresse en copie cachée des mails envoyés, taille maximale d'aperçu, éditions conservées, catégories.
CREATE TABLE parametre_ged (
    pge_cle     VARCHAR(50)   PRIMARY KEY,
    pge_valeur  JSONB         NOT NULL
);
INSERT INTO parametre_ged (pge_cle, pge_valeur) VALUES
 ('editions_conservees', '5'),
 ('taille_apercu_max', '15728640'),
 ('adresse_copie_cachee', '""'),
 ('categories', '[
    {"code":"devis_signe","libelle":"Devis signé","coffre":true},
    {"code":"facture_recue","libelle":"Facture reçue","coffre":true},
    {"code":"facture_emise","libelle":"Facture émise","coffre":true},
    {"code":"contrat","libelle":"Contrat","coffre":true},
    {"code":"courrier","libelle":"Courrier"},
    {"code":"mail","libelle":"Mail"},
    {"code":"photo","libelle":"Photo"},
    {"code":"plan","libelle":"Plan"},
    {"code":"certificat","libelle":"Certificat / habilitation"},
    {"code":"autre","libelle":"Autre"}]');

-- =============================================================================
-- Intégrité, statistiques d'utilisation et recherche
-- =============================================================================

-- Élément lié : type et identifiant renseignés ensemble ; un document n'est pas sa propre pièce jointe.
ALTER TABLE document_ged ADD CONSTRAINT ck_dge_element CHECK ((dge_type_element IS NULL) = (dge_id_element IS NULL));
ALTER TABLE document_ged ADD CONSTRAINT ck_dge_parent_soi CHECK (dge_parent_id IS NULL OR dge_parent_id <> dge_id);

-- Hiérarchie des pièces jointes sans boucle : le parent ne peut être ni le document lui-même ni l'une de ses pièces
-- jointes, à n'importe quelle profondeur (erreur 23514, message GED_BOUCLE).
CREATE FUNCTION fn_ged_parent_sans_boucle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.dge_parent_id IS NULL THEN RETURN NEW; END IF;
    IF EXISTS (
        WITH RECURSIVE ascendants(id, profondeur) AS (
            SELECT NEW.dge_parent_id, 1
            UNION ALL
            SELECT d.dge_parent_id, a.profondeur + 1 FROM document_ged d JOIN ascendants a ON d.dge_id = a.id
            WHERE d.dge_parent_id IS NOT NULL AND a.profondeur < 1000)
        SELECT 1 FROM ascendants WHERE id = NEW.dge_id) THEN
        RAISE EXCEPTION 'GED_BOUCLE : le document % ne peut pas être une pièce jointe de sa propre pièce jointe', NEW.dge_id
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tr_ged_parent_sans_boucle BEFORE INSERT OR UPDATE OF dge_parent_id ON document_ged
    FOR EACH ROW EXECUTE FUNCTION fn_ged_parent_sans_boucle();

-- Élément lié existant : point d'accroche remplacé par l'application (CREATE OR REPLACE dans ses scripts), qui connaît
-- ses éléments (documents, fiches…). Réponse NULL = type inconnu, FALSE = élément inexistant : refusés (erreur 23503,
-- message GED_ELEMENT). Module seul : tout élément est accepté.
CREATE FUNCTION f_ged_element_existe(p_type TEXT, p_id TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT TRUE $$;

CREATE FUNCTION fn_ged_element_existe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.dge_type_element IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NEW.dge_type_element IS NOT DISTINCT FROM OLD.dge_type_element
       AND NEW.dge_id_element IS NOT DISTINCT FROM OLD.dge_id_element THEN RETURN NEW; END IF;
    IF f_ged_element_existe(NEW.dge_type_element, NEW.dge_id_element) IS NOT TRUE THEN
        RAISE EXCEPTION 'GED_ELEMENT : élément lié inexistant ou de type inconnu (% %)', NEW.dge_type_element, NEW.dge_id_element
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tr_ged_element_existe BEFORE INSERT OR UPDATE OF dge_type_element, dge_id_element ON document_ged
    FOR EACH ROW EXECUTE FUNCTION fn_ged_element_existe();

-- Consultations des contenus (aperçu, téléchargement) : journal qui alimente les statistiques d'utilisation.
CREATE TABLE consultation_ged (
    cog_id             BIGSERIAL     PRIMARY KEY,
    cog_document       BIGINT        NOT NULL REFERENCES document_ged(dge_id) ON DELETE CASCADE,
    cog_version        BIGINT        REFERENCES version_ged(vge_id) ON DELETE SET NULL,
    cog_utilisateur    VARCHAR(50)   NOT NULL,
    cog_telechargement BOOLEAN       NOT NULL DEFAULT FALSE,
    cog_date           TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_cog_document ON consultation_ged (cog_document, cog_date DESC);
ALTER TABLE document_ged ADD COLUMN dge_nb_consultations INT NOT NULL DEFAULT 0;
ALTER TABLE document_ged ADD COLUMN dge_consulte_le TIMESTAMPTZ;

-- Statistiques d'utilisation par élément lié ('' : documents sans élément), tenues à jour par déclencheurs :
-- documents visibles, masqués et au coffre-fort, versions et volume, consultations, dernière activité.
CREATE TABLE statistique_ged (
    sge_type_element      VARCHAR(50)   NOT NULL,
    sge_id_element        VARCHAR(100)  NOT NULL,
    sge_nb_documents      INT           NOT NULL DEFAULT 0,
    sge_nb_supprimes      INT           NOT NULL DEFAULT 0,
    sge_nb_coffre         INT           NOT NULL DEFAULT 0,
    sge_nb_versions       INT           NOT NULL DEFAULT 0,
    sge_taille            BIGINT        NOT NULL DEFAULT 0,
    sge_nb_consultations  BIGINT        NOT NULL DEFAULT 0,
    sge_derniere_activite TIMESTAMPTZ,
    PRIMARY KEY (sge_type_element, sge_id_element)
);

CREATE FUNCTION f_ged_recalculer_statistique(p_type TEXT, p_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t TEXT := coalesce(p_type, ''); i TEXT := coalesce(p_id, '');
BEGIN
    INSERT INTO statistique_ged AS s (sge_type_element, sge_id_element, sge_nb_documents, sge_nb_supprimes, sge_nb_coffre,
        sge_nb_versions, sge_taille, sge_nb_consultations, sge_derniere_activite)
    SELECT t, i,
        count(*) FILTER (WHERE NOT d.dge_supprime), count(*) FILTER (WHERE d.dge_supprime), count(*) FILTER (WHERE d.dge_coffre),
        coalesce(sum(v.nb), 0), coalesce(sum(v.taille), 0), coalesce(sum(d.dge_nb_consultations), 0),
        greatest(max(d.dge_cree_le), max(d.dge_modifie_le), max(d.dge_consulte_le), max(v.derniere))
    FROM document_ged d
    LEFT JOIN LATERAL (SELECT count(*) AS nb, sum(x.vge_taille) AS taille, max(x.vge_date) AS derniere
                       FROM version_ged x WHERE x.vge_document = d.dge_id) v ON TRUE
    WHERE coalesce(d.dge_type_element, '') = t AND coalesce(d.dge_id_element, '') = i
    ON CONFLICT (sge_type_element, sge_id_element) DO UPDATE SET
        sge_nb_documents = EXCLUDED.sge_nb_documents, sge_nb_supprimes = EXCLUDED.sge_nb_supprimes,
        sge_nb_coffre = EXCLUDED.sge_nb_coffre, sge_nb_versions = EXCLUDED.sge_nb_versions, sge_taille = EXCLUDED.sge_taille,
        sge_nb_consultations = EXCLUDED.sge_nb_consultations, sge_derniere_activite = EXCLUDED.sge_derniere_activite;
    DELETE FROM statistique_ged WHERE sge_type_element = t AND sge_id_element = i AND sge_nb_documents + sge_nb_supprimes = 0;
END $$;

CREATE FUNCTION fn_ged_statistique_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM f_ged_recalculer_statistique(OLD.dge_type_element, OLD.dge_id_element); END IF;
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW.dge_type_element IS DISTINCT FROM OLD.dge_type_element
        OR NEW.dge_id_element IS DISTINCT FROM OLD.dge_id_element)) THEN
        PERFORM f_ged_recalculer_statistique(NEW.dge_type_element, NEW.dge_id_element);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER tr_ged_statistique_document AFTER INSERT OR DELETE OR UPDATE OF dge_type_element, dge_id_element, dge_supprime,
    dge_coffre, dge_nb_consultations, dge_modifie_le ON document_ged FOR EACH ROW EXECUTE FUNCTION fn_ged_statistique_document();

CREATE FUNCTION fn_ged_statistique_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d document_ged;
BEGIN
    SELECT * INTO d FROM document_ged WHERE dge_id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.vge_document ELSE NEW.vge_document END);
    IF FOUND THEN PERFORM f_ged_recalculer_statistique(d.dge_type_element, d.dge_id_element); END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER tr_ged_statistique_version AFTER INSERT OR DELETE ON version_ged FOR EACH ROW EXECUTE FUNCTION fn_ged_statistique_version();

-- Consultation enregistrée : compteur et date du document (la statistique suit par le déclencheur du document).
CREATE FUNCTION fn_ged_consultation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE document_ged SET dge_nb_consultations = dge_nb_consultations + 1, dge_consulte_le = NEW.cog_date WHERE dge_id = NEW.cog_document;
    RETURN NULL;
END $$;
CREATE TRIGGER tr_ged_consultation AFTER INSERT ON consultation_ged FOR EACH ROW EXECUTE FUNCTION fn_ged_consultation();

-- Recherche par métadonnées et contenu : texte normalisé (ligatures, accents retirés, minuscules : même règle que
-- NormalisationGed.cs et le fournisseur mémoire) en colonne générée, index trigrammes pour les recherches « contient ».
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE FUNCTION f_ged_normaliser(texte TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$ SELECT lower(regexp_replace(normalize(
        replace(replace(replace(replace(replace(translate(texte, 'øØđĐłŁ', 'oOdDlL'), 'œ', 'oe'), 'Œ', 'oe'), 'æ', 'ae'), 'Æ', 'ae'), 'ß', 'ss'),
        NFD), '[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]', '', 'g')) $$;
-- Titre, catégorie, auteur, résumé, notes et mail (objet, expéditeur, destinataires, copie, message).
ALTER TABLE document_ged ADD COLUMN dge_recherche TEXT GENERATED ALWAYS AS (f_ged_normaliser(
    dge_titre || ' ' || coalesce(dge_categorie, '') || ' ' || coalesce(dge_auteur, '') || ' ' || coalesce(dge_resume, '') || ' '
    || coalesce(dge_notes, '') || ' ' || coalesce(dge_mail ->> 'objet', '') || ' ' || coalesce(dge_mail ->> 'de', '') || ' '
    || coalesce(dge_mail ->> 'a', '') || ' ' || coalesce(dge_mail ->> 'cc', '') || ' ' || coalesce(dge_mail ->> 'message', ''))) STORED;
CREATE INDEX ix_dge_recherche ON document_ged USING gin (dge_recherche gin_trgm_ops);
-- Noms des fichiers déposés (toutes les versions).
CREATE INDEX ix_vge_nom_fichier ON version_ged USING gin (f_ged_normaliser(vge_nom_fichier) gin_trgm_ops);
-- Métadonnées : catégorie, dates, état, coffre-fort, pièces à envoyer, mail (JSONB), contenus partagés.
CREATE INDEX ix_dge_categorie ON document_ged (dge_categorie) WHERE NOT dge_supprime;
CREATE INDEX ix_dge_date ON document_ged (dge_date_document DESC, dge_id DESC) WHERE NOT dge_supprime;
CREATE INDEX ix_dge_cree_le ON document_ged (dge_cree_le DESC);
CREATE INDEX ix_dge_etat ON document_ged (dge_etat) WHERE dge_etat IS NOT NULL;
CREATE INDEX ix_dge_coffre ON document_ged (dge_id) WHERE dge_coffre;
CREATE INDEX ix_dge_a_envoyer ON document_ged (dge_type_element, dge_id_element) WHERE dge_a_envoyer AND NOT dge_supprime;
CREATE INDEX ix_dge_mail ON document_ged USING gin (dge_mail jsonb_path_ops) WHERE dge_mail IS NOT NULL;
CREATE INDEX ix_vge_empreinte ON version_ged (vge_empreinte);

-- Recherche de documents dans les listes (déclarée comme source par l'application).
CREATE VIEW v_liste_ged AS
SELECT d.dge_id AS id, 'document_ged' AS type_element, d.dge_titre AS titre, d.dge_categorie AS categorie, d.dge_nature AS nature,
       d.dge_type_element AS type_lie, d.dge_id_element AS id_lie, d.dge_auteur AS auteur, d.dge_date_document AS date_document,
       d.dge_etat AS etat, d.dge_coffre AS coffre, v.vge_nom_fichier AS nom_fichier, v.vge_type_mime AS type_mime,
       v.vge_taille AS taille, v.vge_numero AS version, d.dge_mail ->> 'objet' AS objet_mail, d.dge_resume AS resume,
       d.dge_notes AS notes, d.dge_cree_le AS cree_le, d.dge_cree_par AS cree_par
FROM document_ged d
LEFT JOIN LATERAL (SELECT * FROM version_ged x WHERE x.vge_document = d.dge_id ORDER BY x.vge_numero DESC LIMIT 1) v ON TRUE
WHERE NOT d.dge_supprime;
