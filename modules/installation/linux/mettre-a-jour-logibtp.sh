#!/bin/bash
# Met à jour LogiBTP (ANALYSE-MODULE-INSTALLATION.md § 7.2) : nouvelle image de l'API, sauvegarde complète, scripts SQL
# de la nouvelle version sur toutes les bases (journal installation_script), droits, conversions, redémarrage. Même
# déroulé que MettreAJour-LogiBTP.ps1.
#
# En cas d'échec (scripts ou démarrage de l'API), retour automatique : image précédente remise et jeu de sauvegarde
# pris juste avant restauré (les scripts SQL ne se défont pas autrement). Le conteneur de la base n'est pas touché.
#   mettre-a-jour-logibtp.sh --fichier-image logibtp-api-1.2.0.tar.gz --empreinte 3f5c…   (serveur sans internet)
#   mettre-a-jour-logibtp.sh --image registre.entreprise.fr/logibtp/api:1.2.0

source "$(dirname "$(readlink -f "$0")")/commun.sh"
outils="$(dirname "$(readlink -f "$0")")"

dossier=/opt/logibtp; image=''; fichier_image=''; empreinte=''
while (($#)); do
    case "$1" in
        --dossier) dossier="$2"; shift ;;
        --image) image="$2"; shift ;;
        --fichier-image) fichier_image="$2"; shift ;;
        --empreinte) empreinte="$2"; shift ;;
        *) echec "Option inconnue : $1" ;;
    esac
    shift
done
[[ -n "$image" || -n "$fichier_image" ]] || echec '--image ou --fichier-image obligatoire'
[[ "$(lire_reglage "$dossier" LOGIBTP_ROLE)" != Base ]] || echec "Serveur de la base seule : la mise à jour se lance sur le serveur de l'API"
precedente="$(lire_reglage "$dossier" LOGIBTP_IMAGE)"

etape '1. Nouvelle image'
if [[ -n "$fichier_image" ]]; then
    if [[ -n "$empreinte" ]]; then
        calculee="$(sha256sum "$fichier_image" | cut -d' ' -f1)"
        attendue="${empreinte//:/}"
        [[ "${calculee,,}" == "${attendue,,}" ]] || echec "Empreinte SHA-256 du fichier différente de celle publiée ($calculee) : fichier altéré ou incomplet"
        info 'Empreinte SHA-256 vérifiée'
    fi
    charge="$(docker load -i "$fichier_image")"
    image="$(sed -n 's/^Loaded image: \(.*\)$/\1/p' <<<"$charge" | head -n 1)"
    [[ -n "$image" ]] || echec "Image chargée introuvable : $charge"
elif ! tester_docker image inspect "$image"; then
    docker pull "$image"
fi
[[ "$image" != "$precedente" ]] || alerte "Image identique à l'actuelle ($image) : seuls les scripts et les droits seront rejoués"
info "$precedente → $image"

etape '2. Sauvegarde complète avant mise à jour'
"$outils/sauvegarder-logibtp.sh" --dossier "$dossier" || echec "Sauvegarde en échec : mise à jour abandonnée (rien n'a changé)"
jeu="$dossier/sauvegardes/$(ls -1 "$dossier/sauvegardes" | grep -E '^[0-9]{8}-[0-9]{6}$' | sort | tail -n 1)"

revenir() {
    etape "Retour à la version précédente ($1)"
    definir_reglage "$dossier" LOGIBTP_IMAGE "$precedente"
    definir_reglage "$dossier" LOGIBTP_IMAGE_PRECEDENTE ''
    "$outils/restaurer-logibtp.sh" --dossier "$dossier" --sauvegarde "$jeu" --confirmer
    echec "Mise à jour annulée : $1. Version $precedente et données du $(basename "$jeu") rétablies."
}

etape "3. Arrêt de l'API et scripts de la nouvelle version"
compose "$dossier" api stop logibtp-api
definir_reglage "$dossier" LOGIBTP_IMAGE "$image"
definir_reglage "$dossier" LOGIBTP_IMAGE_PRECEDENTE "$precedente"
# Préparation rejouée (rejouable) : chiffre la connexion d'une base installée avant le certificat de la base ; la base n'est
# redémarrée que si son certificat a été créé ou renouvelé (code 10).
domaine="$(lire_reglage "$dossier" LOGIBTP_DOMAINE)"
[[ -n "$domaine" ]] || revenir 'préparation : domaine absent de installation.env'
code=0
installation_code "$dossier" installation preparer --domaine "$domaine" --code-certificat || code=$?
case "$code" in
    0) ;;
    10) redemarrer_base "$dossier" || revenir 'préparation : redémarrage de la base en échec' ;;
    *) revenir "préparation : échec (code $code)" ;;
esac
installation "$dossier" installation base mettre-a-jour || revenir 'scripts SQL en échec'

etape '4. Démarrage de la nouvelle version'
compose "$dossier" api up -d --wait || revenir "l'API ne démarre pas"
lire_installation "$dossier" installation etat
info "Mise à jour terminée ($image). Sauvegarde d'avant : $jeu"
