-- =============================================================================
-- Cœur – référentiel des ressources (ANALYSE-MODULES-TRANSVERSE.md § 4.2 et § 4.4 ; Planning P5, P6, P19 ; Pointage
-- M10, M18 ; Exécution motifs de blocage). Rejouable.
--   1. Les tables de démonstration deviennent le référentiel : demo_salarie → salarie, demo_materiel → materiel,
--      demo_equipe → equipe (bases existantes ; une base neuve les crée sous ces noms par 120).
--   2. Salarié : qualification, coût horaire chargé saisi, date de sortie ; missions des intérimaires (agence, période,
--      taux horaire facturé).
--   3. Matériel : identifié ou par nombre (quantité, unité), service, dépôt, habilitations exigées du conducteur.
--   4. Habilitations (types paramétrables, salariés et matériels) ; équipes à compositions datées ; motifs typés.
--   5. Natures de main-d'œuvre de la bibliothèque rattachées à un service (heures budget par service).
-- =============================================================================

DO $$
BEGIN
    IF to_regclass('demo_salarie') IS NOT NULL AND to_regclass('salarie') IS NULL THEN ALTER TABLE demo_salarie RENAME TO salarie; END IF;
    IF to_regclass('demo_materiel') IS NOT NULL AND to_regclass('materiel') IS NULL THEN ALTER TABLE demo_materiel RENAME TO materiel; END IF;
    IF to_regclass('demo_equipe') IS NOT NULL AND to_regclass('equipe') IS NULL THEN ALTER TABLE demo_equipe RENAME TO equipe; END IF;
END $$;
UPDATE type_fiche SET tyf_table = 'salarie' WHERE tyf_table = 'demo_salarie';
UPDATE type_fiche SET tyf_table = 'materiel' WHERE tyf_table = 'demo_materiel';

-- Pièces de la GED des éléments : même fonction que 194, sur les tables renommées.
CREATE OR REPLACE FUNCTION f_ged_element_existe(p_type TEXT, p_id TEXT) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
    n BIGINT;
    tyd INT;
BEGIN
    IF p_type IS NULL OR p_id IS NULL THEN RETURN NULL; END IF;
    IF p_id !~ '^[0-9]{1,18}$' THEN RETURN FALSE; END IF;
    n := p_id::BIGINT;
    SELECT tyd_id INTO tyd FROM type_document WHERE tyd_code = p_type;
    IF FOUND THEN
        RETURN EXISTS (SELECT 1 FROM document WHERE ent_tyd_id = tyd AND coalesce(ent_groupe_id, ent_id) = n);
    END IF;
    RETURN CASE p_type
        WHEN 'salarie'  THEN EXISTS (SELECT 1 FROM salarie WHERE sal_id = n)
        WHEN 'interim'  THEN EXISTS (SELECT 1 FROM salarie WHERE sal_id = n)
        WHEN 'materiel' THEN EXISTS (SELECT 1 FROM materiel WHERE mat_id = n)
        WHEN 'element'  THEN EXISTS (SELECT 1 FROM element WHERE ele_id = n)
        WHEN 'personne' THEN EXISTS (SELECT 1 FROM personne WHERE per_id = n)
        WHEN 'individu' THEN EXISTS (SELECT 1 FROM individu WHERE ind_id = n)
        WHEN 'projet'   THEN EXISTS (SELECT 1 FROM projet WHERE prj_id = n)
        WHEN 'affaire'  THEN EXISTS (SELECT 1 FROM affaire WHERE aff_id = n)
        WHEN 'chantier' THEN EXISTS (SELECT 1 FROM chantier WHERE cha_id = n)
        WHEN 'marche'   THEN EXISTS (SELECT 1 FROM marche WHERE mar_id = n)
        WHEN 'equipe'   THEN EXISTS (SELECT 1 FROM equipe WHERE equ_id = n)
        ELSE CASE WHEN p_type LIKE 'crm\_%' THEN f_crm_element_existe(p_type, n) END
    END;
END $$;

-- 2. Salariés et intérimaires ------------------------------------------------------------------------------------
ALTER TABLE salarie ADD COLUMN IF NOT EXISTS sal_qualification VARCHAR(60);
ALTER TABLE salarie ADD COLUMN IF NOT EXISTS sal_cout_horaire  NUMERIC(18,4);   -- coût horaire chargé saisi (nul : estimé)
ALTER TABLE salarie ADD COLUMN IF NOT EXISTS sal_date_sortie   DATE;

-- Missions d'intérim : agence (tiers), période, taux horaire facturé (M18) ; contrôle des factures et coût des chantiers.
CREATE TABLE IF NOT EXISTS mission_interim (
    mis_id            SERIAL        PRIMARY KEY,
    mis_sal_id        INT           NOT NULL REFERENCES salarie(sal_id) ON DELETE CASCADE,
    mis_agence_id     BIGINT        REFERENCES personne(per_id) ON DELETE SET NULL,
    mis_debut         DATE          NOT NULL,
    mis_fin           DATE          NOT NULL,
    mis_taux_horaire  NUMERIC(18,4),
    mis_chantier_id   INT,
    mis_commentaire   TEXT,
    mis_maj_par       VARCHAR(50),
    mis_maj_le        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_mis_periode CHECK (mis_fin >= mis_debut)
);
CREATE INDEX IF NOT EXISTS ix_mis_salarie ON mission_interim (mis_sal_id, mis_debut);

INSERT INTO mission_interim (mis_sal_id, mis_agence_id, mis_debut, mis_fin, mis_taux_horaire, mis_maj_par)
SELECT s.sal_id, (SELECT per_id FROM personne WHERE per_casquettes @> '["INTERIM"]'::jsonb ORDER BY per_id LIMIT 1),
       greatest(s.sal_date_entree, current_date - 120),
       CASE WHEN s.sal_actif THEN current_date + (s.sal_id % 90) ELSE greatest(s.sal_date_entree, current_date - 120) + 30 END,
       32 + (s.sal_id % 10), 'demo'
FROM salarie s
WHERE s.sal_statut = 'INTERIM' AND NOT EXISTS (SELECT 1 FROM mission_interim);

-- 3. Matériels ---------------------------------------------------------------------------------------------------
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_mode VARCHAR(10) NOT NULL DEFAULT 'IDENTIFIE';
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_quantite NUMERIC(18,3) NOT NULL DEFAULT 1;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_unite VARCHAR(10);
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_srv_id INT REFERENCES service(srv_id) ON DELETE SET NULL;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_depot_id BIGINT REFERENCES personne(per_id) ON DELETE SET NULL;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_habilitations JSONB NOT NULL DEFAULT '[]';   -- codes exigés du conducteur
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_mat_mode') THEN
        ALTER TABLE materiel ADD CONSTRAINT ck_mat_mode CHECK (mat_mode IN ('IDENTIFIE', 'NOMBRE'));
    END IF;
END $$;
-- Démonstration : coffrages par nombre (banches, étais), habilitations exigées des conducteurs d'engins et de nacelles.
UPDATE materiel SET mat_mode = 'NOMBRE', mat_quantite = 20 + (mat_id % 5) * 10, mat_unite = 'u'
WHERE mat_famille = 'Coffrage' AND mat_mode = 'IDENTIFIE' AND mat_unite IS NULL;
UPDATE materiel SET mat_habilitations = '["CACES_R482_A"]' WHERE mat_famille = 'Engins' AND mat_habilitations = '[]';
UPDATE materiel SET mat_habilitations = '["CACES_R486_B"]' WHERE mat_famille = 'Levage' AND mat_designation ILIKE 'Nacelle%' AND mat_habilitations = '[]';
UPDATE materiel SET mat_habilitations = '["CACES_R489_3"]' WHERE mat_famille = 'Levage' AND mat_designation ILIKE 'Chariot%' AND mat_habilitations = '[]';
UPDATE materiel SET mat_srv_id = (SELECT srv_id FROM service WHERE srv_code = 'CHANTIER') WHERE mat_srv_id IS NULL;

-- 4. Habilitations -----------------------------------------------------------------------------------------------
-- Types : catégorie, durée de validité (mois, nulle : sans fin), concerne un salarié, un matériel ou les deux.
CREATE TABLE IF NOT EXISTS type_habilitation (
    tha_code         VARCHAR(30)   PRIMARY KEY,
    tha_libelle      VARCHAR(120)  NOT NULL,
    tha_categorie    VARCHAR(20)   NOT NULL DEFAULT 'AUTRE'
                     CHECK (tha_categorie IN ('CACES', 'HAUTEUR', 'ELECTRIQUE', 'SECURITE', 'MEDICAL', 'CONTROLE', 'AUTRE')),
    tha_concerne     VARCHAR(10)   NOT NULL DEFAULT 'SALARIE' CHECK (tha_concerne IN ('SALARIE', 'MATERIEL', 'LES_DEUX')),
    tha_duree_mois   INT           CHECK (tha_duree_mois IS NULL OR tha_duree_mois > 0),
    tha_ordre        INT           NOT NULL DEFAULT 0,
    tha_actif        BOOLEAN       NOT NULL DEFAULT TRUE
);
INSERT INTO type_habilitation (tha_code, tha_libelle, tha_categorie, tha_concerne, tha_duree_mois, tha_ordre) VALUES
 ('CACES_R482_A', 'CACES R482 cat. A (engins compacts)', 'CACES', 'SALARIE', 120, 10),
 ('CACES_R482_B1', 'CACES R482 cat. B1 (pelles hydrauliques)', 'CACES', 'SALARIE', 120, 11),
 ('CACES_R486_B', 'CACES R486 cat. B (nacelles)', 'CACES', 'SALARIE', 60, 12),
 ('CACES_R487', 'CACES R487 (grues à tour)', 'CACES', 'SALARIE', 60, 13),
 ('CACES_R489_3', 'CACES R489 cat. 3 (chariots élévateurs)', 'CACES', 'SALARIE', 60, 14),
 ('HAUTEUR', 'Travail en hauteur (harnais)', 'HAUTEUR', 'SALARIE', 36, 20),
 ('ELEC_B1V', 'Habilitation électrique B1V', 'ELECTRIQUE', 'SALARIE', 36, 30),
 ('ELEC_H0B0', 'Habilitation électrique H0B0', 'ELECTRIQUE', 'SALARIE', 36, 31),
 ('SST', 'Sauveteur secouriste du travail (SST)', 'SECURITE', 'SALARIE', 24, 40),
 ('AIPR', 'AIPR (travaux à proximité des réseaux)', 'SECURITE', 'SALARIE', 60, 41),
 ('AMIANTE_SS4', 'Amiante sous-section 4', 'SECURITE', 'SALARIE', 36, 42),
 ('VISITE_MEDICALE', 'Visite médicale (aptitude)', 'MEDICAL', 'SALARIE', 24, 50),
 ('VGP', 'Vérification générale périodique (levage)', 'CONTROLE', 'MATERIEL', 6, 60),
 ('CONTROLE_TECHNIQUE', 'Contrôle technique (véhicule)', 'CONTROLE', 'MATERIEL', 24, 61)
ON CONFLICT (tha_code) DO NOTHING;

-- Habilitation d'un salarié ou d'un matériel : obtention, fin de validité (nulle : calculée depuis la durée du type),
-- numéro, organisme, pièce de la GED.
CREATE TABLE IF NOT EXISTS habilitation (
    hab_id               SERIAL        PRIMARY KEY,
    hab_tha_code         VARCHAR(30)   NOT NULL REFERENCES type_habilitation(tha_code) ON UPDATE CASCADE,
    hab_type_element     VARCHAR(10)   NOT NULL CHECK (hab_type_element IN ('salarie', 'materiel')),
    hab_id_element       INT           NOT NULL,
    hab_obtenue_le       DATE,
    hab_valide_jusqu_au  DATE,
    hab_numero           VARCHAR(60),
    hab_organisme        VARCHAR(120),
    hab_dge_id           BIGINT,
    hab_commentaire      TEXT,
    hab_maj_par          VARCHAR(50),
    hab_maj_le           TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hab_element ON habilitation (hab_type_element, hab_id_element);
CREATE INDEX IF NOT EXISTS ix_hab_fin ON habilitation (hab_valide_jusqu_au);

-- Démonstration (une fois) : visites médicales des salariés actifs, SST, travail en hauteur et CACES sur chantier ;
-- VGP des engins de levage, contrôle technique des véhicules. Quelques-unes expirées ou à renouveler.
INSERT INTO habilitation (hab_tha_code, hab_type_element, hab_id_element, hab_obtenue_le, hab_valide_jusqu_au, hab_organisme, hab_maj_par)
SELECT x.code, 'salarie', s.sal_id, current_date - x.age, (current_date - x.age) + make_interval(months => t.tha_duree_mois), x.organisme, 'demo'
FROM salarie s
CROSS JOIN LATERAL (VALUES
    ('VISITE_MEDICALE', (s.sal_id * 37) % 760, 'Service de santé au travail BTP', TRUE),
    ('SST', (s.sal_id * 53) % 800, 'OPPBTP', s.sal_service = 'Chantier' AND s.sal_id % 3 = 0),
    ('HAUTEUR', (s.sal_id * 29) % 1200, 'OPPBTP', s.sal_service IN ('Chantier', 'Atelier') AND s.sal_id % 5 = 0),
    ('CACES_R482_A', (s.sal_id * 41) % 4000, 'Centre de formation CACES', s.sal_service = 'Chantier' AND s.sal_id % 4 = 0),
    ('CACES_R486_B', (s.sal_id * 17) % 2000, 'Centre de formation CACES', s.sal_service = 'Chantier' AND s.sal_id % 6 = 0),
    ('ELEC_B1V', (s.sal_id * 23) % 1200, 'Organisme agréé', s.sal_service = 'Atelier' AND s.sal_id % 4 = 0)
) AS x(code, age, organisme, retenu)
JOIN type_habilitation t ON t.tha_code = x.code
WHERE s.sal_actif AND x.retenu AND NOT EXISTS (SELECT 1 FROM habilitation WHERE hab_maj_par = 'demo');

INSERT INTO habilitation (hab_tha_code, hab_type_element, hab_id_element, hab_obtenue_le, hab_valide_jusqu_au, hab_organisme, hab_maj_par)
SELECT x.code, 'materiel', m.mat_id, current_date - x.age, (current_date - x.age) + make_interval(months => t.tha_duree_mois), 'Bureau de contrôle', 'demo-materiel'
FROM materiel m
CROSS JOIN LATERAL (VALUES ('VGP', (m.mat_id * 13) % 200, m.mat_famille = 'Levage'), ('CONTROLE_TECHNIQUE', (m.mat_id * 31) % 760, m.mat_famille = 'Véhicules'))
     AS x(code, age, retenu)
JOIN type_habilitation t ON t.tha_code = x.code
WHERE x.retenu AND NOT EXISTS (SELECT 1 FROM habilitation WHERE hab_maj_par = 'demo-materiel');

-- Équipes : service, chef, compositions datées (périodes souples, jamais supprimées : mises en sommeil).
ALTER TABLE equipe ADD COLUMN IF NOT EXISTS equ_srv_id INT REFERENCES service(srv_id) ON DELETE SET NULL;
ALTER TABLE equipe ADD COLUMN IF NOT EXISTS equ_chef_sal_id INT REFERENCES salarie(sal_id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS equipe_composition (
    eqc_id       SERIAL        PRIMARY KEY,
    eqc_equ_id   INT           NOT NULL REFERENCES equipe(equ_id) ON DELETE CASCADE,
    eqc_sal_id   INT           NOT NULL REFERENCES salarie(sal_id) ON DELETE CASCADE,
    eqc_du       DATE          NOT NULL,
    eqc_au       DATE,
    eqc_chef     BOOLEAN       NOT NULL DEFAULT FALSE,
    CONSTRAINT ck_eqc_periode CHECK (eqc_au IS NULL OR eqc_au >= eqc_du)
);
CREATE INDEX IF NOT EXISTS ix_eqc_equipe ON equipe_composition (eqc_equ_id, eqc_du);
CREATE INDEX IF NOT EXISTS ix_eqc_salarie ON equipe_composition (eqc_sal_id, eqc_du);
UPDATE equipe SET equ_srv_id = (SELECT srv_id FROM service WHERE srv_code = 'CHANTIER') WHERE equ_srv_id IS NULL;
-- Démonstration (une fois) : chaque équipe reçoit de 3 à 6 salariés de chantier actifs, le premier chef d'équipe.
INSERT INTO equipe_composition (eqc_equ_id, eqc_sal_id, eqc_du, eqc_chef)
SELECT e.equ_id, s.sal_id, current_date - 180, s.rang = 1
FROM equipe e
CROSS JOIN LATERAL (
    SELECT sal_id, row_number() OVER (ORDER BY sal_id) AS rang FROM salarie
    WHERE sal_actif AND sal_service = 'Chantier' AND sal_statut <> 'INTERIM' AND sal_id % 12 = e.equ_id % 12
    ORDER BY sal_id LIMIT 3 + e.equ_id % 4
) s
WHERE NOT EXISTS (SELECT 1 FROM equipe_composition);
UPDATE equipe e SET equ_chef_sal_id = c.eqc_sal_id
FROM equipe_composition c WHERE c.eqc_equ_id = e.equ_id AND c.eqc_chef AND e.equ_chef_sal_id IS NULL;

-- Motifs typés (§ 4.4) : blocage d'un ordre, non-conformité, écart de planning ; service à prévenir.
CREATE TABLE IF NOT EXISTS motif (
    mot_id        SERIAL        PRIMARY KEY,
    mot_domaine   VARCHAR(20)   NOT NULL CHECK (mot_domaine IN ('BLOCAGE', 'NON_CONFORMITE', 'ECART_PLANNING', 'AUTRE')),
    mot_code      VARCHAR(30)   NOT NULL,
    mot_libelle   VARCHAR(120)  NOT NULL,
    mot_srv_id    INT           REFERENCES service(srv_id) ON DELETE SET NULL,
    mot_ordre     INT           NOT NULL DEFAULT 0,
    mot_actif     BOOLEAN       NOT NULL DEFAULT TRUE,
    UNIQUE (mot_domaine, mot_code)
);
INSERT INTO motif (mot_domaine, mot_code, mot_libelle, mot_srv_id, mot_ordre)
SELECT m.domaine, m.code, m.libelle, (SELECT srv_id FROM service WHERE srv_code = m.service), m.ordre
FROM (VALUES
    ('BLOCAGE', 'ACHAT', 'Problème d''achat', 'ACHAT', 10),
    ('BLOCAGE', 'RETOUR_TIERS', 'Pas de retour d''un tiers', 'VENTE', 20),
    ('BLOCAGE', 'CONDITIONS', 'Conditions d''intervention non réunies', 'CHANTIER', 30),
    ('BLOCAGE', 'PLAN_NON_VISE', 'Plan non visé', 'BE', 40),
    ('NON_CONFORMITE', 'COMMANDE', 'Problème de commande', 'ACHAT', 10),
    ('NON_CONFORMITE', 'MATERIAUX', 'Matériaux manquants ou non conformes', 'ACHAT', 20),
    ('NON_CONFORMITE', 'PLAN', 'Erreur ou manque sur le plan', 'BE', 30),
    ('NON_CONFORMITE', 'FABRICATION', 'Défaut de fabrication', 'ATELIER', 40),
    ('NON_CONFORMITE', 'AUTRE', 'Autre problème', NULL, 90),
    ('ECART_PLANNING', 'INTEMPERIE', 'Intempéries', 'CHANTIER', 10),
    ('ECART_PLANNING', 'ABSENCE', 'Absence', NULL, 20),
    ('ECART_PLANNING', 'LIVRAISON', 'Livraison décalée', 'ACHAT', 30),
    ('ECART_PLANNING', 'FABRICATION', 'Fabrication interrompue', 'ATELIER', 40)
) AS m(domaine, code, libelle, service, ordre)
ON CONFLICT (mot_domaine, mot_code) DO NOTHING;

-- 5. Natures de main-d'œuvre → service ----------------------------------------------------------------------------
ALTER TABLE nature_element ADD COLUMN IF NOT EXISTS nat_srv_id INT REFERENCES service(srv_id) ON DELETE SET NULL;
INSERT INTO nature_element (nat_code, nat_libelle, nat_rgn_code, nat_srv_id)
SELECT n.code, n.libelle, 'MO', (SELECT srv_id FROM service WHERE srv_code = n.service)
FROM (VALUES ('MO_ATELIER', 'Main-d''œuvre atelier', 'ATELIER'), ('MO_POSE', 'Main-d''œuvre pose', 'CHANTIER'), ('MO_ETUDES', 'Main-d''œuvre études', 'BE'))
     AS n(code, libelle, service)
WHERE EXISTS (SELECT 1 FROM regroupement_nature WHERE rgn_code = 'MO')
ON CONFLICT (nat_code) DO NOTHING;
UPDATE nature_element SET nat_srv_id = (SELECT srv_id FROM service WHERE srv_code = 'CHANTIER') WHERE nat_code = 'MO' AND nat_srv_id IS NULL;
