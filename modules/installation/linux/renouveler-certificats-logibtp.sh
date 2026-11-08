#!/bin/bash
# Minuterie « logibtp-certificat » : renouvelle le certificat HTTPS (Let's Encrypt ou autorité LogiBTP) puis celui de la base
# (60 jours avant l'échéance) ; la base n'est redémarrée que si son certificat a changé. Même déroulé que
# Renouveler-Certificats-LogiBTP.ps1.

source "$(dirname "$(readlink -f "$0")")/commun.sh"
outils="$(dirname "$(readlink -f "$0")")"

dossier=/opt/logibtp
while (($#)); do
    case "$1" in
        --dossier) dossier="$2"; shift ;;
        *) echec "Option inconnue : $1" ;;
    esac
    shift
done

if [[ "$(lire_reglage "$dossier" LOGIBTP_ROLE)" != base ]]; then
    etape 'Certificat HTTPS'
    if [[ "$(lire_reglage "$dossier" LOGIBTP_CERTIFICAT)" == letsencrypt ]]; then
        "$outils/certificat-letsencrypt.sh" --dossier "$dossier" --renouveler
    else
        installation "$dossier" installation certificat renouveler
    fi
    etape 'Certificat de la base'
    renouveler_certificat_base "$dossier"
fi
