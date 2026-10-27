#!/bin/bash
# Change la clé des données de LogiBTP (LOGIBTP_CLE_CHIFFREMENT : mots de passe des fiches, comptes de messagerie, jetons
# OAuth, clé de l'autorité) et rechiffre toutes les bases (ANALYSE-MODULE-INSTALLATION.md § 10, lot 4). Même déroulé
# que Changer-CleDonnees-LogiBTP.ps1.
#
# Sauvegarde, arrêt de l'API, nouvelle clé (l'ancienne reste dans LOGIBTP_CLE_CHIFFREMENT_PRECEDENTES : elle déchiffre ce
# qui ne serait pas encore rechiffré et les sauvegardes antérieures), rechiffrement, redémarrage, nouvelle sauvegarde.
# Interrompu, il se reprend par « installation cle-donnees rechiffrer ». Les sessions ouvertes sont fermées.
# Après coup : garder hors du serveur la nouvelle sauvegarde (elle contient le nouveau .env).
#   changer-cle-donnees-logibtp.sh [--dossier /opt/logibtp] [--confirmer]

source "$(dirname "$(readlink -f "$0")")/commun.sh"
outils="$(dirname "$(readlink -f "$0")")"

dossier=/opt/logibtp; confirmer=0
while (($#)); do
    case "$1" in
        --dossier) dossier="$2"; shift ;;
        --confirmer) confirmer=1 ;;
        *) echec "Option inconnue : $1" ;;
    esac
    shift
done
if ((!confirmer)); then
    read -rp 'La clé des données va changer et toutes les bases être rechiffrées. Taper CHANGER pour continuer : ' reponse
    [[ "$reponse" == CHANGER ]] || { echo 'Abandon.'; exit 0; }
fi
etape '1. Sauvegarde'
"$outils/sauvegarder-logibtp.sh" --dossier "$dossier" || echec "Sauvegarde en échec : rien n'a changé"
etape "2. Nouvelle clé et rechiffrement (API arrêtée)"
compose "$dossier" api stop logibtp-api
redemarrer() { etape "3. Redémarrage de l'API"; compose "$dossier" api up -d --wait; }
trap redemarrer EXIT
installation "$dossier" installation cle-donnees changer
trap - EXIT
redemarrer
etape '4. Sauvegarde avec la nouvelle clé'
"$outils/sauvegarder-logibtp.sh" --dossier "$dossier"
alerte 'Garder hors du serveur cette dernière sauvegarde (nouveau .env) : sans elle, les données chiffrées sont perdues.'
