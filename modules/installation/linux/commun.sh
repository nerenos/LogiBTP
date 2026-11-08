#!/bin/bash
# Fonctions communes des scripts d'installation LogiBTP sous Linux (Debian 13), chargées par
# « source "$(dirname "$0")/commun.sh" ». Même déroulé que les scripts Windows (modules/installation/windows) : tout
# passe par la commande docker, les fichiers entrent et sortent des volumes par « docker cp » et un conteneur arrêté
# (ANALYSE-MODULE-INSTALLATION.md § 4, option C : machine Debian avec Docker Engine).

set -euo pipefail

VOLUMES_API=(logibtp-config logibtp-base-config logibtp-certificats logibtp-ged logibtp-journaux logibtp-sauvegardes)
VOLUMES_BASE=(logibtp-base-donnees logibtp-base-config logibtp-sauvegardes)

etape() { printf '\n\033[36m== %s\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
alerte() { printf '\033[33m   ⚠ %s\033[0m\n' "$1"; }
echec() { printf '\033[31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

# Commande docker silencieuse dont seul le résultat compte (vrai / faux).
tester_docker() { docker "$@" >/dev/null 2>&1; }

# Réglages des projets Compose (installation.env du dossier de l'installation : image, ports, rôle) ; aucun secret.
lire_reglage() {
    local fichier="$1/installation.env"
    [[ -f "$fichier" ]] || return 0
    sed -n "s/^[[:space:]]*$2=\(.*\)$/\1/p" "$fichier" | tail -n 1 | sed 's/[[:space:]]*$//'
}

# Remplace (valeur non vide) ou retire (valeur vide) un réglage ; fichier trié, en-tête conservé.
definir_reglage() {
    local fichier="$1/installation.env" cle="$2" valeur="${3:-}" corps
    corps="$( { [[ -f "$fichier" ]] && grep -E '^[A-Z_]+=' "$fichier" | grep -v "^$cle=" || true; [[ -n "$valeur" ]] && printf '%s=%s\n' "$cle" "$valeur"; } | sort)"
    {
        echo '# Réglages des projets Compose de LogiBTP (image, ports) : écrits par installer-logibtp.sh, aucun secret.'
        [[ -n "$corps" ]] && printf '%s\n' "$corps"
    } >"$fichier"
}

# docker compose sur le projet « base » ou « api » de l'installation (surcharge distante de la base si demandée).
compose() {
    local dossier="$1" projet="$2"; shift 2
    local fichiers=(-f "$dossier/$projet/compose.yml")
    if [[ "$projet" == base && "$(lire_reglage "$dossier" LOGIBTP_BASE_DISTANTE)" == 1 ]]; then
        fichiers+=(-f "$dossier/base/compose.distant.yml")
    fi
    docker compose --env-file "$dossier/installation.env" "${fichiers[@]}" "$@"
}

# Commande de l'image de l'API (installation …, comptes …) dans le service d'outils.
installation() {
    local dossier="$1"; shift
    compose "$dossier" api run --rm -T logibtp-installation "$@"
}

# Même commande, sortie lue ; une erreur n'interrompt pas (état à afficher).
lire_installation() {
    local dossier="$1"; shift
    compose "$dossier" api run --rm -T logibtp-installation "$@" 2>/dev/null || true
}

# Même commande, code de sortie rendu : 0 ou 10 acceptés (10 = certificat de la base créé ou renouvelé), autre = échec.
installation_code() {
    local dossier="$1" code=0; shift
    compose "$dossier" api run --rm -T logibtp-installation "$@" || code=$?
    if ((code != 0 && code != 10)); then
        echo "installation $*: échec (code $code)" >&2
        return "$code"
    fi
    return "$code"
}

# Redémarre PostgreSQL pour qu'il relise son certificat. Base sur un autre serveur : message seulement (à redémarrer là-bas).
redemarrer_base() {
    local dossier="$1"
    if [[ "$(lire_reglage "$dossier" LOGIBTP_ROLE)" == api || "$(lire_reglage "$dossier" LOGIBTP_BASE_DISTANTE)" == 1 ]]; then
        alerte "Base sur un autre serveur : y redémarrer le conteneur logibtp-base pour qu'il relise son certificat."
        return 0
    fi
    compose "$dossier" base restart
    compose "$dossier" base up -d --wait
    info 'Base redémarrée (nouveau certificat pris en compte)'
}

# Renouvelle le certificat de la base (60 jours avant l'échéance) et redémarre la base seulement s'il a changé.
renouveler_certificat_base() {
    local dossier="$1" code=0
    installation_code "$dossier" installation certificat base-renouveler || code=$?
    case "$code" in
        10) redemarrer_base "$dossier" ;;
        0) info 'Certificat de la base inchangé : base non redémarrée' ;;
        *) return "$code" ;;
    esac
}

# Conteneur d'outils arrêté qui monte un volume sous /v : sert de passage à « docker cp ».
nouveau_passage() {
    local nom="logibtp-passage-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    docker create --name "$nom" --user root --entrypoint true -v "$2:/v" "$1" >/dev/null
    echo "$nom"
}

# Copie un fichier ou un dossier de l'hôte dans un volume (chemin relatif à la racine du volume) ; propriétaire facultatif (uid:gid).
copier_vers_volume() {
    local image="$1" volume="$2" source="$3" cible="$4" proprietaire="${5:-}" p
    p="$(nouveau_passage "$image" "$volume")"
    docker cp "$source" "$p:/v/$cible" >/dev/null || { docker rm -f "$p" >/dev/null; return 1; }
    docker rm -f "$p" >/dev/null
    if [[ -n "$proprietaire" ]]; then
        docker run --rm --user root --entrypoint chown -v "$volume:/v" "$image" -R "$proprietaire" "/v/$cible"
    fi
}

copier_depuis_volume() {
    local image="$1" volume="$2" source="$3" cible="$4" p
    p="$(nouveau_passage "$image" "$volume")"
    docker cp "$p:/v/$source" "$cible" >/dev/null || { docker rm -f "$p" >/dev/null; return 1; }
    docker rm -f "$p" >/dev/null
}

# Commande dans un conteneur jetable de l'image, sur un volume monté sous /v (compte root : droits des fichiers).
sur_volume() {
    local image="$1" volume="$2" entree="$3"; shift 3
    docker run --rm --user root --entrypoint "$entree" -v "$volume:/v" "$image" "$@"
}

# Jeux de sauvegardes à garder (§ 7.1) : les 7 dernières, la dernière de chacune des 4 dernières semaines (ISO), la
# dernière de chacun des 12 derniers mois. Noms AAAAMMJJ-HHMMSS lus sur l'entrée ; écrit ceux à supprimer.
sauvegardes_a_supprimer() {
    local noms n semaine mois rang=0
    local -A garder=() semaines=() lesmois=()
    mapfile -t noms < <(grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r)
    for n in "${noms[@]}"; do
        rang=$((rang + 1))
        (( rang <= 7 )) && garder[$n]=1
        semaine="$(date -d "${n:0:8}" +%G-%V)"
        if [[ -z "${semaines[$semaine]:-}" ]]; then
            semaines[$semaine]=1
            (( ${#semaines[@]} <= 4 )) && garder[$n]=1
        fi
        mois="${n:0:6}"
        if [[ -z "${lesmois[$mois]:-}" ]]; then
            lesmois[$mois]=1
            (( ${#lesmois[@]} <= 12 )) && garder[$n]=1
        fi
    done
    for n in "${noms[@]}"; do [[ -n "${garder[$n]:-}" ]] || echo "$n"; done
}
