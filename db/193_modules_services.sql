-- Cœur LogiBTP – activation des modules par société et référentiel des services (ANALYSE-MODULES-TRANSVERSE.md § 3
-- et § 4.1, CRM C18 / C30). Rejouable.
--
-- module_societe : un module facultatif est activé par un drapeau (ses tables existent toujours) ; désactivé, ses
-- écrans sont masqués et ses routes refusent (409 MODULE_INACTIF), ses données restent.
-- service : services de l'entreprise (deux niveaux : service et sous-service), dont Vente et Achat (administratifs).
-- service_membre : salariés (individus de notre société) rattachés à un ou plusieurs services, dont un principal.

CREATE TABLE IF NOT EXISTS module_societe (
    mod_code         VARCHAR(30)   PRIMARY KEY,
    mod_libelle      VARCHAR(80)   NOT NULL,
    mod_description  TEXT,
    mod_actif        BOOLEAN       NOT NULL DEFAULT TRUE,
    mod_dependances  JSONB         NOT NULL DEFAULT '[]',   -- codes des modules qui doivent être actifs
    mod_ordre        INT           NOT NULL DEFAULT 0,
    mod_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    mod_maj_par      VARCHAR(50)
);

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_ordre) VALUES
 ('reglement', 'Règlements', 'Règlements reçus et émis, cautions, pointage des échéances, reste à payer', 10),
 ('crm', 'CRM', 'Demandes, actions, messages et tâches, rappels, suivi des validations des plans, bordereaux de diffusion, fil d''actualité', 20)
ON CONFLICT (mod_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS service (
    srv_id           SERIAL        PRIMARY KEY,
    srv_code         VARCHAR(20)   NOT NULL UNIQUE,
    srv_libelle      VARCHAR(80)   NOT NULL,
    srv_parent_id    INT           REFERENCES service(srv_id) ON DELETE RESTRICT,
    srv_nature       VARCHAR(15)   NOT NULL DEFAULT 'PRODUCTION'
                     CHECK (srv_nature IN ('PRODUCTION', 'ETUDE', 'LOGISTIQUE', 'ADMINISTRATIF')),
    srv_responsable_id BIGINT      REFERENCES individu(ind_id) ON DELETE SET NULL,
    srv_ordre        INT           NOT NULL DEFAULT 0,
    srv_actif        BOOLEAN       NOT NULL DEFAULT TRUE,
    srv_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Deux niveaux seulement : un sous-service n'a pas lui-même de sous-service.
CREATE OR REPLACE FUNCTION f_service_niveaux() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.srv_parent_id IS NOT NULL THEN
        IF NEW.srv_parent_id = NEW.srv_id
           OR EXISTS (SELECT 1 FROM service WHERE srv_id = NEW.srv_parent_id AND srv_parent_id IS NOT NULL)
           OR EXISTS (SELECT 1 FROM service WHERE srv_parent_id = NEW.srv_id) THEN
            RAISE EXCEPTION 'SERVICE_NIVEAUX : deux niveaux de services au plus (service, sous-service)' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_service_niveaux ON service;
CREATE TRIGGER tr_service_niveaux BEFORE INSERT OR UPDATE ON service FOR EACH ROW EXECUTE FUNCTION f_service_niveaux();

CREATE TABLE IF NOT EXISTS service_membre (
    sme_srv_id       INT           NOT NULL REFERENCES service(srv_id) ON DELETE CASCADE,
    sme_ind_id       BIGINT        NOT NULL REFERENCES individu(ind_id) ON DELETE CASCADE,
    sme_principal    BOOLEAN       NOT NULL DEFAULT FALSE,
    PRIMARY KEY (sme_srv_id, sme_ind_id)
);
CREATE INDEX IF NOT EXISTS ix_sme_ind ON service_membre (sme_ind_id);
-- Un seul service principal par salarié.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sme_principal ON service_membre (sme_ind_id) WHERE sme_principal;

INSERT INTO service (srv_code, srv_libelle, srv_nature, srv_ordre) VALUES
 ('DIRECTION', 'Direction', 'ADMINISTRATIF', 10),
 ('VENTE', 'Vente', 'ADMINISTRATIF', 20),
 ('ACHAT', 'Achat', 'ADMINISTRATIF', 30),
 ('ADMIN', 'Administration (bureau)', 'ADMINISTRATIF', 40),
 ('BE', 'Bureau d''études', 'ETUDE', 50),
 ('ATELIER', 'Atelier', 'PRODUCTION', 60),
 ('CHANTIER', 'Chantier (travaux)', 'PRODUCTION', 70)
ON CONFLICT (srv_code) DO NOTHING;

-- Salariés de démonstration : service principal repris de leur service (texte libre de salarie), une fois.
INSERT INTO service_membre (sme_srv_id, sme_ind_id, sme_principal)
SELECT s.srv_id, d.sal_ind_id, TRUE
FROM salarie d
JOIN service s ON s.srv_code = CASE d.sal_service WHEN 'Atelier' THEN 'ATELIER' WHEN 'Bureau' THEN 'ADMIN'
                                                  WHEN 'Direction' THEN 'DIRECTION' WHEN 'Chantier' THEN 'CHANTIER' END
WHERE d.sal_ind_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM individu i WHERE i.ind_id = d.sal_ind_id)
  AND NOT EXISTS (SELECT 1 FROM service_membre m WHERE m.sme_ind_id = d.sal_ind_id)
ON CONFLICT DO NOTHING;
