-- Rôles PostgreSQL d'une installation LogiBTP (ANALYSE-MODULE-DROITS.md § 3.5, D18 ; ANALYSE-MODULE-INSTALLATION.md
-- § 6.2) ; rejouable, sans méta-commande psql (exécuté par l'installeur : « installation base creer | mettre-a-jour »),
-- avec un superutilisateur, sur chaque base de société, après les scripts de schéma. À la main :
--   psql -U postgres -d logibtp -v ON_ERROR_STOP=1 -f db/installation/roles.sql
--   puis ALTER ROLE logibtp_schema|logibtp_app|logibtp_lecture PASSWORD '…' (les rôles sont créés sans mot de passe).
--
--   logibtp_schema  : propriétaire des tables (scripts SQL, mises à jour, conversions) ; jamais utilisé par l'API en marche.
--   logibtp_app     : compte de l'API (.env : LOGIBTP_BASE_MOT_DE_PASSE_APP) ; lecture et écriture des données seulement,
--                     non propriétaire : il ne peut ni modifier le schéma ni désactiver un trigger (coffre de la GED).
--   logibtp_lecture : lecture seule (requêtes saisies, listes de valeurs par SELECT, outils de consultation).
-- Connexion limitée au réseau du serveur de l'application : pg_hba.conf généré par l'installeur.

DO $$
DECLARE
  base text := current_database();
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logibtp_schema') THEN CREATE ROLE logibtp_schema LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logibtp_app') THEN CREATE ROLE logibtp_app LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logibtp_lecture') THEN CREATE ROLE logibtp_lecture LOGIN; END IF;
  ALTER ROLE logibtp_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ALTER ROLE logibtp_lecture NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

  -- Le schéma appartient à logibtp_schema (base, tables, vues, séquences, fonctions).
  EXECUTE format('ALTER DATABASE %I OWNER TO logibtp_schema', base);
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', base);
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO logibtp_app, logibtp_lecture', base);

  FOR r IN SELECT format('ALTER TABLE %I.%I OWNER TO logibtp_schema', schemaname, tablename) AS q FROM pg_tables
           WHERE schemaname = 'public' AND tableowner <> 'logibtp_schema' LOOP
    EXECUTE r.q;
  END LOOP;
  FOR r IN SELECT format('ALTER VIEW %I.%I OWNER TO logibtp_schema', schemaname, viewname) AS q FROM pg_views
           WHERE schemaname = 'public' AND viewowner <> 'logibtp_schema' LOOP
    EXECUTE r.q;
  END LOOP;
  -- Séquences autonomes (celles des colonnes identity ou serial suivent leur table).
  FOR r IN SELECT format('ALTER SEQUENCE %I.%I OWNER TO logibtp_schema', n.nspname, c.relname) AS q
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind = 'S' AND n.nspname = 'public' AND pg_get_userbyid(c.relowner) <> 'logibtp_schema'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')) LOOP
    EXECUTE r.q;
  END LOOP;
  FOR r IN SELECT format('ALTER FUNCTION %s OWNER TO logibtp_schema', p.oid::regprocedure) AS q
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> 'logibtp_schema'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE r.q;
  END LOOP;
END $$;

ALTER SCHEMA public OWNER TO logibtp_schema;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO logibtp_app, logibtp_lecture;

-- Application : données seulement ; lecture seule : SELECT.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO logibtp_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO logibtp_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO logibtp_app, logibtp_lecture;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO logibtp_lecture;
-- Tables futures (mises à jour) : mêmes droits.
ALTER DEFAULT PRIVILEGES FOR ROLE logibtp_schema IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO logibtp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE logibtp_schema IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO logibtp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE logibtp_schema IN SCHEMA public GRANT SELECT ON TABLES TO logibtp_lecture;

-- Journaux protégés : ni modification ni suppression par l'application (les triggers du coffre de la GED restent actifs).
REVOKE UPDATE, DELETE, TRUNCATE ON coffre_ged FROM logibtp_app;
