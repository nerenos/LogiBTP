#!/usr/bin/env bash
# Monte les bases sources de test de la reprise (fictives) dans deux conteneurs Docker :
#   MDE   : SQL Server 2022, port 14330, base MDE_DOS_DEV, utilisateur sa / mot de passe $REPRISE_MSSQL_MDP
#   OPTIM : MariaDB 11.2,    port 33060, base optimbtp,    utilisateur root / mot de passe $REPRISE_MARIADB_MDP
# Usage : tests/reprise/monter.sh [mde|optim]   (les deux par défaut). Les conteneurs existants sont recréés.
# Chaînes de connexion des tests (variables LOGIBTP_TEST_MSSQL et LOGIBTP_TEST_MARIADB) affichées à la fin.
# Jamais utilisé sur une base de l'utilisateur : ces conteneurs ne contiennent que les jeux de test.
set -euo pipefail
cd "$(dirname "$0")"
MSSQL_MDP="${REPRISE_MSSQL_MDP:-Reprise#2026}"
MARIADB_MDP="${REPRISE_MARIADB_MDP:-reprise}"
CIBLE="${1:-tout}"

attendre() { # commande, libellé
  for _ in $(seq 1 60); do if eval "$1" >/dev/null 2>&1; then return 0; fi; sleep 2; done
  echo "$2 : délai dépassé" >&2; exit 1
}

if [[ "$CIBLE" == tout || "$CIBLE" == mde ]]; then
  docker rm -f reprise-mde >/dev/null 2>&1 || true
  docker run -d --name reprise-mde -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=$MSSQL_MDP" -p 14330:1433 \
    mcr.microsoft.com/mssql/server:2022-latest >/dev/null
  SQLCMD="/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P $MSSQL_MDP -C -b -f 65001"
  attendre "docker exec reprise-mde $SQLCMD -Q 'SELECT 1'" "SQL Server"
  docker exec reprise-mde $SQLCMD -Q "CREATE DATABASE MDE_DOS_DEV COLLATE French_CI_AS"
  docker cp mde/schema.sql reprise-mde:/tmp/schema.sql
  docker cp mde/donnees.sql reprise-mde:/tmp/donnees.sql
  docker exec reprise-mde $SQLCMD -d MDE_DOS_DEV -i /tmp/schema.sql >/dev/null
  docker exec reprise-mde $SQLCMD -d MDE_DOS_DEV -i /tmp/donnees.sql
  echo "LOGIBTP_TEST_MSSQL='Server=localhost,14330;Database=MDE_DOS_DEV;User Id=sa;Password=$MSSQL_MDP;TrustServerCertificate=True'"
fi

if [[ "$CIBLE" == tout || "$CIBLE" == optim ]]; then
  docker rm -f reprise-optim >/dev/null 2>&1 || true
  docker run -d --name reprise-optim -e "MARIADB_ROOT_PASSWORD=$MARIADB_MDP" -e MARIADB_DATABASE=optimbtp \
    -p 33060:3306 mariadb:11.2 >/dev/null
  attendre "docker exec reprise-optim mariadb -uroot -p$MARIADB_MDP optimbtp -e 'SELECT 1'" "MariaDB"
  docker exec -i reprise-optim mariadb -uroot "-p$MARIADB_MDP" --default-character-set=utf8mb4 optimbtp < optim/schema.sql
  docker exec -i reprise-optim mariadb -uroot "-p$MARIADB_MDP" --default-character-set=utf8mb4 optimbtp < optim/donnees.sql
  echo "LOGIBTP_TEST_MARIADB='Server=localhost;Port=33060;Database=optimbtp;User Id=root;Password=$MARIADB_MDP'"
fi
