-- =============================================================================
-- Cœur – état d'utilisation des fiches (analyse des demandes du 25/10/2026, lot 3 : A19b, A19c). Rejouable.
--
-- <préfixe>_usage : A en service, N ne plus utiliser (les documents en cours se terminent, plus de nouveau choix),
-- S en sommeil (avant archivage : masquée par défaut dans les listes, module Liste, colonne « usage » des sources).
-- Tables : salarie, materiel, element, personne, individu. La colonne « actif » existante reste tenue d'accord
-- (actif = usage <> S) dans les deux sens par trigger : le code qui lit ou écrit « actif » continue de fonctionner.
-- =============================================================================

DO $do$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT * FROM (VALUES ('salarie', 'sal', 'sal_actif'), ('materiel', 'mat', NULL), ('element', 'ele', 'ele_actif'),
                                   ('personne', 'per', 'per_actif'), ('individu', 'ind', 'ind_actif')) AS v(tab, pre, actif)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t.tab AND column_name = t.pre || '_usage') THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN %I CHAR(1) NOT NULL DEFAULT %L', t.tab, t.pre || '_usage', 'A');
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IN (''A'', ''N'', ''S''))', t.tab, 'ck_' || t.pre || '_usage', t.pre || '_usage');
            IF t.actif IS NOT NULL THEN
                EXECUTE format('UPDATE %I SET %I = ''S'' WHERE NOT %I', t.tab, t.pre || '_usage', t.actif);
            END IF;
        END IF;
        IF t.actif IS NOT NULL THEN
            -- usage changé → actif ; sinon actif changé → usage (désactivé : en sommeil ; réactivé : en service).
            EXECUTE format($f$
                CREATE OR REPLACE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $b$
                BEGIN
                    IF TG_OP = 'INSERT' THEN
                        IF NEW.%I = 'S' THEN NEW.%I := FALSE; ELSIF NOT NEW.%I THEN NEW.%I := 'S'; END IF;
                    ELSIF NEW.%I IS DISTINCT FROM OLD.%I THEN
                        NEW.%I := NEW.%I <> 'S';
                    ELSIF NEW.%I IS DISTINCT FROM OLD.%I THEN
                        NEW.%I := CASE WHEN NEW.%I THEN 'A' ELSE 'S' END;
                    END IF;
                    RETURN NEW;
                END $b$ $f$,
                'f_' || t.tab || '_usage',
                t.pre || '_usage', t.actif, t.actif, t.pre || '_usage',
                t.pre || '_usage', t.pre || '_usage', t.actif, t.pre || '_usage',
                t.actif, t.actif, t.pre || '_usage', t.actif);
            EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'tr_' || t.tab || '_usage', t.tab);
            EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
                'tr_' || t.tab || '_usage', t.tab, 'f_' || t.tab || '_usage');
        END IF;
    END LOOP;
END $do$;

-- Colonne « usage » des sources de listes (ajoutée en fin de vue).
CREATE OR REPLACE VIEW v_liste_salaries AS
SELECT s.sal_id AS id, CASE WHEN s.sal_statut = 'INTERIM' THEN 'interim' ELSE 'salarie' END AS type_element, s.sal_matricule AS matricule,
       s.sal_nom AS nom, s.sal_prenom AS prenom,
       coalesce((SELECT sv.srv_libelle FROM service sv WHERE sv.srv_code = s.sal_service), s.sal_service)::text AS service, s.sal_poste AS poste,
       s.sal_statut AS statut, s.sal_date_entree AS date_entree, s.sal_salaire AS salaire_brut, s.sal_heures_mois AS heures_mois,
       s.sal_actif AS actif, s.sal_commentaire AS commentaire, s.sal_code AS code, s.sal_matricule_paie AS matricule_paie,
       s.sal_service AS service_code, s.sal_usage AS usage
FROM salarie s;

CREATE OR REPLACE VIEW v_liste_materiels AS
SELECT m.mat_id AS id, m.mat_code AS code, m.mat_designation AS designation,
       coalesce((SELECT l.lva_libelle FROM liste_valeur l WHERE l.lva_liste = 'TYPE_MATERIEL' AND l.lva_code = m.mat_famille), m.mat_famille)::text AS famille,
       m.mat_etat AS etat, m.mat_chantier AS chantier, m.mat_valeur_achat AS valeur_achat, m.mat_date_achat AS date_achat,
       m.mat_heures AS heures_utilisation, m.mat_heures_revision AS heures_revision, m.mat_controle_ok AS controle_ok,
       m.mat_observations AS observations, m.mat_famille AS famille_code, m.mat_usage AS usage
FROM materiel m;

CREATE OR REPLACE VIEW v_liste_elements AS
SELECT e.ele_id AS id, 'element'::text AS type_element, b.bib_code, e.ele_code AS code, e.ele_type AS type, e.ele_libelle AS libelle,
       f.chemin AS famille, n.nat_libelle AS nature, r.rgn_libelle AS regroupement, e.ele_gestion AS gestion, e.ele_unt_stock AS unite_stock,
       e.ele_scenario_pa AS scenario_pa, e.ele_pa AS pa, e.ele_coef_fg AS coef_fg, e.ele_pr AS pr, e.ele_coef_benef AS coef_benef,
       e.ele_pv AS pv, e.ele_pv_net AS pv_net, e.ele_actif AS actif, e.ele_modifie_le AS modifie_le, e.ele_fam_id AS fam_id, e.ele_nat_id AS nat_id,
       coalesce((SELECT array_agg(m.sam_mrq_code ORDER BY m.sam_mrq_code) FROM stk_article_marque m WHERE m.sam_ele_id = e.ele_id), '{}'::varchar[]) AS marques,
       e.ele_usage AS usage
FROM element e
JOIN bibliotheque b ON b.bib_id = e.ele_bib_id
LEFT JOIN v_famille_element f ON f.fam_id = e.ele_fam_id
LEFT JOIN nature_element n ON n.nat_id = e.ele_nat_id
LEFT JOIN regroupement_nature r ON r.rgn_code::text = n.nat_rgn_code::text;

CREATE OR REPLACE VIEW v_liste_personnes AS
SELECT per_id AS id, 'personne'::text AS type_element, per_code AS code, per_raison_sociale AS raison_sociale, per_nom_commercial AS nom_commercial,
       per_niv_code AS niveau, ARRAY(SELECT jsonb_array_elements_text(v.per_casquettes)) AS casquettes, parent, chemin,
       per_siren AS siren, per_siret AS siret, per_tva_intra AS tva_intra, per_pays AS pays, adresse, code_postal, ville, telephone, email, contact,
       per_societe_base AS societe_base, per_actif AS actif, per_modifie_le AS modifie_le, per_provisoire AS provisoire,
       (SELECT p.per_usage FROM personne p WHERE p.per_id = v.per_id) AS usage
FROM v_annuaire_personnes v;

CREATE OR REPLACE VIEW v_liste_individus AS
SELECT ind_id AS id, 'individu'::text AS type_element, ind_civilite AS civilite, ind_nom AS nom, ind_prenom AS prenom, nom_complet, personnes,
       fonction, ARRAY(SELECT jsonb_array_elements_text(v.ind_roles)) AS roles, telephone, portable, email, ville,
       ind_utilisateur AS utilisateur, ind_actif AS actif, ind_modifie_le AS modifie_le,
       (SELECT i.ind_usage FROM individu i WHERE i.ind_id = v.ind_id) AS usage
FROM v_annuaire_individus v;

-- Chantiers de dotation des salariés (module Stock, db/219) : ouverts tant que le salarié n'est pas en sommeil, clos à
-- sa mise en sommeil, rouverts s'il est remis en service ; jamais proposés comme chantiers de travaux (f_chantier_dotation).
CREATE OR REPLACE FUNCTION f_chantier_dotation(p_cha_id INT) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM salarie WHERE sal_cha_dotation_id = p_cha_id)
$$;

CREATE OR REPLACE FUNCTION f_salarie_dotation_statut() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.sal_cha_dotation_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.sal_usage IS DISTINCT FROM OLD.sal_usage
                                                OR NEW.sal_cha_dotation_id IS DISTINCT FROM OLD.sal_cha_dotation_id) THEN
        UPDATE chantier SET cha_statut = CASE WHEN NEW.sal_usage = 'S' THEN 'CLOS' ELSE 'OUVERT' END
        WHERE cha_id = NEW.sal_cha_dotation_id AND cha_statut IS DISTINCT FROM CASE WHEN NEW.sal_usage = 'S' THEN 'CLOS' ELSE 'OUVERT' END;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_salarie_dotation_statut ON salarie;
CREATE TRIGGER tr_salarie_dotation_statut AFTER INSERT OR UPDATE OF sal_usage, sal_cha_dotation_id ON salarie
    FOR EACH ROW EXECUTE FUNCTION f_salarie_dotation_statut();

UPDATE chantier c SET cha_statut = CASE WHEN s.sal_usage = 'S' THEN 'CLOS' ELSE 'OUVERT' END
FROM salarie s
WHERE s.sal_cha_dotation_id = c.cha_id AND c.cha_statut IS DISTINCT FROM CASE WHEN s.sal_usage = 'S' THEN 'CLOS' ELSE 'OUVERT' END;
