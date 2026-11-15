#!/bin/bash
# Repérage empirique des scripts SQL réellement rejouables (plan versionnement-schema, lot 0).
# Construit une base neuve par le manifeste db/installation/scripts.txt (dans l'ordre), puis rejoue DEUX fois chaque
# script non marqué « rejouable » (une base fraîche par script, copiée du modèle) et compare le pg_dump (schéma et
# données, sans le journal ni les valeurs de séquences) avant / après. Un script « sans écart » est un candidat : une
# revue reste nécessaire (ON CONFLICT … DO UPDATE ou UPDATE sur des données que la société peut modifier = à écarter).
# Utilisation : PGHOST=localhost PGPORT=5433 PGUSER=logibtp PGPASSWORD=logibtp scripts/reperer-rejouables.sh [sortie]
# Sortie (défaut : /tmp/rejouables) : sans-ecart.txt, avec-ecart.txt, en-erreur.txt (un chemin par ligne).
set -u
racine=$(cd "$(dirname "$0")/.." && pwd)
sortie=${1:-/tmp/rejouables}
mkdir -p "$sortie"; : > "$sortie/sans-ecart.txt"; : > "$sortie/avec-ecart.txt"; : > "$sortie/en-erreur.txt"
modele=repere_modele; travail=repere_travail
P="psql -X -q -v ON_ERROR_STOP=1"
vider() { $P -d postgres -c "DROP DATABASE IF EXISTS $1" >/dev/null; }
vider $travail; vider $modele
$P -d postgres -c "CREATE DATABASE $modele" || exit 1
while read -r chemin ind; do
  [[ -z "$chemin" || "$chemin" == \#* ]] && continue
  $P -d $modele -f "$racine/$chemin" >/dev/null 2>"$sortie/erreur-construction.txt" || { echo "construction : échec de $chemin"; cat "$sortie/erreur-construction.txt"; exit 1; }
done < "$racine/db/installation/scripts.txt"
instantane() {
  pg_dump -d "$1" --no-owner --no-privileges 2>/dev/null | grep -v -e 'pg_catalog.setval' -e '^-- Dumped' -e '^\\restrict' -e '^\\unrestrict' 
}
grep -v '^#' "$racine/db/installation/scripts.txt" | awk 'NF && $2 != "rejouable" {print $1}' | awk '!vu[$0]++' | while read -r chemin; do
  vider $travail; $P -d postgres -c "CREATE DATABASE $travail TEMPLATE $modele" >/dev/null
  avant=$(instantane $travail | md5sum)
  if $P -d $travail -1 -f "$racine/$chemin" >/dev/null 2>&1 && $P -d $travail -1 -f "$racine/$chemin" >/dev/null 2>&1; then
    apres=$(instantane $travail | md5sum)
    if [ "$avant" == "$apres" ]; then echo "$chemin" >> "$sortie/sans-ecart.txt"; else echo "$chemin" >> "$sortie/avec-ecart.txt"; fi
  else
    echo "$chemin" >> "$sortie/en-erreur.txt"
  fi
done
vider $travail; vider $modele
wc -l "$sortie"/*.txt
