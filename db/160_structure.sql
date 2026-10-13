-- =============================================================================
-- Cœur LogiBTP – structure des affaires : projets (chiffrage), affaires (regroupement de chantiers ou affaire de
-- gestion pour les frais hors chantier), chantiers (ouverts quand un projet est obtenu), marchés (ouverts à la
-- validation d'une commande client, pour suivre la facturation). Une affaire regroupe des chantiers, un chantier des
-- marchés ; un projet peut être lié à un chantier. Les documents s'y rattachent (ent_projet_id … ent_marche_id).
-- Données de démonstration : 161_structure_demo.sql.
-- =============================================================================

CREATE TABLE affaire (
    aff_id              SERIAL        PRIMARY KEY,
    aff_code            VARCHAR(20)   NOT NULL UNIQUE,
    aff_libelle         VARCHAR(150)  NOT NULL,
    aff_nature          CHAR(1)       NOT NULL DEFAULT 'C' CHECK (aff_nature IN ('C','G')),   -- C chantiers, G gestion (frais hors chantier)
    aff_tiers_id        BIGINT        REFERENCES personne(per_id) ON DELETE SET NULL,
    aff_responsable     VARCHAR(100),
    aff_statut          VARCHAR(10)   NOT NULL DEFAULT 'OUVERTE' CHECK (aff_statut IN ('OUVERTE','CLOSE')),
    aff_date_ouverture  DATE          NOT NULL DEFAULT current_date,
    aff_date_cloture    DATE,
    aff_commentaire     TEXT,
    aff_proprietes      JSONB         NOT NULL DEFAULT '{}'
);

CREATE TABLE projet (
    prj_id              SERIAL        PRIMARY KEY,
    prj_code            VARCHAR(20)   NOT NULL UNIQUE,
    prj_libelle         VARCHAR(150)  NOT NULL,
    prj_tiers_id        BIGINT        REFERENCES personne(per_id) ON DELETE SET NULL,
    prj_statut          VARCHAR(10)   NOT NULL DEFAULT 'EN_COURS' CHECK (prj_statut IN ('EN_COURS','REMIS','OBTENU','PERDU','ABANDONNE')),
    prj_date_remise     DATE,                                    -- date de remise de l'offre
    prj_date_decision   DATE,
    prj_montant_estime  NUMERIC(18,2),
    prj_responsable     VARCHAR(100),
    prj_ville           VARCHAR(100),
    prj_commentaire     TEXT,
    prj_proprietes      JSONB         NOT NULL DEFAULT '{}'
);

CREATE TABLE chantier (
    cha_id              SERIAL        PRIMARY KEY,
    cha_code            VARCHAR(20)   NOT NULL UNIQUE,
    cha_libelle         VARCHAR(150)  NOT NULL,
    cha_aff_id          INT           REFERENCES affaire(aff_id) ON DELETE SET NULL,
    cha_prj_id          INT           REFERENCES projet(prj_id) ON DELETE SET NULL,
    cha_tiers_id        BIGINT        REFERENCES personne(per_id) ON DELETE SET NULL,
    cha_adresse         VARCHAR(200),
    cha_code_postal     VARCHAR(10),
    cha_ville           VARCHAR(100),
    cha_statut          VARCHAR(10)   NOT NULL DEFAULT 'OUVERT' CHECK (cha_statut IN ('OUVERT','TERMINE','CLOS')),
    cha_date_ouverture  DATE          NOT NULL DEFAULT current_date,
    cha_date_fin_prevue DATE,
    cha_conducteur      VARCHAR(100),
    cha_commentaire     TEXT,
    cha_proprietes      JSONB         NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_cha_affaire ON chantier (cha_aff_id);
CREATE INDEX ix_cha_projet ON chantier (cha_prj_id);

CREATE TABLE marche (
    mar_id              SERIAL        PRIMARY KEY,
    mar_code            VARCHAR(20)   NOT NULL UNIQUE,
    mar_libelle         VARCHAR(150)  NOT NULL,
    mar_cha_id          INT           NOT NULL REFERENCES chantier(cha_id),
    mar_ent_id          BIGINT        REFERENCES document(ent_id) ON DELETE SET NULL,   -- commande client d'origine
    mar_tiers_id        BIGINT        REFERENCES personne(per_id) ON DELETE SET NULL,
    mar_nature          CHAR(1)       NOT NULL DEFAULT 'P' CHECK (mar_nature IN ('P','U')),    -- privé, public
    mar_montant_ht      NUMERIC(18,2),                           -- montant du marché (commande, avenants compris)
    mar_retenue_pct     NUMERIC(5,2),                            -- retenue de garantie
    mar_date            DATE          NOT NULL DEFAULT current_date,
    mar_statut          VARCHAR(10)   NOT NULL DEFAULT 'EN_COURS' CHECK (mar_statut IN ('EN_COURS','SOLDE','RESILIE')),
    mar_commentaire     TEXT,
    mar_proprietes      JSONB         NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_mar_chantier ON marche (mar_cha_id);

-- Rattachement des documents.
ALTER TABLE document ADD COLUMN ent_projet_id   INT REFERENCES projet(prj_id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN ent_affaire_id  INT REFERENCES affaire(aff_id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN ent_chantier_id INT REFERENCES chantier(cha_id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN ent_marche_id   INT REFERENCES marche(mar_id) ON DELETE SET NULL;
CREATE INDEX ix_ent_projet ON document (ent_projet_id);
CREATE INDEX ix_ent_chantier ON document (ent_chantier_id);
CREATE INDEX ix_ent_marche ON document (ent_marche_id);

-- Montant facturé d'un ensemble de documents : factures et factures d'avancement validées, moins les avoirs.
CREATE VIEW v_facturation_document AS
SELECT d.ent_id, d.ent_projet_id, d.ent_affaire_id, d.ent_chantier_id, d.ent_marche_id,
       CASE WHEN t.tyd_code IN ('V_FACTURE','V_FACTURE_AVT') THEN d.ent_total_ht
            WHEN t.tyd_code = 'V_AVOIR' THEN -d.ent_total_ht ELSE 0 END AS facture_ht
FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id
WHERE d.ent_verrouille;

-- Listes.
CREATE VIEW v_liste_projets AS
SELECT p.prj_id AS id, 'projet'::text AS type_element, p.prj_code AS code, p.prj_libelle AS libelle,
       t.per_raison_sociale AS client, p.prj_statut AS statut, p.prj_date_remise AS date_remise, p.prj_date_decision AS date_decision,
       p.prj_montant_estime AS montant_estime, p.prj_ville AS ville, p.prj_responsable AS responsable,
       (SELECT string_agg(c.cha_code, ', ' ORDER BY c.cha_code) FROM chantier c WHERE c.cha_prj_id = p.prj_id) AS chantier,
       (SELECT count(*) FROM document d WHERE d.ent_projet_id = p.prj_id) AS nb_documents
FROM projet p LEFT JOIN personne t ON t.per_id = p.prj_tiers_id;

CREATE VIEW v_liste_affaires AS
SELECT a.aff_id AS id, 'affaire'::text AS type_element, a.aff_code AS code, a.aff_libelle AS libelle,
       CASE a.aff_nature WHEN 'G' THEN 'Gestion' ELSE 'Chantiers' END AS nature, t.per_raison_sociale AS client, a.aff_statut AS statut,
       a.aff_date_ouverture AS date_ouverture, a.aff_responsable AS responsable,
       (SELECT count(*) FROM chantier c WHERE c.cha_aff_id = a.aff_id) AS nb_chantiers,
       (SELECT coalesce(sum(m.mar_montant_ht), 0) FROM marche m JOIN chantier c ON c.cha_id = m.mar_cha_id WHERE c.cha_aff_id = a.aff_id) AS montant_marches,
       (SELECT coalesce(sum(f.facture_ht), 0) FROM v_facturation_document f
         WHERE f.ent_affaire_id = a.aff_id OR f.ent_chantier_id IN (SELECT c.cha_id FROM chantier c WHERE c.cha_aff_id = a.aff_id)) AS facture_ht
FROM affaire a LEFT JOIN personne t ON t.per_id = a.aff_tiers_id;

CREATE VIEW v_liste_chantiers AS
SELECT c.cha_id AS id, 'chantier'::text AS type_element, c.cha_code AS code, c.cha_libelle AS libelle,
       a.aff_code AS affaire, p.prj_code AS projet, t.per_raison_sociale AS client, c.cha_ville AS ville, c.cha_statut AS statut,
       c.cha_date_ouverture AS date_ouverture, c.cha_date_fin_prevue AS date_fin_prevue, c.cha_conducteur AS conducteur,
       (SELECT count(*) FROM marche m WHERE m.mar_cha_id = c.cha_id) AS nb_marches,
       (SELECT coalesce(sum(m.mar_montant_ht), 0) FROM marche m WHERE m.mar_cha_id = c.cha_id) AS montant_marches,
       (SELECT coalesce(sum(f.facture_ht), 0) FROM v_facturation_document f WHERE f.ent_chantier_id = c.cha_id) AS facture_ht
FROM chantier c
LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
LEFT JOIN projet p ON p.prj_id = c.cha_prj_id
LEFT JOIN personne t ON t.per_id = c.cha_tiers_id;

CREATE VIEW v_liste_marches AS
SELECT m.mar_id AS id, 'marche'::text AS type_element, m.mar_code AS code, m.mar_libelle AS libelle,
       c.cha_code AS chantier, a.aff_code AS affaire, t.per_raison_sociale AS client, d.ent_numero AS commande,
       CASE m.mar_nature WHEN 'U' THEN 'Public' ELSE 'Privé' END AS nature, m.mar_montant_ht AS montant_ht, m.mar_statut AS statut, m.mar_date AS date_marche,
       f.facture_ht, m.mar_montant_ht - f.facture_ht AS reste_a_facturer
FROM marche m
JOIN chantier c ON c.cha_id = m.mar_cha_id
LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
LEFT JOIN personne t ON t.per_id = m.mar_tiers_id
LEFT JOIN document d ON d.ent_id = m.mar_ent_id
CROSS JOIN LATERAL (SELECT coalesce(sum(x.facture_ht), 0) AS facture_ht FROM v_facturation_document x WHERE x.ent_marche_id = m.mar_id) f;

-- Documents : rattachements et nom du tiers (le chantier est celui de la structure, sinon la propriété libre).
CREATE OR REPLACE VIEW v_liste_documents AS
SELECT d.ent_id                                   AS id,
       t.tyd_code                                 AS type_element,
       t.tyd_libelle                              AS type_document,
       t.tyd_famille                              AS famille,
       d.ent_numero                               AS numero,
       d.ent_indice                               AS indice,
       d.ent_date                                 AS date_document,
       d.ent_objet                                AS objet,
       coalesce(ch.cha_code || ' – ' || ch.cha_libelle, d.ent_proprietes ->> 'chantier') AS chantier,
       s.std_libelle                              AS statut,
       d.ent_tiers_id                             AS tiers,
       d.ent_total_ht                             AS total_ht,
       d.ent_total_ttc                            AS total_ttc,
       d.ent_net_a_payer                          AS net_a_payer,
       d.ent_is_reference                         AS reference,
       d.ent_verrouille                           AS verrouille,
       coalesce(d.ent_modifie_le, d.ent_cree_le)  AS modifie_le,
       pe.per_raison_sociale                      AS client,
       pr.prj_code                                AS projet,
       af.aff_code                                AS affaire,
       ma.mar_code                                AS marche,
       pr.prj_id                                  AS projet_id,   -- identifiants : filtres des listes par rattachement
       af.aff_id                                  AS affaire_id,
       ch.cha_id                                  AS chantier_id,
       ma.mar_id                                  AS marche_id
FROM document d
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
JOIN statut_document s ON s.std_id = d.ent_std_id
LEFT JOIN personne pe ON pe.per_id = d.ent_tiers_id
LEFT JOIN projet pr ON pr.prj_id = coalesce(d.ent_projet_id, (SELECT cha_prj_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN affaire af ON af.aff_id = coalesce(d.ent_affaire_id, (SELECT cha_aff_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN chantier ch ON ch.cha_id = d.ent_chantier_id
LEFT JOIN marche ma ON ma.mar_id = d.ent_marche_id;

-- Types de documents : situation de travaux (état d'avancement cumulé, non comptable) et libellés harmonisés.
INSERT INTO type_document (tyd_code, tyd_libelle, tyd_famille, tyd_sens, tyd_prefixe_numero, tyd_numerotation_continue, tyd_mouvemente_stock, tyd_handler)
SELECT 'V_SITUATION', 'Situation de travaux', 'V', 1, 'ST', FALSE, FALSE, NULL
WHERE NOT EXISTS (SELECT 1 FROM type_document WHERE tyd_code = 'V_SITUATION');
UPDATE type_document SET tyd_libelle = 'Bon de livraison'             WHERE tyd_code = 'V_RECEPTION';
UPDATE type_document SET tyd_libelle = 'Bon de retour client'         WHERE tyd_code = 'V_RETOUR';
UPDATE type_document SET tyd_libelle = 'Facture'                      WHERE tyd_code = 'V_FACTURE';
UPDATE type_document SET tyd_libelle = 'Demande de prix'              WHERE tyd_code = 'A_DEVIS';
UPDATE type_document SET tyd_libelle = 'Bon de livraison fournisseur' WHERE tyd_code = 'A_RECEPTION';
UPDATE type_document SET tyd_libelle = 'Bon de retour fournisseur'    WHERE tyd_code = 'A_RETOUR';

INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.code, s.libelle, s.modifiable, s.terminal, s.ordre
FROM type_document t
CROSS JOIN (VALUES ('BROUILLON', 'Brouillon', TRUE, FALSE, 1), ('VALIDE', 'Validé', FALSE, FALSE, 2),
                   ('FACTURE', 'Facturé', FALSE, TRUE, 3), ('ANNULE', 'Annulé', FALSE, TRUE, 4)) AS s(code, libelle, modifiable, terminal, ordre)
WHERE t.tyd_code = 'V_SITUATION'
  AND NOT EXISTS (SELECT 1 FROM statut_document x WHERE x.std_tyd_id = t.tyd_id);

-- Transformations de la situation : depuis le devis ou la commande, vers la facture d'avancement.
INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape, tra_vaut_etapes)
SELECT s.tyd_id, c.tyd_id, v.etape, v.vaut::varchar(20)[]
FROM (VALUES ('V_DEVIS', 'V_SITUATION', 'SITUATION', '{COMMANDE}'), ('V_COMMANDE', 'V_SITUATION', 'SITUATION', '{}'),
             ('V_SITUATION', 'V_FACTURE_AVT', 'FACTURATION', '{}')) AS v(source, cible, etape, vaut)
JOIN type_document s ON s.tyd_code = v.source
JOIN type_document c ON c.tyd_code = v.cible
ON CONFLICT DO NOTHING;

INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT p.profil, t.tyd_id, a.action
FROM type_document t
CROSS JOIN (VALUES ('ADMIN'), ('SAISIE')) AS p(profil)
CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('VALIDER'), ('TRANSFORMER'), ('SUPPRIMER')) AS a(action)
WHERE t.tyd_code = 'V_SITUATION' AND (p.profil = 'ADMIN' OR a.action IN ('CREER', 'MODIFIER', 'TRANSFORMER'))
ON CONFLICT DO NOTHING;
