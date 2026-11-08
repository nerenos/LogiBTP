#!/bin/bash
# Base de la démonstration Vercel (documentation/DEPLOIEMENT-VERCEL.md) : applique les scripts du manifeste
# db/installation/scripts.txt, dans l'ordre et démonstration comprise, à une base PostgreSQL neuve et vide (Neon…),
# comme initialiser-developpement.sh le fait pour logibtp_demo. Arrêt à la première erreur.
# Usage, depuis la racine du dépôt :
#   scripts/demo/initialiser-base-demo.sh "postgresql://utilisateur:motdepasse@hote/logibtp_demo?sslmode=require"
# Sous Windows, sans psql installé (Docker Desktop, PowerShell, à la racine du dépôt) :
#   docker run --rm -v "${PWD}:/logibtp:ro" -w /logibtp postgres:17 bash scripts/demo/initialiser-base-demo.sh "postgresql://…"
set -euo pipefail
url=${1:?Adresse de la base attendue (postgresql://…)}
racine=$(cd "$(dirname "$0")/../.." && pwd)
manifeste="$racine/db/installation/scripts.txt"

# Base neuve seulement : un second passage échouerait sur les données de démonstration déjà insérées.
if [[ "$(psql "$url" -tAc "SELECT to_regclass('public.compte') IS NOT NULL")" == "t" ]]; then
  echo "La base contient déjà LogiBTP (table compte) : utiliser une base vide (ou réinitialiser la branche Neon)." >&2
  exit 1
fi

n=0
while read -r chemin indicateurs; do
  [[ -z "$chemin" || "$chemin" == \#* ]] && continue
  psql "$url" -v ON_ERROR_STOP=1 -q -f "$racine/$chemin"
  n=$((n + 1))
done < "$manifeste"
echo "$n scripts appliqués."
