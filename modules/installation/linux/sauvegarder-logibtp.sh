#!/bin/bash
# Sauvegarde de l'installation LogiBTP (ANALYSE-MODULE-INSTALLATION.md § 7.1) : chaque base (pg_dump), le stockage de
# la GED et la configuration (.env, sociétés, certificats et autorité), au même moment, dans le volume des sauvegardes
# puis dans <dossier>/sauvegardes/<AAAAMMJJ-HHMMSS> (et la copie demandée : partage réseau ou NAS monté). Même déroulé
# que Sauvegarder-LogiBTP.ps1.
#
# Lancé chaque nuit par la minuterie systemd logibtp-sauvegarde. Sur un serveur qui n'a que la base (rôle base), seules
# les bases sont sauvegardées ; sur un serveur qui n'a que l'API, la GED et la configuration. Conservation : les 7
# dernières, la dernière de chacune des 4 dernières semaines et de chacun des 12 derniers mois. Le résultat
# (derniere-sauvegarde.json) est affiché par la page /parametres/installation ; un échec y est signalé.
#   sauvegarder-logibtp.sh [--dossier /opt/logibtp] [--copie /mnt/nas/logibtp] [--chiffrer]
# --chiffrer : jeu chiffré par la clé des données (commande « installation sauvegarde chiffrer »).

source "$(dirname "$(readlink -f "$0")")/commun.sh"
set -E

dossier=/opt/logibtp; copie=''; chiffrer=0
while (($#)); do
    case "$1" in
        --dossier) dossier="$2"; shift ;;
        --copie) copie="$2"; shift ;;
        --chiffrer) chiffrer=1 ;;
        *) echec "Option inconnue : $1" ;;
    esac
    shift
done

if [[ "$(lire_reglage "$dossier" LOGIBTP_ROLE)" == Base ]]; then image="$(lire_reglage "$dossier" LOGIBTP_IMAGE_BASE)"; avec_api=0
else image="$(lire_reglage "$dossier" LOGIBTP_IMAGE)"; avec_api=1; fi
[[ -n "$image" ]] || echec "$dossier/installation.env introuvable : installer d'abord (installer-logibtp.sh)"
jeu="$(date +%Y%m%d-%H%M%S)"
bases=()
erreur=''

ecrire_resultat() {
    local liste='' b fichier
    for b in "${bases[@]}"; do liste+="${liste:+,}\"$b\""; done
    fichier="$(mktemp)"
    printf '{"le":"%s","bases":[%s],"tailleMo":%s,"chiffree":%s,"erreur":%s}' \
        "$(date --iso-8601=seconds)" "$liste" "$1" "$( ((chiffrer)) && echo true || echo false)" \
        "$( [[ -n "$erreur" ]] && printf '"%s"' "${erreur//\"/\'}" || echo null)" >"$fichier"
    copier_vers_volume "$image" logibtp-sauvegardes "$fichier" derniere-sauvegarde.json
    sur_volume "$image" logibtp-sauvegardes chmod 644 /v/derniere-sauvegarde.json
    rm -f "$fichier"
}

en_echec() {
    erreur="Sauvegarde en échec à la ligne $1 (code $2)"
    trap - ERR
    ecrire_resultat 0 || true
    echo "✖ $erreur" >&2
    exit 1
}
trap 'en_echec $LINENO $?' ERR

etape "Sauvegarde $jeu"
sur_volume "$image" logibtp-sauvegardes mkdir -m 777 "/v/$jeu"
if docker ps --format '{{.Names}}' | grep -qx logibtp-base; then
    mapfile -t bases < <(docker exec -u postgres logibtp-base psql -At -c "SELECT datname FROM pg_database WHERE datname LIKE 'logibtp%' ORDER BY 1")
    for b in "${bases[@]}"; do
        docker exec -u postgres logibtp-base pg_dump -Fc -d "$b" -f "/sauvegardes/$jeu/$b.dump"
        info "base $b"
    done
fi
if ((avec_api)); then
    compose "$dossier" api run --rm -T --entrypoint tar logibtp-installation -czf "/app/sauvegardes/$jeu/ged.tar.gz" -C /app/stockage-ged .
    info 'stockage de la GED'
    compose "$dossier" api run --rm -T --entrypoint tar logibtp-installation -czf "/app/sauvegardes/$jeu/configuration.tar.gz" -C /app config certificats base-config
    info 'configuration (.env, sociétés, certificats)'
    if ((chiffrer)); then
        installation "$dossier" installation sauvegarde chiffrer "/app/sauvegardes/$jeu"
        info 'jeu chiffré par la clé des données'
    fi
fi
mkdir -p "$dossier/sauvegardes"
cible="$dossier/sauvegardes/$jeu"
copier_depuis_volume "$image" logibtp-sauvegardes "$jeu" "$cible"
chmod -R go-rwx "$cible"
taille="$(du -sm "$cible" | cut -f1)"
if [[ -n "$copie" ]]; then
    mkdir -p "$copie"
    cp -a "$cible" "$copie/$jeu"
    info "copie : $copie/$jeu"
fi
# Conservation 7 / 4 / 12 : volume, dossier de l'installation et copie.
for n in $(docker run --rm --entrypoint ls -v logibtp-sauvegardes:/v "$image" /v | sauvegardes_a_supprimer); do
    sur_volume "$image" logibtp-sauvegardes rm -rf "/v/$n"
done
for d in "$dossier/sauvegardes" "$copie"; do
    [[ -n "$d" && -d "$d" ]] || continue
    for n in $(ls -1 "$d" | sauvegardes_a_supprimer); do rm -rf "${d:?}/$n"; done
done
ecrire_resultat "$taille"
info "Sauvegarde terminée : $cible ($taille Mo)"
