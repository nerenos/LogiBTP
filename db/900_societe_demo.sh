#!/bin/bash
# Base d'une deuxième société (sous-domaine demo : http://demo.localhost:5173) : mêmes scripts que la base principale.
# Pour une autre société : créer la base, rejouer les scripts SQL dans l'ordre, la déclarer dans Societes:Liste.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "CREATE DATABASE logibtp_demo OWNER $POSTGRES_USER"
for f in /docker-entrypoint-initdb.d/*.sql; do
  psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname logibtp_demo -f "$f"
done
