-- Rôles PostgreSQL d'une installation LogiBTP (ANALYSE-MODULE-DROITS.md § 3.5, D18) ; rejouable, à lancer par
-- l'installeur avec un superutilisateur, sur chaque base de société, après les scripts de schéma :
--   psql -v base=logibtp -v mdp_schema='…' -v mdp_app='…' -v mdp_lecture='…' -f db/installation/roles.sql -d logibtp
--
--   logibtp_schema  : propriétaire des tables (scripts SQL, mises à jour, conversions) ; jamais utilisé par l'API en marche.
--   logibtp_app     : compte de l'API (.env : ConnectionStrings__LogiBTP) ; lecture et écriture des données seulement,
--                     non propriétaire : il ne peut ni modifier le schéma ni désactiver un trigger (coffre de la GED).
--   logibtp_lecture : lecture seule (requêtes saisies, listes de valeurs par SELECT, outils de consultation).
-- Connexion limitée à l'adresse du serveur de l'application : pg_hba.conf (installeur), par exemple
--   hostssl  logibtp,logibtp_demo  logibtp_app  10.0.0.5/32  scram-sha-256

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE logibtp_schema LOGIN PASSWORD %L', :'mdp_schema') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logibtp_schema') \gexec
SELECT format('CREATE ROLE logibtp_app LOGIN PASSWORD %L', :'mdp_app') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logibtp_app') \gexec
SELECT format('CREATE ROLE logibtp_lecture LOGIN PASSWORD %L', :'mdp_lecture') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logibtp_lecture') \gexec
ALTER ROLE logibtp_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE logibtp_lecture NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Le schéma appartient à logibtp_schema (tables, vues, séquences, fonctions).
SELECT format('ALTER DATABASE %I OWNER TO logibtp_schema', :'base') \gexec
REVOKE ALL ON DATABASE :"base" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"base" TO logibtp_app, logibtp_lecture;
ALTER SCHEMA public OWNER TO logibtp_schema;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO logibtp_app, logibtp_lecture;

SELECT format('ALTER TABLE %I.%I OWNER TO logibtp_schema', schemaname, tablename) FROM pg_tables WHERE schemaname = 'public' \gexec
SELECT format('ALTER VIEW %I.%I OWNER TO logibtp_schema', schemaname, viewname) FROM pg_views WHERE schemaname = 'public' \gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO logibtp_schema', sequence_schema, sequence_name) FROM information_schema.sequences
WHERE sequence_schema = 'public'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_class c ON c.oid = d.objid WHERE c.relname = sequence_name AND d.deptype IN ('a', 'i')) \gexec
SELECT format('ALTER FUNCTION %s OWNER TO logibtp_schema', p.oid::regprocedure) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') \gexec

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
