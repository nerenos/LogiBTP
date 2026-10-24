#!/bin/bash
# Base de développement (docker-compose.yml) : applique les scripts du manifeste db/installation/scripts.txt, dans
# l'ordre et démonstration comprise, à la base principale (logibtp) puis à la base de la société « demo »
# (sous-domaine demo : http://demo.localhost:5173). Exécuté une fois, à la création du volume.
# Dépôt monté en lecture seule sous /logibtp ; arrêt à la première erreur.
set -e
manifeste=/logibtp/db/installation/scripts.txt

appliquer() {
  local base=$1
  while read -r chemin indicateurs; do
    [[ -z "$chemin" || "$chemin" == \#* ]] && continue
    psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname "$base" -f "/logibtp/$chemin"
  done < "$manifeste"
}

appliquer "$POSTGRES_DB"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "CREATE DATABASE logibtp_demo OWNER $POSTGRES_USER"
appliquer logibtp_demo
