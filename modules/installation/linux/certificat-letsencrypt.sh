#!/bin/bash
# Certificat Let's Encrypt du domaine de l'installation et de son joker par défi DNS (ANALYSE-MODULE-INSTALLATION.md
# § 5.3, option B) : reconnu par tous les postes et tablettes sans rien installer. Même déroulé que
# Certificat-LetsEncrypt.ps1.
#
# Le domaine de l'installation doit être un sous-domaine d'un domaine public dont le DNS est chez un fournisseur doté
# d'une API (OVH, Cloudflare, Infomaniak, Gandi… : code du fournisseur et variables dans la documentation de lego,
# https://go-acme.github.io/lego/dns/). Le client ACME est l'image goacme/lego (version épinglée), ses données dans le
# volume logibtp-letsencrypt ; les identifiants du fournisseur restent dans <dossier>/letsencrypt.env (root seul). Le
# certificat obtenu est importé (origine LETSENCRYPT) et rechargé à chaud par l'API.
#   certificat-letsencrypt.sh --fournisseur ovh --identifiants ovh.env --courriel it@entreprise.fr --accepter-conditions [--essai]
#   certificat-letsencrypt.sh --renouveler   (minuterie hebdomadaire : renouvellement 30 jours avant l'échéance, puis import)
# --accepter-conditions : vous acceptez les conditions d'utilisation de Let's Encrypt (obligatoire la première fois).

source "$(dirname "$(readlink -f "$0")")/commun.sh"

lego=goacme/lego:v4.21.0
dossier=/opt/logibtp; fournisseur=''; identifiants_fournis=''; courriel=''; accepter=0; renouveler=0; essai=0
while (($#)); do
    case "$1" in
        --dossier) dossier="$2"; shift ;;
        --fournisseur) fournisseur="$2"; shift ;;
        --identifiants) identifiants_fournis="$2"; shift ;;
        --courriel) courriel="$2"; shift ;;
        --accepter-conditions) accepter=1 ;;
        --renouveler) renouveler=1 ;;
        --essai) essai=1 ;;
        *) echec "Option inconnue : $1" ;;
    esac
    shift
done

image="$(lire_reglage "$dossier" LOGIBTP_IMAGE)"
domaine="$(lire_reglage "$dossier" LOGIBTP_DOMAINE)"
[[ -n "$domaine" ]] || echec "LOGIBTP_DOMAINE absent de $dossier/installation.env : installer d'abord (installer-logibtp.sh)"
[[ -z "$fournisseur" ]] || definir_reglage "$dossier" LOGIBTP_LETSENCRYPT_FOURNISSEUR "$fournisseur"
[[ -z "$courriel" ]] || definir_reglage "$dossier" LOGIBTP_LETSENCRYPT_COURRIEL "$courriel"
fournisseur="$(lire_reglage "$dossier" LOGIBTP_LETSENCRYPT_FOURNISSEUR)"
courriel="$(lire_reglage "$dossier" LOGIBTP_LETSENCRYPT_COURRIEL)"
[[ -n "$fournisseur" && -n "$courriel" ]] || echec '--fournisseur et --courriel obligatoires la première fois'
identifiants="$dossier/letsencrypt.env"
[[ -z "$identifiants_fournis" ]] || install -m 600 "$identifiants_fournis" "$identifiants"
[[ -f "$identifiants" ]] || echec "--identifiants obligatoire la première fois (variables du fournisseur $fournisseur pour lego)"
if ((!renouveler && !accepter)) && ! tester_docker run --rm --entrypoint test -v logibtp-letsencrypt:/lego "$lego" -d /lego/accounts; then
    echec "--accepter-conditions obligatoire : vous acceptez les conditions d'utilisation de Let's Encrypt"
fi
definir_reglage "$dossier" LOGIBTP_CERTIFICAT letsencrypt
tester_docker volume inspect logibtp-letsencrypt || docker volume create logibtp-letsencrypt >/dev/null

etape "Let's Encrypt : $domaine et *.$domaine ($fournisseur)"
arguments=(run --rm --env-file "$identifiants" -v logibtp-letsencrypt:/lego "$lego" --path /lego --email "$courriel"
    --dns "$fournisseur" --domains "$domaine" --domains "*.$domaine")
((!accepter)) || arguments+=(--accept-tos)
((!essai)) || arguments+=(--server https://acme-staging-v02.api.letsencrypt.org/directory)
if tester_docker run --rm --entrypoint test -v logibtp-letsencrypt:/lego "$lego" -f "/lego/certificates/$domaine.crt"; then
    arguments+=(renew --days 30)
else
    arguments+=(run)
fi
docker "${arguments[@]}"

etape "Import dans l'installation"
docker run --rm --user root --entrypoint sh -v logibtp-letsencrypt:/le:ro -v logibtp-config:/c "$image" -c \
    "cp /le/certificates/$domaine.crt /c/import-le.crt && cp /le/certificates/$domaine.key /c/import-le.key && chown 1654:1654 /c/import-le.crt /c/import-le.key && chmod 600 /c/import-le.key"
trap 'sur_volume "$image" logibtp-config sh -c "rm -f /v/import-le.crt /v/import-le.key"' EXIT
installation "$dossier" installation certificat importer --certificat /app/config/import-le.crt --cle /app/config/import-le.key --origine LETSENCRYPT
info "Certificat en place (rechargé par l'API sans redémarrage)."
