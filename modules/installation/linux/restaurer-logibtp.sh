#!/bin/bash
# Restaure un jeu de sauvegarde de LogiBTP (ANALYSE-MODULE-INSTALLATION.md § 7.1) sur une installation en place :
# bases (recréées puis pg_restore sous logibtp_schema), droits des rôles, stockage de la GED ; avec
# --avec-configuration, aussi le .env, les sociétés et les certificats (reprise sur un nouveau serveur). Même déroulé que
# Restaurer-LogiBTP.ps1.
#
# L'API est arrêtée pendant la restauration, puis redémarrée. Les bases et la GED en place sont REMPLACÉES : la commande
# demande de taper RESTAURER (ou --confirmer). Un jeu chiffré est déchiffré par la clé des données du .env en place : sur
# un nouveau serveur, installer d'abord avec --fichier-env (le .env gardé hors du serveur).
#   restaurer-logibtp.sh --sauvegarde /opt/logibtp/sauvegardes/20261027-013000 [--avec-configuration] [--confirmer]

source "$(dirname "$(readlink -f "$0")")/commun.sh"

dossier=/opt/logibtp; sauvegarde=''; avec_configuration=0; confirmer=0
while (($#)); do
    case "$1" in
        --dossier) dossier="$2"; shift ;;
        --sauvegarde) sauvegarde="$2"; shift ;;
        --avec-configuration) avec_configuration=1 ;;
        --confirmer) confirmer=1 ;;
        *) echec "Option inconnue : $1" ;;
    esac
    shift
done

[[ -n "$sauvegarde" ]] || echec '--sauvegarde obligatoire (dossier d'\''un jeu, ex. /opt/logibtp/sauvegardes/20261027-013000)'
[[ -d "$sauvegarde" ]] || echec "Jeu de sauvegarde introuvable : $sauvegarde"
image="$(lire_reglage "$dossier" LOGIBTP_IMAGE)"
[[ -n "$image" ]] || echec "LOGIBTP_IMAGE absent de $dossier/installation.env : restaurer sur le serveur de l'API"
mapfile -t dumps < <(cd "$sauvegarde" && ls -1 | grep -E '\.dump(\.chiffre)?$' || true)
ged=0; compgen -G "$sauvegarde/ged.tar.gz*" >/dev/null && ged=1
echo "Jeu $sauvegarde : ${#dumps[@]} base(s)$( ((ged)) && echo ', GED')$( ((avec_configuration)) && echo ', configuration')"
if ((!confirmer)); then
    read -rp 'Les bases et la GED en place seront remplacées. Taper RESTAURER pour continuer : ' reponse
    [[ "$reponse" == RESTAURER ]] || { echo 'Abandon.'; exit 0; }
fi

etape "Arrêt de l'API"
compose "$dossier" api stop logibtp-api
jeu="restauration-$(date +%Y%m%d%H%M%S)"
terminer() {
    sur_volume "$image" logibtp-sauvegardes rm -rf "/v/$jeu" || true
    etape "Redémarrage de l'API"
    compose "$dossier" api up -d --wait
}
trap terminer EXIT

etape 'Copie du jeu dans le volume des sauvegardes'
copier_vers_volume "$image" logibtp-sauvegardes "$sauvegarde" "$jeu"
# Restauration d'une base : script SQL de pg_restore rejoué avec search_path = public (pg_restore vide le chemin de
# recherche, et des fonctions appelées sans schéma dans des expressions indexées seraient introuvables).
script="$(mktemp)"
cat >"$script" <<'EOF'
#!/bin/bash
set -euo pipefail
pg_restore --no-owner --role=logibtp_schema -f - "$2" | sed "s/set_config('search_path', '', false)/set_config('search_path', 'public', false)/" | psql -v ON_ERROR_STOP=1 -q -o /dev/null -d "$1"
EOF
copier_vers_volume "$image" logibtp-sauvegardes "$script" "$jeu/restaurer-base.sh"
rm -f "$script"
sur_volume "$image" logibtp-sauvegardes chmod -R a+rwX "/v/$jeu"
if compgen -G "$sauvegarde/*.chiffre" >/dev/null; then
    etape 'Déchiffrement (clé des données du .env en place)'
    installation "$dossier" installation sauvegarde dechiffrer "/app/sauvegardes/$jeu"
    dumps=("${dumps[@]%.chiffre}")
fi
if ((avec_configuration)); then
    etape 'Configuration'
    compose "$dossier" api run --rm -T --entrypoint tar logibtp-installation -xzf "/app/sauvegardes/$jeu/configuration.tar.gz" -C /app
fi
etape 'Bases'
for d in "${dumps[@]}"; do
    b="${d%.dump}"
    [[ "$b" =~ ^[a-z][a-z0-9_]*$ ]] || echec "Nom de base invalide : $b"
    docker exec -u postgres logibtp-base psql -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $b WITH (FORCE)" -c "CREATE DATABASE $b OWNER logibtp_schema ENCODING 'UTF8' TEMPLATE template0"
    docker exec -u postgres logibtp-base bash "/sauvegardes/$jeu/restaurer-base.sh" "$b" "/sauvegardes/$jeu/$d"
    info "base $b restaurée"
done
installation "$dossier" installation base droits
if ((ged)); then
    etape 'Stockage de la GED'
    compose "$dossier" api run --rm -T --entrypoint bash logibtp-installation -c "find /app/stockage-ged -mindepth 1 -delete && tar -xzf /app/sauvegardes/$jeu/ged.tar.gz -C /app/stockage-ged"
fi
info 'Restauration terminée'
