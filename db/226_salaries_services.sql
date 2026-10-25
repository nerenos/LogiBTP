-- =============================================================================
-- Cœur – service du salarié relié au référentiel des services (analyse des demandes du 25/10/2026, B5). Rejouable.
--
-- salarie.sal_service portait un texte libre (Chantier, Bureau, Atelier, Direction) alors que le planning, le pointage
-- et l'exécution lisent le service principal de service_membre (db/193). Il porte désormais le code du service
-- (srv_code, clé étrangère) et reste aligné sur le service principal de l'individu du salarié dans les deux sens :
--   - saisie dans la fiche salarié → service_membre (service principal de l'individu) ;
--   - service principal changé ailleurs (planning, /parametres/services) → sal_service.
-- v_liste_salaries.service : libellé du service (lecture seule) ; service_code : son code. La vue reste sur la seule
-- table salarie (sous-requête pour le libellé) : saisie dans la liste toujours possible (vue modifiable).
-- =============================================================================

-- Les vues de liste dépendent de la colonne : supprimées ici, recréées en fin de script.
DROP VIEW IF EXISTS v_liste_ressources;
DROP VIEW IF EXISTS v_liste_salaries;

DROP TRIGGER IF EXISTS tr_salarie_service ON salarie;
ALTER TABLE salarie ALTER COLUMN sal_service DROP NOT NULL;
ALTER TABLE salarie ALTER COLUMN sal_service TYPE VARCHAR(20);

-- Reprise : service principal de l'individu, sinon correspondance des anciens libellés, sinon libellé ou code égal.
UPDATE salarie s SET sal_service = sv.srv_code
FROM service_membre m JOIN service sv ON sv.srv_id = m.sme_srv_id
WHERE m.sme_ind_id = s.sal_ind_id AND m.sme_principal AND s.sal_service IS DISTINCT FROM sv.srv_code;

UPDATE salarie s SET sal_service = sv.srv_code
FROM service sv
WHERE NOT EXISTS (SELECT 1 FROM service x WHERE x.srv_code = s.sal_service)
  AND sv.srv_code = CASE s.sal_service WHEN 'Atelier' THEN 'ATELIER' WHEN 'Bureau' THEN 'ADMIN' WHEN 'Direction' THEN 'DIRECTION'
                                       WHEN 'Chantier' THEN 'CHANTIER' END;

UPDATE salarie s SET sal_service = (SELECT sv.srv_code FROM service sv
                                    WHERE lower(sv.srv_libelle) = lower(s.sal_service) OR sv.srv_code = upper(s.sal_service)
                                    ORDER BY sv.srv_id LIMIT 1)
WHERE s.sal_service IS NOT NULL AND NOT EXISTS (SELECT 1 FROM service x WHERE x.srv_code = s.sal_service);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sal_service') THEN
        ALTER TABLE salarie ADD CONSTRAINT fk_sal_service FOREIGN KEY (sal_service) REFERENCES service (srv_code)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_sal_service ON salarie (sal_service);

-- Salariés sans service principal : celui de la fiche le devient.
INSERT INTO service_membre (sme_srv_id, sme_ind_id, sme_principal)
SELECT sv.srv_id, s.sal_ind_id, TRUE
FROM salarie s JOIN service sv ON sv.srv_code = s.sal_service
WHERE s.sal_ind_id IS NOT NULL AND EXISTS (SELECT 1 FROM individu i WHERE i.ind_id = s.sal_ind_id)
  AND NOT EXISTS (SELECT 1 FROM service_membre m WHERE m.sme_ind_id = s.sal_ind_id AND m.sme_principal)
ON CONFLICT (sme_srv_id, sme_ind_id) DO UPDATE SET sme_principal = TRUE;

-- Fiche salarié → service principal de l'individu (les autres appartenances restent, non principales).
CREATE OR REPLACE FUNCTION f_salarie_service() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_srv INT;
BEGIN
    IF NEW.sal_ind_id IS NULL OR NEW.sal_service IS NULL THEN RETURN NEW; END IF;
    SELECT srv_id INTO v_srv FROM service WHERE srv_code = NEW.sal_service;
    IF v_srv IS NULL OR EXISTS (SELECT 1 FROM service_membre WHERE sme_ind_id = NEW.sal_ind_id AND sme_srv_id = v_srv AND sme_principal) THEN
        RETURN NEW;
    END IF;
    UPDATE service_membre SET sme_principal = FALSE WHERE sme_ind_id = NEW.sal_ind_id AND sme_principal;
    INSERT INTO service_membre (sme_srv_id, sme_ind_id, sme_principal) VALUES (v_srv, NEW.sal_ind_id, TRUE)
    ON CONFLICT (sme_srv_id, sme_ind_id) DO UPDATE SET sme_principal = TRUE;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_salarie_service ON salarie;
CREATE TRIGGER tr_salarie_service AFTER INSERT OR UPDATE OF sal_service, sal_ind_id ON salarie
    FOR EACH ROW EXECUTE FUNCTION f_salarie_service();

-- Service principal changé ailleurs → fiche salarié (le trigger précédent ne fait alors plus rien : déjà aligné).
CREATE OR REPLACE FUNCTION f_service_membre_salarie() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.sme_principal THEN
        UPDATE salarie s SET sal_service = sv.srv_code
        FROM service sv
        WHERE sv.srv_id = NEW.sme_srv_id AND s.sal_ind_id = NEW.sme_ind_id AND s.sal_service IS DISTINCT FROM sv.srv_code;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_service_membre_salarie ON service_membre;
CREATE TRIGGER tr_service_membre_salarie AFTER INSERT OR UPDATE OF sme_principal, sme_srv_id ON service_membre
    FOR EACH ROW EXECUTE FUNCTION f_service_membre_salarie();

-- Vues de liste : libellé du service (type de la colonne changé : vues recréées, v_liste_ressources comme en 211).
CREATE VIEW v_liste_salaries AS
SELECT s.sal_id AS id, CASE WHEN s.sal_statut = 'INTERIM' THEN 'interim' ELSE 'salarie' END AS type_element, s.sal_matricule AS matricule,
       s.sal_nom AS nom, s.sal_prenom AS prenom,
       coalesce((SELECT sv.srv_libelle FROM service sv WHERE sv.srv_code = s.sal_service), s.sal_service)::text AS service, s.sal_poste AS poste,
       s.sal_statut AS statut, s.sal_date_entree AS date_entree, s.sal_salaire AS salaire_brut, s.sal_heures_mois AS heures_mois,
       s.sal_actif AS actif, s.sal_commentaire AS commentaire, s.sal_code AS code, s.sal_matricule_paie AS matricule_paie,
       s.sal_service AS service_code
FROM salarie s;

CREATE VIEW v_liste_ressources AS
SELECT 'EQU-' || equ_id AS id, 'equipe' AS type_element, equ_code AS code, equ_libelle AS libelle, equ_categorie::text AS categorie,
       'Chef : ' || equ_chef AS statut, equ_active AS disponible, (equ_effectif * 42)::numeric AS cout_horaire,
       equ_chantier AS chantier, 'Effectif ' || equ_effectif AS observations
FROM equipe
UNION ALL
SELECT 'SAL-' || id, type_element, matricule, prenom || ' ' || nom, service, poste, actif,
       round(salaire_brut * 1.45 / 151.67, 2), NULL, commentaire
FROM v_liste_salaries
UNION ALL
SELECT 'MAT-' || id, 'materiel', code, designation, famille, etat, etat = 'DISPO', round(valeur_achat / 2000, 2), chantier, observations
FROM v_liste_materiels
UNION ALL
SELECT 'SST-' || p.per_id, 'sous_traitant', coalesce(p.per_proprietes ->> 'code_demo', 'ST' || p.per_id), p.per_raison_sociale, p.per_st_corps_etat,
       CASE WHEN coalesce((p.per_proprietes ->> 'agree')::boolean, TRUE) THEN 'Agréé' ELSE 'Agrément en cours' END,
       p.per_actif, (p.per_proprietes ->> 'taux_horaire')::numeric, NULL, p.per_proprietes ->> 'observations'
FROM personne p WHERE p.per_casquettes ? 'SOUS_TRAITANT';
