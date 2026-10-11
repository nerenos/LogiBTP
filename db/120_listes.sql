-- =============================================================================
-- Cœur LogiBTP – sources de listes (vues SQL) et données de démonstration volumineuses.
-- Les sources sont déclarées dans source_liste et les vues par défaut dans vue_liste par
-- 121_listes_parametrage.sql (généré depuis client/src/app/vues-liste.js).
-- =============================================================================

-- Documents : une ligne par document ; type_element = code du type (V_DEVIS, V_FACTURE…) pour ouvrir la fiche.
CREATE VIEW v_liste_documents AS
SELECT d.ent_id                                   AS id,
       t.tyd_code                                 AS type_element,
       t.tyd_libelle                              AS type_document,
       t.tyd_famille                              AS famille,
       d.ent_numero                               AS numero,
       d.ent_indice                               AS indice,
       d.ent_date                                 AS date_document,
       d.ent_objet                                AS objet,
       d.ent_proprietes ->> 'chantier'            AS chantier,
       s.std_libelle                              AS statut,
       d.ent_tiers_id                             AS tiers,
       d.ent_total_ht                             AS total_ht,
       d.ent_total_ttc                            AS total_ttc,
       d.ent_net_a_payer                          AS net_a_payer,
       d.ent_is_reference                         AS reference,
       d.ent_verrouille                           AS verrouille,
       coalesce(d.ent_modifie_le, d.ent_cree_le)  AS modifie_le
FROM document d
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
JOIN statut_document s ON s.std_id = d.ent_std_id;

-- Démonstration : salariés et matériels (tables du cœur en attendant les modules RH et Matériel).
CREATE TABLE demo_salarie (
    sal_id          SERIAL        PRIMARY KEY,
    sal_matricule   VARCHAR(10)   NOT NULL UNIQUE,
    sal_nom         VARCHAR(60)   NOT NULL,
    sal_prenom      VARCHAR(60)   NOT NULL,
    sal_service     VARCHAR(30)   NOT NULL,
    sal_poste       VARCHAR(60)   NOT NULL,
    sal_statut      VARCHAR(10)   NOT NULL CHECK (sal_statut IN ('CDI','CDD','INTERIM')),
    sal_date_entree DATE          NOT NULL,
    sal_salaire     NUMERIC(18,2) NOT NULL,
    sal_heures_mois NUMERIC(8,2)  NOT NULL DEFAULT 151.67,
    sal_actif       BOOLEAN       NOT NULL DEFAULT TRUE,
    sal_commentaire TEXT
);

CREATE TABLE demo_materiel (
    mat_id              SERIAL        PRIMARY KEY,
    mat_code            VARCHAR(10)   NOT NULL,
    mat_designation     VARCHAR(100)  NOT NULL,
    mat_famille         VARCHAR(30)   NOT NULL,
    mat_etat            VARCHAR(10)   NOT NULL CHECK (mat_etat IN ('DISPO','CHANTIER','PANNE','REBUT')),
    mat_chantier        VARCHAR(100),
    mat_valeur_achat    NUMERIC(18,2) NOT NULL,
    mat_date_achat      DATE          NOT NULL,
    mat_heures          INT           NOT NULL,
    mat_heures_revision INT           NOT NULL,
    mat_controle_ok     BOOLEAN       NOT NULL,
    mat_observations    TEXT
);

-- 5 000 salariés et 3 000 matériels, valeurs pseudo-aléatoires reproductibles (setseed).
SELECT setseed(0.42);
INSERT INTO demo_salarie (sal_matricule, sal_nom, sal_prenom, sal_service, sal_poste, sal_statut, sal_date_entree, sal_salaire, sal_actif, sal_commentaire)
SELECT 'S' || lpad(i::text, 5, '0'),
       (ARRAY['Martin','Bernard','Dubois','Lefèvre','Moreau','Laurent','Garçon','Roux','Fournier','Girard','Bonnet','Dupré',
              'Lambert','Fontaine','Rousseau','Vincent','Müller','Faure','André','Mercier','Blanc','Guérin','Boyer','Chevalier'])[1 + floor(random() * 24)::int],
       (ARRAY['Hélène','Gaëlle','Jérôme','Lœtitia','François','Zoé','Noël','Agnès','Benoît','Céline','Loïc','Maëlys',
              'Thomas','Inès','Raphaël','Chloé','Jean-Marc','Anaïs','Mathéo','Léa','Ophélie','Grégoire','Nadège','Frédéric'])[1 + floor(random() * 24)::int],
       x.service,
       CASE x.service
           WHEN 'Chantier' THEN (ARRAY['Maçon','Chef d''équipe','Coffreur','Manœuvre','Grutier'])[1 + floor(random() * 5)::int]
           WHEN 'Bureau' THEN (ARRAY['Conducteur de travaux','Métreur','Assistante','Comptable'])[1 + floor(random() * 4)::int]
           WHEN 'Atelier' THEN (ARRAY['Mécanicien','Magasinier'])[1 + floor(random() * 2)::int]
           ELSE (ARRAY['Directeur','Responsable QSE'])[1 + floor(random() * 2)::int]
       END,
       (ARRAY['CDI','CDI','CDI','CDD','INTERIM'])[1 + floor(random() * 5)::int],
       DATE '2005-01-01' + floor(random() * 7600)::int,
       round((1900 + random() * 3600)::numeric, 2),
       random() > 0.08,
       CASE WHEN random() > 0.85 THEN 'Habilitation électrique' || chr(10) || 'CACES R482 cat. A'
            WHEN random() > 0.9 THEN 'Temps partiel 80 %' ELSE '' END
FROM generate_series(1, 5000) AS i
CROSS JOIN LATERAL (SELECT (ARRAY['Chantier','Bureau','Atelier','Direction'])[1 + floor(random() * 4)::int] AS service, i AS j) x;

INSERT INTO demo_materiel (mat_code, mat_designation, mat_famille, mat_etat, mat_chantier, mat_valeur_achat, mat_date_achat,
                           mat_heures, mat_heures_revision, mat_controle_ok, mat_observations)
SELECT 'M' || lpad(i::text, 5, '0'),
       x.designation || ' n° ' || (100 + i % 900),
       x.famille,
       x.etat,
       CASE WHEN x.etat = 'CHANTIER' THEN (ARRAY['Maison Martin – Lyon','Résidence Les Érables','École Jean-Moulin','Pont de la Saône','Entrepôt Sud – Vénissieux'])[1 + floor(random() * 5)::int] END,
       round((800 + random() * 180000)::numeric, 0),
       DATE '2012-01-01' + floor(random() * 5000)::int,
       floor(x.revision * (0.4 + random() * 0.8))::int,
       x.revision,
       random() > 0.2,
       (ARRAY['','','Pneus à changer','Fuite hydraulique signalée' || chr(10) || 'Devis réparation demandé','Contrôle VGP à planifier','Rayures carrosserie'])[1 + floor(random() * 6)::int]
FROM generate_series(1, 3000) AS i
CROSS JOIN LATERAL (
    SELECT f.famille,
           (f.engins)[1 + floor(random() * array_length(f.engins, 1))::int] AS designation,
           (ARRAY['DISPO','DISPO','CHANTIER','CHANTIER','CHANTIER','PANNE','REBUT'])[1 + floor(random() * 7)::int] AS etat,
           250 * (1 + floor(random() * 8)::int) AS revision
    FROM (VALUES
        ('Engins', ARRAY['Mini-pelle 2,5 t','Chargeuse compacte','Tractopelle','Pelle sur chenilles 14 t']),
        ('Levage', ARRAY['Grue à tour','Nacelle ciseaux','Chariot télescopique']),
        ('Outillage', ARRAY['Bétonnière 350 l','Marteau-piqueur','Scie à sol','Groupe électrogène']),
        ('Véhicules', ARRAY['Fourgon 3,5 t','Camion benne','Utilitaire léger']),
        ('Coffrage', ARRAY['Banches métalliques','Étais tirants'])
    ) AS f(famille, engins)
    ORDER BY random() + i * 0 LIMIT 1
) x;

CREATE VIEW v_liste_salaries AS
SELECT sal_id AS id, sal_matricule AS matricule, sal_nom AS nom, sal_prenom AS prenom, sal_service AS service, sal_poste AS poste,
       sal_statut AS statut, sal_date_entree AS date_entree, sal_salaire AS salaire_brut, sal_heures_mois AS heures_mois,
       sal_actif AS actif, sal_commentaire AS commentaire
FROM demo_salarie;

CREATE VIEW v_liste_materiels AS
SELECT mat_id AS id, mat_code AS code, mat_designation AS designation, mat_famille AS famille, mat_etat AS etat,
       mat_chantier AS chantier, mat_valeur_achat AS valeur_achat, mat_date_achat AS date_achat,
       mat_heures AS heures_utilisation, mat_heures_revision AS heures_revision, mat_controle_ok AS controle_ok,
       mat_observations AS observations
FROM demo_materiel;

-- Index d'aide aux tris par défaut des vues de démonstration.
CREATE INDEX ix_sal_nom ON demo_salarie (sal_nom, sal_id);
CREATE INDEX ix_mat_code ON demo_materiel (mat_code, mat_id);
