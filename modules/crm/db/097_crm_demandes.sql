-- Module CRM LogiBTP – demandes : pré-dossiers suivis avant la création du projet, pour la veille commerciale
-- (ANALYSE-MODULE-CRM.md, lot 3 : C8, C16, C18). Les notes d'une demande lui sont rattachées comme à tout élément
-- (crm_note_lien, type « crm_demande ») ; le projet créé est désigné par (dem_cible_type, dem_cible_id). Rejouable.

CREATE TABLE IF NOT EXISTS crm_demande (
    dem_id               BIGSERIAL     PRIMARY KEY,
    dem_numero           VARCHAR(20)   NOT NULL UNIQUE,              -- DEM-AAAA-NNNN
    dem_objet            VARCHAR(200)  NOT NULL,
    dem_description_html TEXT,
    dem_etat             VARCHAR(12)   NOT NULL DEFAULT 'VEILLE'
                         CHECK (dem_etat IN ('VEILLE', 'A_ETUDIER', 'EN_COURS', 'TRANSFORMEE', 'SANS_SUITE')),
    dem_motif            VARCHAR(12)   CHECK (dem_motif IN ('PERDUE', 'NON_RETENUE', 'ABANDONNEE')),
    dem_tiers_id         BIGINT,                                       -- tiers (éventuellement provisoire)
    dem_ind_id           BIGINT,                                       -- contact
    dem_srv_id           INT,                                          -- service (à prendre si pas de responsable)
    dem_responsable_id   BIGINT,
    dem_echeance         DATE,                                         -- réponse attendue
    dem_montant_estime   NUMERIC(18,2) CHECK (dem_montant_estime IS NULL OR dem_montant_estime >= 0),
    dem_origine          VARCHAR(80),                                  -- appel d'offres, recommandation, site…
    dem_cible_type       VARCHAR(30),
    dem_cible_id         VARCHAR(50),
    dem_cree_par         VARCHAR(50)   NOT NULL,
    dem_cree_le          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    dem_maj_par          VARCHAR(50),
    dem_maj_le           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CHECK ((dem_etat = 'SANS_SUITE') = (dem_motif IS NOT NULL)),
    CHECK ((dem_etat = 'TRANSFORMEE') = (dem_cible_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_dem_responsable ON crm_demande (dem_responsable_id, dem_etat);
CREATE INDEX IF NOT EXISTS ix_dem_service ON crm_demande (dem_srv_id, dem_etat) WHERE dem_responsable_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_dem_tiers ON crm_demande (dem_tiers_id);

-- Historique des demandes : création, état, responsable, service.
CREATE TABLE IF NOT EXISTS crm_demande_historique (
    dhi_id      BIGSERIAL     PRIMARY KEY,
    dhi_dem_id  BIGINT        NOT NULL REFERENCES crm_demande(dem_id) ON DELETE CASCADE,
    dhi_quoi    VARCHAR(20)   NOT NULL,
    dhi_avant   TEXT,
    dhi_apres   TEXT,
    dhi_par     VARCHAR(50),
    dhi_le      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_dhi_demande ON crm_demande_historique (dhi_dem_id, dhi_le);

CREATE OR REPLACE FUNCTION f_crm_demande_historique() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO crm_demande_historique (dhi_dem_id, dhi_quoi, dhi_apres, dhi_par) VALUES (NEW.dem_id, 'CREATION', NEW.dem_etat, NEW.dem_cree_par);
        RETURN NEW;
    END IF;
    IF NEW.dem_etat IS DISTINCT FROM OLD.dem_etat THEN
        INSERT INTO crm_demande_historique (dhi_dem_id, dhi_quoi, dhi_avant, dhi_apres, dhi_par) VALUES (NEW.dem_id, 'ETAT', OLD.dem_etat, NEW.dem_etat, NEW.dem_maj_par);
    END IF;
    IF NEW.dem_responsable_id IS DISTINCT FROM OLD.dem_responsable_id THEN
        INSERT INTO crm_demande_historique (dhi_dem_id, dhi_quoi, dhi_avant, dhi_apres, dhi_par)
        VALUES (NEW.dem_id, 'RESPONSABLE', OLD.dem_responsable_id::text, NEW.dem_responsable_id::text, NEW.dem_maj_par);
    END IF;
    IF NEW.dem_srv_id IS DISTINCT FROM OLD.dem_srv_id THEN
        INSERT INTO crm_demande_historique (dhi_dem_id, dhi_quoi, dhi_avant, dhi_apres, dhi_par) VALUES (NEW.dem_id, 'SERVICE', OLD.dem_srv_id::text, NEW.dem_srv_id::text, NEW.dem_maj_par);
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_crm_demande_historique ON crm_demande;
CREATE TRIGGER tr_crm_demande_historique AFTER INSERT OR UPDATE ON crm_demande FOR EACH ROW EXECUTE FUNCTION f_crm_demande_historique();

-- Éléments du CRM pouvant porter des pièces dans la GED (appelée par f_ged_element_existe du cœur pour les types crm_*) :
-- NULL = type inconnu, FALSE = élément inexistant.
CREATE OR REPLACE FUNCTION f_crm_element_existe(p_type TEXT, p_id BIGINT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT CASE p_type
        WHEN 'crm_note' THEN EXISTS (SELECT 1 FROM crm_note WHERE not_id = p_id)
        WHEN 'crm_demande' THEN EXISTS (SELECT 1 FROM crm_demande WHERE dem_id = p_id)
        ELSE NULL
    END
$$;
