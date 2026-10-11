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
