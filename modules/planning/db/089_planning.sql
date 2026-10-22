-- =============================================================================
-- Module Planning, lot 2 : tâches (théoriques sans affectation, fonctionnelles avec), affectations des ressources
-- (salariés, intérimaires, matériels, sous-traitants… désignés par type et identifiant de l'application ; équipe
-- d'origine gardée, P7), vues (fournies ou personnelles). Instants locaux (timestamp sans fuseau), heures en minutes.
-- Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pla_tache (
    tac_id            BIGSERIAL PRIMARY KEY,
    tac_calcul        SMALLINT     NOT NULL DEFAULT 1 CHECK (tac_calcul BETWEEN 1 AND 3),
    tac_debut         TIMESTAMP(0) NOT NULL,
    tac_fin           TIMESTAMP(0) NOT NULL,
    tac_heures        INT          NOT NULL DEFAULT 0 CHECK (tac_heures >= 0),
    tac_nb_ressources SMALLINT     NOT NULL DEFAULT 1 CHECK (tac_nb_ressources >= 1),
    tac_srv_id        INT,
    tac_type_element  VARCHAR(30)  NOT NULL DEFAULT 'chantier',
    tac_id_element    VARCHAR(40),
    tac_origine_type  VARCHAR(30),
    tac_origine_id    VARCHAR(40),
    tac_parent_id     BIGINT REFERENCES pla_tache (tac_id) ON DELETE CASCADE,
    tac_libelle       VARCHAR(200) NOT NULL,
    tac_memo          TEXT,
    tac_avancement    SMALLINT     NOT NULL DEFAULT 0 CHECK (tac_avancement BETWEEN 0 AND 100),
    tac_couleur       VARCHAR(9),
    tac_etat          VARCHAR(10)  NOT NULL DEFAULT 'PREVUE' CHECK (tac_etat IN ('OPTION', 'PREVUE', 'CONFIRMEE', 'EN_COURS', 'TERMINEE')),
    tac_mobile        JSONB        NOT NULL DEFAULT '{}',
    tac_habilitations TEXT[]       NOT NULL DEFAULT '{}',
    tac_version       INT          NOT NULL DEFAULT 1,
    tac_cree_par      VARCHAR(50)  NOT NULL,
    tac_cree_le       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    tac_maj_par       VARCHAR(50),
    tac_maj_le        TIMESTAMPTZ,
    CHECK (tac_fin >= tac_debut)
);
COMMENT ON COLUMN pla_tache.tac_calcul IS '1 : début + heures → fin ; 2 : début + fin → heures ; 3 : charge (heures ventilées par jour)';
COMMENT ON COLUMN pla_tache.tac_type_element IS 'chantier, projet, absence (indisponibilité des ressources affectées), interne…';
COMMENT ON COLUMN pla_tache.tac_origine_type IS 'Origine des heures consommées : chantier, commande, tranche, ligne, ordre (P16)';
CREATE INDEX IF NOT EXISTS ix_tac_periode ON pla_tache (tac_debut, tac_fin);
CREATE INDEX IF NOT EXISTS ix_tac_element ON pla_tache (tac_type_element, tac_id_element);
CREATE INDEX IF NOT EXISTS ix_tac_srv ON pla_tache (tac_srv_id);

CREATE TABLE IF NOT EXISTS pla_affectation (
    aff_id        BIGSERIAL PRIMARY KEY,
    aff_tac_id    BIGINT      NOT NULL REFERENCES pla_tache (tac_id) ON DELETE CASCADE,
    aff_res_type  VARCHAR(20) NOT NULL,
    aff_res_id    VARCHAR(40) NOT NULL,
    aff_equipe_id INT,
    aff_heures    INT         NOT NULL DEFAULT 0,
    aff_quantite  NUMERIC(12, 3),
    UNIQUE (aff_tac_id, aff_res_type, aff_res_id)
);
COMMENT ON COLUMN pla_affectation.aff_heures IS 'Heures de travail (ou d''utilisation pour un matériel) de la ressource dans la tâche, en minutes';
COMMENT ON COLUMN pla_affectation.aff_quantite IS 'Unités d''un matériel géré par nombre (P5)';
CREATE INDEX IF NOT EXISTS ix_aff_res ON pla_affectation (aff_res_type, aff_res_id);

CREATE TABLE IF NOT EXISTS pla_vue (
    pvu_id          SERIAL PRIMARY KEY,
    pvu_code        VARCHAR(30) NOT NULL UNIQUE,
    pvu_libelle     VARCHAR(80) NOT NULL,
    pvu_utilisateur VARCHAR(50),
    pvu_definition  JSONB       NOT NULL,
    pvu_ordre       INT         NOT NULL DEFAULT 0
);
COMMENT ON COLUMN pla_vue.pvu_definition IS 'regroupement (RESSOURCE, CHANTIER, SERVICE), echelle, avant / apres (jours, période flottante), services (codes), types de ressources, hauteur_adaptee';

-- Vues fournies (§ 6) : globales, l'utilisateur part d'une vue et l'enregistre.
INSERT INTO pla_vue (pvu_code, pvu_libelle, pvu_definition, pvu_ordre) VALUES
 ('ATELIER_JOUR', 'Atelier par jour', '{"regroupement": "RESSOURCE", "echelle": "JOUR", "avant": 7, "apres": 21, "services": ["ATELIER", "FAB_BOIS", "FAB_METAL"], "types": ["SALARIE", "INTERIM", "MATERIEL"], "hauteur_adaptee": true}', 10),
 ('POSE_SEMAINE', 'Pose par semaine', '{"regroupement": "RESSOURCE", "echelle": "DEMI_JOUR", "avant": 3, "apres": 11, "services": ["CHANTIER", "POSE"], "types": ["SALARIE", "INTERIM", "MATERIEL", "SOUS_TRAITANT"], "hauteur_adaptee": true}', 20),
 ('CHANTIERS_GANTT', 'Chantiers (Gantt)', '{"regroupement": "CHANTIER", "echelle": "SEMAINE", "avant": 28, "apres": 120, "services": [], "types": [], "hauteur_adaptee": true}', 30),
 ('CHARGE_SERVICE', 'Charge par service', '{"regroupement": "SERVICE", "echelle": "JOUR", "avant": 7, "apres": 42, "services": [], "types": [], "hauteur_adaptee": true}', 40),
 ('LIVRAISONS', 'Livraisons', '{"regroupement": "RESSOURCE", "echelle": "HEURE", "avant": 1, "apres": 6, "services": ["LOGISTIQUE"], "types": ["SALARIE", "MATERIEL"], "hauteur_adaptee": true}', 50)
ON CONFLICT (pvu_code) DO NOTHING;
