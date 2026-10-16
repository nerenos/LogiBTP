-- =============================================================================
-- Module GED – organisation et cycle de vie des documents (après 050_ged_schema.sql) :
--   coffre-fort : une seule entrée par document, chaîne linéaire, empreintes SHA-256 bien formées ;
--   répertoires créés par les utilisateurs (rattachés à un élément lié, ou globaux) ;
--   confidentialité et restrictions d'accès ; métadonnées d'indexation plein texte (texte extrait, mots-clés) ;
--   dérivations entre documents (version, traduction, adaptation…) ; compteur de versions tenu par déclencheur ;
--   règles de rétention et d'archivage par catégorie / type d'élément ; règles de classification automatique ;
--   archive séparée (documents hors coffre déplacés, documents du coffre archivés sur place).
-- Rejouable (IF NOT EXISTS, CREATE OR REPLACE) : s'applique aussi aux bases existantes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Coffre-fort : unicité des empreintes
-- -----------------------------------------------------------------------------
-- Un document n'est scellé qu'une fois ; une entrée n'a qu'un successeur (pas de fourche dans la chaîne) ;
-- empreintes en hexadécimal minuscule (64 caractères). cof_empreinte_entree est déjà unique (050).
CREATE UNIQUE INDEX IF NOT EXISTS ux_cof_document ON coffre_ged (cof_document);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cof_empreinte_precedente ON coffre_ged (cof_empreinte_precedente);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cof_empreintes') THEN
        ALTER TABLE coffre_ged ADD CONSTRAINT ck_cof_empreintes CHECK (cof_empreinte_document ~ '^[0-9a-f]{64}$'
            AND cof_empreinte_precedente ~ '^[0-9a-f]{64}$' AND cof_empreinte_entree ~ '^[0-9a-f]{64}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cge_empreinte') THEN
        ALTER TABLE contenu_ged ADD CONSTRAINT ck_cge_empreinte CHECK (cge_empreinte ~ '^[0-9a-f]{64}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_vge_empreinte') THEN
        ALTER TABLE version_ged ADD CONSTRAINT ck_vge_empreinte CHECK (vge_empreinte ~ '^[0-9a-f]{64}$');
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Répertoires
-- -----------------------------------------------------------------------------
-- Répertoires créés par les utilisateurs dans l'explorateur : sous l'élément lié (fiche, document…) ou globaux.
-- Un sous-répertoire appartient au même élément que son parent ; un document classé dans un répertoire est lié à
-- l'élément du répertoire (les répertoires automatiques de l'arborescence viennent de l'application).
CREATE TABLE IF NOT EXISTS repertoire_ged (
    rge_id            BIGSERIAL     PRIMARY KEY,
    rge_nom           VARCHAR(150)  NOT NULL CHECK (btrim(rge_nom) <> '' AND rge_nom !~ '[/\\]'),
    rge_parent_id     BIGINT        REFERENCES repertoire_ged(rge_id),
    rge_type_element  VARCHAR(50),
    rge_id_element    VARCHAR(100),
    rge_cree_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    rge_cree_par      VARCHAR(50)   NOT NULL,
    CONSTRAINT ck_rge_element CHECK ((rge_type_element IS NULL) = (rge_id_element IS NULL)),
    CONSTRAINT ck_rge_parent_soi CHECK (rge_parent_id IS NULL OR rge_parent_id <> rge_id)
);
-- Noms uniques (sans casse) parmi les frères.
CREATE UNIQUE INDEX IF NOT EXISTS ux_rge_nom ON repertoire_ged
    (coalesce(rge_parent_id, 0), coalesce(rge_type_element, ''), coalesce(rge_id_element, ''), lower(rge_nom));
CREATE INDEX IF NOT EXISTS ix_rge_element ON repertoire_ged (rge_type_element, rge_id_element);

-- Sous-répertoire : élément du parent repris, pas de boucle (erreur 23514, message GED_REPERTOIRE_BOUCLE).
CREATE OR REPLACE FUNCTION fn_ged_repertoire() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p repertoire_ged;
BEGIN
    IF NEW.rge_parent_id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO p FROM repertoire_ged WHERE rge_id = NEW.rge_parent_id;
    NEW.rge_type_element := p.rge_type_element;
    NEW.rge_id_element := p.rge_id_element;
    IF TG_OP = 'UPDATE' AND EXISTS (
        WITH RECURSIVE ascendants(id, profondeur) AS (
            SELECT NEW.rge_parent_id, 1
            UNION ALL
            SELECT r.rge_parent_id, a.profondeur + 1 FROM repertoire_ged r JOIN ascendants a ON r.rge_id = a.id
            WHERE r.rge_parent_id IS NOT NULL AND a.profondeur < 1000)
        SELECT 1 FROM ascendants WHERE id = NEW.rge_id) THEN
        RAISE EXCEPTION 'GED_REPERTOIRE_BOUCLE : le répertoire % ne peut pas être déplacé dans l''un de ses sous-répertoires', NEW.rge_id
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_ged_repertoire ON repertoire_ged;
CREATE TRIGGER tr_ged_repertoire BEFORE INSERT OR UPDATE OF rge_parent_id, rge_type_element, rge_id_element ON repertoire_ged
    FOR EACH ROW EXECUTE FUNCTION fn_ged_repertoire();

-- -----------------------------------------------------------------------------
-- Documents : répertoire, confidentialité, indexation, compteur de versions, archivage sur place
-- -----------------------------------------------------------------------------
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_repertoire_id BIGINT REFERENCES repertoire_ged(rge_id);
-- Confidentialité : PUBLIC (diffusable), INTERNE (défaut), CONFIDENTIEL (auteur du dépôt, administrateurs et accès
-- listés), SECRET (auteur du dépôt et accès listés). Accès listés non vides : réservés à ces profils / utilisateurs
-- (règle répliquée : acces.js ↔ AccesGed.cs, jeu tests/cas/06_acces.json).
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_confidentialite VARCHAR(12) NOT NULL DEFAULT 'INTERNE';
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_acces_profils TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_acces_utilisateurs TEXT[] NOT NULL DEFAULT '{}';
-- Indexation plein texte : texte extrait du contenu (PDF, textes, bureautique, mails), mots-clés (saisis ou posés par la
-- classification), langue, état de l'indexation, règles de classification appliquées.
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_texte_contenu TEXT;
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_mots_cles TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_langue VARCHAR(10) NOT NULL DEFAULT 'fr';
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_index_etat VARCHAR(12) NOT NULL DEFAULT 'A_FAIRE';
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_indexe_le TIMESTAMPTZ;
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_classification JSONB;
-- Versions : nombre et numéro courant, tenus par le déclencheur tr_ged_compteur_versions.
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_nb_versions INT NOT NULL DEFAULT 0;
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_version_courante INT;
-- Archivage sur place (documents du coffre-fort, qui ne quittent jamais document_ged) : exclus des recherches actives.
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_archive BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_archive_le TIMESTAMPTZ;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_dge_confidentialite') THEN
        ALTER TABLE document_ged ADD CONSTRAINT ck_dge_confidentialite CHECK (dge_confidentialite IN ('PUBLIC', 'INTERNE', 'CONFIDENTIEL', 'SECRET'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_dge_index_etat') THEN
        ALTER TABLE document_ged ADD CONSTRAINT ck_dge_index_etat CHECK (dge_index_etat IN ('A_FAIRE', 'FAIT', 'SANS_TEXTE', 'ECHEC'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_dge_archive_coffre') THEN
        -- Seuls les documents du coffre-fort sont archivés sur place ; les autres vont dans document_ged_archive.
        ALTER TABLE document_ged ADD CONSTRAINT ck_dge_archive_coffre CHECK (NOT dge_archive OR dge_coffre);
    END IF;
END $$;

-- Document classé dans un répertoire : même élément lié que le répertoire (erreur 23514, message GED_REPERTOIRE).
CREATE OR REPLACE FUNCTION fn_ged_document_repertoire() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r repertoire_ged;
BEGIN
    IF NEW.dge_repertoire_id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO r FROM repertoire_ged WHERE rge_id = NEW.dge_repertoire_id;
    IF r.rge_type_element IS DISTINCT FROM NEW.dge_type_element OR r.rge_id_element IS DISTINCT FROM NEW.dge_id_element THEN
        RAISE EXCEPTION 'GED_REPERTOIRE : le document % et son répertoire % ne sont pas liés au même élément', NEW.dge_id, NEW.dge_repertoire_id
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_ged_document_repertoire ON document_ged;
CREATE TRIGGER tr_ged_document_repertoire BEFORE INSERT OR UPDATE OF dge_repertoire_id, dge_type_element, dge_id_element ON document_ged
    FOR EACH ROW EXECUTE FUNCTION fn_ged_document_repertoire();

-- Plein texte : vecteur pondéré (A : titre et mots-clés, B : résumé et objet du mail, C : notes, message, texte extrait),
-- sur le texte normalisé (sans accents, comme dge_recherche), configuration française ; texte extrait limité à 200 000
-- caractères. Fonction immuable (array_to_string ne l'est pas) pour la colonne générée.
CREATE OR REPLACE FUNCTION f_ged_plein_texte(titre TEXT, mots TEXT[], resume TEXT, notes TEXT, mail JSONB, contenu TEXT)
    RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT setweight(to_tsvector('french'::regconfig, f_ged_normaliser(coalesce(titre, '') || ' ' || coalesce((SELECT string_agg(m, ' ') FROM unnest(mots) m), ''))), 'A')
        || setweight(to_tsvector('french'::regconfig, f_ged_normaliser(coalesce(resume, '') || ' ' || coalesce(mail ->> 'objet', ''))), 'B')
        || setweight(to_tsvector('french'::regconfig, f_ged_normaliser(coalesce(notes, '') || ' ' || coalesce(mail ->> 'message', '') || ' '
            || coalesce(left(contenu, 200000), ''))), 'C') $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'document_ged' AND column_name = 'dge_plein_texte') THEN
        ALTER TABLE document_ged ADD COLUMN dge_plein_texte tsvector GENERATED ALWAYS AS
            (f_ged_plein_texte(dge_titre, dge_mots_cles, dge_resume, dge_notes, dge_mail, dge_texte_contenu)) STORED;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_dge_plein_texte ON document_ged USING gin (dge_plein_texte);
CREATE INDEX IF NOT EXISTS ix_dge_mots_cles ON document_ged USING gin (dge_mots_cles);
CREATE INDEX IF NOT EXISTS ix_dge_repertoire ON document_ged (dge_repertoire_id) WHERE dge_repertoire_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_dge_index_a_faire ON document_ged (dge_id) WHERE dge_index_etat = 'A_FAIRE';
-- Recherches actives : documents visibles et non archivés.
CREATE INDEX IF NOT EXISTS ix_dge_actifs ON document_ged (dge_type_element, dge_id_element, dge_date_document DESC)
    WHERE NOT dge_supprime AND NOT dge_archive;

-- Compteur de versions : nombre et numéro courant du document, à chaque ajout ou purge d'une version.
CREATE OR REPLACE FUNCTION fn_ged_compteur_versions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc BIGINT := CASE WHEN TG_OP = 'DELETE' THEN OLD.vge_document ELSE NEW.vge_document END;
BEGIN
    UPDATE document_ged d SET dge_nb_versions = s.nb, dge_version_courante = s.courante
    FROM (SELECT count(*)::INT AS nb, max(vge_numero) AS courante FROM version_ged WHERE vge_document = doc) s
    WHERE d.dge_id = doc AND (d.dge_nb_versions IS DISTINCT FROM s.nb OR d.dge_version_courante IS DISTINCT FROM s.courante);
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tr_ged_compteur_versions ON version_ged;
CREATE TRIGGER tr_ged_compteur_versions AFTER INSERT OR DELETE ON version_ged FOR EACH ROW EXECUTE FUNCTION fn_ged_compteur_versions();
UPDATE document_ged d SET dge_nb_versions = s.nb, dge_version_courante = s.courante
FROM (SELECT vge_document, count(*)::INT AS nb, max(vge_numero) AS courante FROM version_ged GROUP BY vge_document) s
WHERE d.dge_id = s.vge_document AND (d.dge_nb_versions IS DISTINCT FROM s.nb OR d.dge_version_courante IS DISTINCT FROM s.courante);

-- -----------------------------------------------------------------------------
-- Dérivations entre documents
-- -----------------------------------------------------------------------------
-- La cible dérive de la source : VERSION (refonte, nouvelle édition séparée), TRADUCTION (langue de la cible),
-- ADAPTATION, EXTRAIT, ANNOTATION. Sans boucle, quel que soit le type (erreur 23514, message GED_DERIVATION_BOUCLE).
CREATE TABLE IF NOT EXISTS derivation_ged (
    drg_id            BIGSERIAL     PRIMARY KEY,
    drg_source_id     BIGINT        NOT NULL REFERENCES document_ged(dge_id),
    drg_cible_id      BIGINT        NOT NULL REFERENCES document_ged(dge_id),
    drg_type          VARCHAR(12)   NOT NULL CHECK (drg_type IN ('VERSION', 'TRADUCTION', 'ADAPTATION', 'EXTRAIT', 'ANNOTATION')),
    drg_langue        VARCHAR(10),
    drg_commentaire   VARCHAR(300),
    drg_cree_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    drg_cree_par      VARCHAR(50)   NOT NULL,
    CONSTRAINT ck_drg_soi CHECK (drg_source_id <> drg_cible_id),
    CONSTRAINT ux_drg UNIQUE (drg_source_id, drg_cible_id, drg_type)
);
CREATE INDEX IF NOT EXISTS ix_drg_cible ON derivation_ged (drg_cible_id);

CREATE OR REPLACE FUNCTION fn_ged_derivation_sans_boucle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        WITH RECURSIVE sources(id, profondeur) AS (
            SELECT NEW.drg_source_id, 1
            UNION ALL
            SELECT d.drg_source_id, s.profondeur + 1 FROM derivation_ged d JOIN sources s ON d.drg_cible_id = s.id WHERE s.profondeur < 1000)
        SELECT 1 FROM sources WHERE id = NEW.drg_cible_id) THEN
        RAISE EXCEPTION 'GED_DERIVATION_BOUCLE : le document % dérive déjà du document %', NEW.drg_source_id, NEW.drg_cible_id
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_ged_derivation_sans_boucle ON derivation_ged;
CREATE TRIGGER tr_ged_derivation_sans_boucle BEFORE INSERT OR UPDATE ON derivation_ged FOR EACH ROW EXECUTE FUNCTION fn_ged_derivation_sans_boucle();

-- -----------------------------------------------------------------------------
-- Règles de rétention et d'archivage
-- -----------------------------------------------------------------------------
-- Par catégorie et / ou type d'élément lié (NULL = tous) ; la règle la plus précise s'applique (catégorie et type,
-- puis l'un des deux, puis aucun), à précision égale la plus petite priorité puis le plus petit identifiant.
-- Durées comptées en mois depuis la date du document (à défaut, sa date de dépôt) : archivage (sortie des recherches
-- actives), puis fin de conservation (REVOIR : à examiner ; DETRUIRE : purge proposée, jamais pour le coffre-fort).
-- Règle répliquée : retention.js ↔ RegleRetention.cs (jeu tests/cas/04_retention.json).
CREATE TABLE IF NOT EXISTS regle_retention_ged (
    rrg_id                       SERIAL        PRIMARY KEY,
    rrg_libelle                  VARCHAR(150)  NOT NULL,
    rrg_categorie                VARCHAR(50),
    rrg_type_element             VARCHAR(50),
    rrg_duree_active_mois        INT           CHECK (rrg_duree_active_mois >= 0),
    rrg_duree_conservation_mois  INT           CHECK (rrg_duree_conservation_mois >= 0),
    rrg_action_fin               VARCHAR(10)   NOT NULL DEFAULT 'REVOIR' CHECK (rrg_action_fin IN ('REVOIR', 'DETRUIRE')),
    rrg_priorite                 INT           NOT NULL DEFAULT 100,
    rrg_actif                    BOOLEAN       NOT NULL DEFAULT TRUE,
    CONSTRAINT ck_rrg_durees CHECK (rrg_duree_conservation_mois IS NULL OR rrg_duree_active_mois IS NULL
        OR rrg_duree_conservation_mois >= rrg_duree_active_mois)
);
-- Règles par défaut (mêmes valeurs que REGLES_RETENTION_DEFAUT de retention.js) : pièces comptables 10 ans,
-- contrats et devis signés 10 ans, courriers et mails 5 ans, photos et plans archivés après 3 ans.
INSERT INTO regle_retention_ged (rrg_id, rrg_libelle, rrg_categorie, rrg_type_element, rrg_duree_active_mois, rrg_duree_conservation_mois, rrg_action_fin, rrg_priorite)
SELECT * FROM (VALUES
    (1, 'Factures reçues', 'facture_recue', NULL::VARCHAR, 24, 120, 'REVOIR', 10),
    (2, 'Factures émises', 'facture_emise', NULL, 24, 120, 'REVOIR', 10),
    (3, 'Devis signés', 'devis_signe', NULL, 24, 120, 'REVOIR', 10),
    (4, 'Contrats', 'contrat', NULL, 36, 120, 'REVOIR', 10),
    (5, 'Courriers', 'courrier', NULL, 24, 60, 'DETRUIRE', 50),
    (6, 'Mails', 'mail', NULL, 12, 60, 'DETRUIRE', 50),
    (7, 'Photos et plans', 'photo', NULL, 36, NULL, 'REVOIR', 50),
    (8, 'Plans', 'plan', NULL, 36, NULL, 'REVOIR', 50),
    (9, 'Autres documents', NULL, NULL, 60, NULL, 'REVOIR', 1000)) v
WHERE NOT EXISTS (SELECT 1 FROM regle_retention_ged);
DO $$ BEGIN PERFORM setval(pg_get_serial_sequence('regle_retention_ged', 'rrg_id'), greatest((SELECT max(rrg_id) FROM regle_retention_ged), 1)); END $$;

-- -----------------------------------------------------------------------------
-- Classification automatique
-- -----------------------------------------------------------------------------
-- Une règle s'applique quand tous ses critères renseignés sont remplis : extension du fichier, type MIME (préfixe),
-- un des mots (titre, nom du fichier, texte extrait ; texte normalisé), expéditeur d'un mail (contient), type d'élément.
-- Résultat : catégorie de la première règle applicable (priorité, identifiant), confidentialité la plus stricte,
-- mots-clés de toutes les règles applicables. Règle répliquée : classification.js ↔ ClassificationGed.cs (jeu
-- tests/cas/05_classification.json) ; appliquée au dépôt quand la catégorie n'est pas saisie.
CREATE TABLE IF NOT EXISTS regle_classification_ged (
    rcg_id               SERIAL        PRIMARY KEY,
    rcg_libelle          VARCHAR(150)  NOT NULL,
    rcg_priorite         INT           NOT NULL DEFAULT 100,
    rcg_actif            BOOLEAN       NOT NULL DEFAULT TRUE,
    rcg_extensions       TEXT[]        NOT NULL DEFAULT '{}',
    rcg_types_mime       TEXT[]        NOT NULL DEFAULT '{}',
    rcg_mots             TEXT[]        NOT NULL DEFAULT '{}',
    rcg_expediteur       VARCHAR(200),
    rcg_type_element     VARCHAR(50),
    rcg_categorie        VARCHAR(50),
    rcg_confidentialite  VARCHAR(12)   CHECK (rcg_confidentialite IN ('PUBLIC', 'INTERNE', 'CONFIDENTIEL', 'SECRET')),
    rcg_mots_cles        TEXT[]        NOT NULL DEFAULT '{}',
    CONSTRAINT ck_rcg_critere CHECK (cardinality(rcg_extensions) + cardinality(rcg_types_mime) + cardinality(rcg_mots) > 0
        OR rcg_expediteur IS NOT NULL OR rcg_type_element IS NOT NULL),
    CONSTRAINT ck_rcg_resultat CHECK (rcg_categorie IS NOT NULL OR rcg_confidentialite IS NOT NULL OR cardinality(rcg_mots_cles) > 0)
);
-- Règles par défaut (mêmes valeurs que REGLES_CLASSIFICATION_DEFAUT de classification.js).
INSERT INTO regle_classification_ged (rcg_id, rcg_libelle, rcg_priorite, rcg_extensions, rcg_types_mime, rcg_mots, rcg_expediteur, rcg_type_element,
    rcg_categorie, rcg_confidentialite, rcg_mots_cles)
SELECT * FROM (VALUES
    (1, 'Mails', 10, '{eml,msg}'::TEXT[], '{}'::TEXT[], '{}'::TEXT[], NULL::VARCHAR, NULL::VARCHAR, 'mail', NULL::VARCHAR, '{}'::TEXT[]),
    (2, 'Factures', 20, '{}', '{}', '{facture}', NULL, NULL, 'facture_recue', NULL, '{facture}'),
    (3, 'Devis signés', 20, '{}', '{}', '{"bon pour accord","devis signe"}', NULL, NULL, 'devis_signe', NULL, '{devis}'),
    (4, 'Contrats', 20, '{}', '{}', '{contrat}', NULL, NULL, 'contrat', 'CONFIDENTIEL', '{contrat}'),
    (5, 'Plans', 30, '{dwg,dxf,ifc}', '{}', '{}', NULL, NULL, 'plan', NULL, '{plan}'),
    (6, 'Photos', 40, '{jpg,jpeg,png,heic,webp}', '{image/}', '{}', NULL, NULL, 'photo', NULL, '{}'),
    (7, 'Certificats', 30, '{}', '{}', '{caces,habilitation,certificat,attestation}', NULL, NULL, 'certificat', NULL, '{}'),
    (8, 'Documents RH', 15, '{}', '{}', '{"arret de travail","bulletin de paie","entretien annuel"}', NULL, NULL, NULL, 'CONFIDENTIEL', '{rh}')) v
WHERE NOT EXISTS (SELECT 1 FROM regle_classification_ged);
DO $$ BEGIN PERFORM setval(pg_get_serial_sequence('regle_classification_ged', 'rcg_id'), greatest((SELECT max(rcg_id) FROM regle_classification_ged), 1)); END $$;

-- -----------------------------------------------------------------------------
-- Archive séparée
-- -----------------------------------------------------------------------------
-- Documents archivés hors coffre-fort, déplacés avec leurs versions (et les pièces jointes d'un mail) pour alléger les
-- recherches actives ; mêmes colonnes que document_ged / version_ged (colonnes générées copiées comme valeurs, ce
-- qui garde la recherche dans l'archive), dérivations conservées en JSON. Les contenus restent référencés (clé
-- étrangère : un contenu d'archive n'est jamais purgé). Restauration par f_ged_restaurer_archive.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_ged_archive') THEN
        CREATE TABLE document_ged_archive (LIKE document_ged INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
        ALTER TABLE document_ged_archive ALTER COLUMN dge_id DROP DEFAULT;
        ALTER TABLE document_ged_archive ADD PRIMARY KEY (dge_id);
        ALTER TABLE document_ged_archive DROP CONSTRAINT IF EXISTS ck_dge_archive_coffre;
        ALTER TABLE document_ged_archive ADD COLUMN dga_archive_le TIMESTAMPTZ NOT NULL DEFAULT now();
        ALTER TABLE document_ged_archive ADD COLUMN dga_archive_par VARCHAR(50) NOT NULL;
        ALTER TABLE document_ged_archive ADD COLUMN dga_motif VARCHAR(200);
        ALTER TABLE document_ged_archive ADD COLUMN dga_derivations JSONB NOT NULL DEFAULT '[]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'version_ged_archive') THEN
        CREATE TABLE version_ged_archive (LIKE version_ged INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
        ALTER TABLE version_ged_archive ALTER COLUMN vge_id DROP DEFAULT;
        ALTER TABLE version_ged_archive ADD PRIMARY KEY (vge_id);
        ALTER TABLE version_ged_archive ADD CONSTRAINT fk_vga_contenu FOREIGN KEY (vge_empreinte) REFERENCES contenu_ged(cge_empreinte);
        ALTER TABLE version_ged_archive ADD CONSTRAINT fk_vga_document FOREIGN KEY (vge_document) REFERENCES document_ged_archive(dge_id);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_dga_element ON document_ged_archive (dge_type_element, dge_id_element);
CREATE INDEX IF NOT EXISTS ix_dga_recherche ON document_ged_archive USING gin (dge_recherche gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_dga_plein_texte ON document_ged_archive USING gin (dge_plein_texte);
CREATE INDEX IF NOT EXISTS ix_vga_document ON version_ged_archive (vge_document);
CREATE INDEX IF NOT EXISTS ix_vga_empreinte ON version_ged_archive (vge_empreinte);

-- Colonnes communes à deux tables, hors colonnes générées de la cible (liste pour INSERT … SELECT).
CREATE OR REPLACE FUNCTION f_ged_colonnes_communes(p_source TEXT, p_cible TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.table_name = p_cible AND c.is_generated = 'NEVER'
      AND EXISTS (SELECT 1 FROM information_schema.columns s WHERE s.table_schema = current_schema() AND s.table_name = p_source
                  AND s.column_name = c.column_name) $$;

-- Archivage d'un document (racine : pas une pièce jointe) et de ses pièces jointes. Famille sans document du coffre-fort :
-- déplacée dans l'archive (versions, dérivations en JSON, consultations détaillées abandonnées, compteur conservé) ;
-- sinon archivée sur place (dge_archive). Renvoie le nombre de documents archivés.
CREATE OR REPLACE FUNCTION f_ged_archiver(p_id BIGINT, p_utilisateur TEXT, p_motif TEXT DEFAULT NULL) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
    d document_ged;
    ids BIGINT[];
    colonnes_doc TEXT := f_ged_colonnes_communes('document_ged', 'document_ged_archive');
    colonnes_ver TEXT := f_ged_colonnes_communes('version_ged', 'version_ged_archive');
BEGIN
    SELECT * INTO d FROM document_ged WHERE dge_id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'GED_INTROUVABLE : document %', p_id USING ERRCODE = 'P0002'; END IF;
    IF d.dge_parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'GED_ARCHIVE_PIECE : la pièce jointe % s''archive avec son mail', p_id USING ERRCODE = '23514';
    END IF;
    WITH RECURSIVE famille(id) AS (
        SELECT p_id UNION SELECT x.dge_id FROM document_ged x JOIN famille f ON x.dge_parent_id = f.id)
    SELECT array_agg(id) INTO ids FROM famille;

    IF EXISTS (SELECT 1 FROM document_ged WHERE dge_id = ANY(ids) AND dge_coffre) THEN
        UPDATE document_ged SET dge_archive = TRUE, dge_archive_le = now() WHERE dge_id = ANY(ids) AND dge_coffre AND NOT dge_archive;
        -- Pièces hors coffre d'une famille du coffre : restent actives (jamais séparées de leur mail).
        RETURN (SELECT count(*) FROM document_ged WHERE dge_id = ANY(ids) AND dge_archive)::INT;
    END IF;

    EXECUTE format('INSERT INTO document_ged_archive (%s, dga_archive_par, dga_motif, dga_derivations) SELECT %s, $1, $2, '
        || '(SELECT coalesce(jsonb_agg(jsonb_build_object(''source'', r.drg_source_id, ''cible'', r.drg_cible_id, ''type'', r.drg_type, '
        || '''langue'', r.drg_langue, ''commentaire'', r.drg_commentaire, ''cree_le'', r.drg_cree_le, ''cree_par'', r.drg_cree_par)), ''[]'') '
        || 'FROM derivation_ged r WHERE r.drg_source_id = d.dge_id OR r.drg_cible_id = d.dge_id) '
        || 'FROM document_ged d WHERE d.dge_id = ANY($3)', colonnes_doc, colonnes_doc)
        USING p_utilisateur, p_motif, ids;
    EXECUTE format('INSERT INTO version_ged_archive (%s) SELECT %s FROM version_ged WHERE vge_document = ANY($1)', colonnes_ver, colonnes_ver) USING ids;
    DELETE FROM derivation_ged WHERE drg_source_id = ANY(ids) OR drg_cible_id = ANY(ids);
    DELETE FROM version_ged WHERE vge_document = ANY(ids);
    -- Pièces jointes d'abord (clé du parent), du plus profond au mail.
    DELETE FROM document_ged x USING (
        WITH RECURSIVE prof(id, n) AS (SELECT p_id, 0 UNION ALL SELECT y.dge_id, p.n + 1 FROM document_ged y JOIN prof p ON y.dge_parent_id = p.id)
        SELECT id, n FROM prof) o
    WHERE x.dge_id = o.id AND o.n > 0;
    DELETE FROM document_ged WHERE dge_id = p_id;
    RETURN cardinality(ids);
END $$;

-- Restauration d'un document archivé (déplacé ou archivé sur place) et de sa famille ; répertoire disparu oublié ;
-- dérivations rétablies vers les documents encore actifs. Renvoie le nombre de documents restaurés.
CREATE OR REPLACE FUNCTION f_ged_restaurer_archive(p_id BIGINT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
    ids BIGINT[];
    colonnes_doc TEXT := f_ged_colonnes_communes('document_ged_archive', 'document_ged');
    colonnes_ver TEXT := f_ged_colonnes_communes('version_ged_archive', 'version_ged');
    nb INT;
BEGIN
    IF EXISTS (SELECT 1 FROM document_ged WHERE dge_id = p_id) THEN
        WITH RECURSIVE famille(id) AS (
            SELECT p_id UNION SELECT x.dge_id FROM document_ged x JOIN famille f ON x.dge_parent_id = f.id)
        UPDATE document_ged SET dge_archive = FALSE, dge_archive_le = NULL WHERE dge_id IN (SELECT id FROM famille) AND dge_archive;
        GET DIAGNOSTICS nb = ROW_COUNT;
        RETURN nb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM document_ged_archive WHERE dge_id = p_id) THEN
        RAISE EXCEPTION 'GED_INTROUVABLE : document archivé %', p_id USING ERRCODE = 'P0002';
    END IF;
    WITH RECURSIVE famille(id, profondeur) AS (
        SELECT p_id, 0 UNION ALL SELECT x.dge_id, f.profondeur + 1 FROM document_ged_archive x JOIN famille f ON x.dge_parent_id = f.id)
    SELECT array_agg(id ORDER BY profondeur, id) INTO ids FROM famille;
    UPDATE document_ged_archive a SET dge_repertoire_id = NULL
    WHERE a.dge_id = ANY(ids) AND a.dge_repertoire_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM repertoire_ged r WHERE r.rge_id = a.dge_repertoire_id);
    -- Parents avant les pièces jointes (ordre de profondeur).
    FOR i IN 1 .. cardinality(ids) LOOP
        EXECUTE format('INSERT INTO document_ged (%s) SELECT %s FROM document_ged_archive WHERE dge_id = $1', colonnes_doc, colonnes_doc) USING ids[i];
    END LOOP;
    EXECUTE format('INSERT INTO version_ged (%s) SELECT %s FROM version_ged_archive WHERE vge_document = ANY($1)', colonnes_ver, colonnes_ver) USING ids;
    INSERT INTO derivation_ged (drg_source_id, drg_cible_id, drg_type, drg_langue, drg_commentaire, drg_cree_le, drg_cree_par)
    SELECT DISTINCT (j ->> 'source')::BIGINT, (j ->> 'cible')::BIGINT, j ->> 'type', j ->> 'langue', j ->> 'commentaire', (j ->> 'cree_le')::TIMESTAMPTZ, j ->> 'cree_par'
    FROM document_ged_archive a, jsonb_array_elements(a.dga_derivations) j
    WHERE a.dge_id = ANY(ids)
      AND EXISTS (SELECT 1 FROM document_ged x WHERE x.dge_id = (j ->> 'source')::BIGINT)
      AND EXISTS (SELECT 1 FROM document_ged x WHERE x.dge_id = (j ->> 'cible')::BIGINT)
    ON CONFLICT DO NOTHING;
    DELETE FROM version_ged_archive WHERE vge_document = ANY(ids);
    DELETE FROM document_ged_archive WHERE dge_id = ANY(ids);
    RETURN cardinality(ids);
END $$;

-- Contenus : un contenu encore référencé par une version archivée n'est jamais supprimé (clé fk_vga_contenu).

-- -----------------------------------------------------------------------------
-- Vue de recherche des listes : documents actifs, non confidentiels (le module Liste n'applique pas les accès de la GED).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_liste_ged AS
SELECT d.dge_id AS id, 'document_ged' AS type_element, d.dge_titre AS titre, d.dge_categorie AS categorie, d.dge_nature AS nature,
       d.dge_type_element AS type_lie, d.dge_id_element AS id_lie, d.dge_auteur AS auteur, d.dge_date_document AS date_document,
       d.dge_etat AS etat, d.dge_coffre AS coffre, v.vge_nom_fichier AS nom_fichier, v.vge_type_mime AS type_mime,
       v.vge_taille AS taille, v.vge_numero AS version, d.dge_mail ->> 'objet' AS objet_mail, d.dge_resume AS resume,
       d.dge_notes AS notes, d.dge_cree_le AS cree_le, d.dge_cree_par AS cree_par
FROM document_ged d
LEFT JOIN LATERAL (SELECT * FROM version_ged x WHERE x.vge_document = d.dge_id ORDER BY x.vge_numero DESC LIMIT 1) v ON TRUE
WHERE NOT d.dge_supprime AND NOT d.dge_archive AND d.dge_confidentialite IN ('PUBLIC', 'INTERNE')
  AND cardinality(d.dge_acces_profils) = 0 AND cardinality(d.dge_acces_utilisateurs) = 0;
