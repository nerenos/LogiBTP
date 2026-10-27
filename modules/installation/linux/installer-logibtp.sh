#!/bin/bash
# Installe LogiBTP sur un serveur Debian 13 (trixie) : un conteneur Docker pour l'API (qui sert le client web) et un
# conteneur indépendant pour PostgreSQL, en HTTPS (ANALYSE-MODULE-INSTALLATION.md § 6 ; procédure :
# documentation/INSTALLATION-DEBIAN.md). Même déroulé que Installer-LogiBTP.ps1.
#
# Chaque étape est rejouable : relancer le script avec les mêmes options reprend là où il s'est arrêté, sans rien
# recréer (bases, secrets, certificat). Rôles :
#   complet : API et base sur ce serveur (cas courant).
#   api     : API ici, base sur une autre machine (--base-distante) : prépare la configuration de la base dans
#             <dossier>/base-distante, à recopier sur le serveur de la base ; relancer ensuite avec --base-demarree.
#   base    : base seule, avec la configuration préparée par le serveur de l'API (--configuration-base).
# Les volumes Docker et le réseau sont externes : « docker compose down -v » ne détruit aucune donnée.
#
# Exemples (en root) :
#   ./installer-logibtp.sh --installer-docker --domaine logibtp.entreprise.fr --confiance 192.168.1.0/24 \
#       --fichier-image logibtp-api-1.0.0.tar.gz --image logibtp/api:1.0.0 --administrateur direction
#   ./installer-logibtp.sh --domaine logibtp.entreprise.fr --certificat importer --fichier-certificat joker.pfx

source "$(dirname "$(readlink -f "$0")")/commun.sh"
racine_paquet="$(dirname "$(dirname "$(readlink -f "$0")")")"

role=complet; domaine=''; dossier=/opt/logibtp; image=logibtp/api:latest; fichier_image=''; image_base=postgres:17
deploiement=LOCAL; confiance=''; memoire=2048; libelle=''; certificat=logibtp; fichier_certificat=''; fichier_cle=''
organisation=''; fournisseur_dns=''; identifiants_dns=''; courriel=''; accepter_le=0; administrateur=''; fichier_env=''
base_distante=''; adresse_api=''; base_demarree=0; configuration_base=''; port_http=80; port_https=443; port_base=5432
reseau=172.30.70.0/24; heure_sauvegarde=01:30; copie_sauvegardes=''; installer_docker=0; sans_taches=0
sans_racine_serveur=0

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; grep -o -- '--[a-z-]*)' "$0" | tr -d ')' | sort -u | tr '\n' ' '; echo; exit "${1:-0}"; }
while (($#)); do
    case "$1" in
        --role) role="$2"; shift ;;
        --domaine) domaine="$2"; shift ;;
        --dossier) dossier="$2"; shift ;;
        --image) image="$2"; shift ;;
        --fichier-image) fichier_image="$2"; shift ;;
        --image-base) image_base="$2"; shift ;;
        --deploiement) deploiement="$2"; shift ;;
        --confiance) confiance="$2"; shift ;;
        --memoire) memoire="$2"; shift ;;
        --libelle) libelle="$2"; shift ;;
        --certificat) certificat="$2"; shift ;;
        --fichier-certificat) fichier_certificat="$2"; shift ;;
        --fichier-cle) fichier_cle="$2"; shift ;;
        --organisation) organisation="$2"; shift ;;
        --fournisseur-dns) fournisseur_dns="$2"; shift ;;
        --identifiants-dns) identifiants_dns="$2"; shift ;;
        --courriel) courriel="$2"; shift ;;
        --accepter-conditions-letsencrypt) accepter_le=1 ;;
        --administrateur) administrateur="$2"; shift ;;
        --fichier-env) fichier_env="$2"; shift ;;
        --base-distante) base_distante="$2"; shift ;;
        --adresse-api) adresse_api="$2"; shift ;;
        --base-demarree) base_demarree=1 ;;
        --configuration-base) configuration_base="$2"; shift ;;
        --port-http) port_http="$2"; shift ;;
        --port-https) port_https="$2"; shift ;;
        --port-base) port_base="$2"; shift ;;
        --reseau) reseau="$2"; shift ;;
        --heure-sauvegarde) heure_sauvegarde="$2"; shift ;;
        --copie-sauvegardes) copie_sauvegardes="$2"; shift ;;
        --installer-docker) installer_docker=1 ;;
        --sans-taches) sans_taches=1 ;;
        --sans-racine-serveur) sans_racine_serveur=1 ;;
        -h|--aide) usage ;;
        *) echo "Option inconnue : $1" >&2; usage 1 ;;
    esac
    shift
done
role="${role,,}"; certificat="${certificat,,}"
outils="$(dirname "$(readlink -f "$0")")"

# ---------------------------------------------------------------- 1. prérequis
etape '1. Prérequis'
[[ $EUID -eq 0 ]] || echec 'Lancer en root (sudo) : volumes, dossier, minuteries systemd, autorité du serveur'
[[ "$role" =~ ^(complet|api|base)$ ]] || echec '--role : complet, api ou base'
[[ "$certificat" =~ ^(logibtp|importer|letsencrypt|aucun)$ ]] || echec '--certificat : logibtp, importer, letsencrypt ou aucun'
[[ "$role" == base || -n "$domaine" ]] || echec '--domaine obligatoire (ex. logibtp.entreprise.fr : sous-domaine du domaine de l'\''entreprise, § 5.1)'
[[ "$role" != api || -n "$base_distante" ]] || echec 'Rôle api : --base-distante obligatoire (nom DNS de la base, ex. base.logibtp.entreprise.fr)'
[[ "$role" == complet || -n "$adresse_api" ]] || echec '--adresse-api obligatoire : adresse IP du serveur de l'\''API vue par la base'
[[ "$role" != base || -n "$configuration_base" ]] || echec 'Rôle base : --configuration-base obligatoire (dossier base-distante préparé par le serveur de l'\''API)'
if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    [[ "${ID:-}" == debian && "${VERSION_ID:-}" == 13 ]] || alerte "Système ${PRETTY_NAME:-inconnu} : procédure écrite pour Debian 13"
fi
if ((installer_docker)) && ! command -v docker >/dev/null; then
    info 'Installation de Docker Engine (dépôt officiel download.docker.com)'
    apt-get update -q
    apt-get install -y -q ca-certificates curl
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME:-trixie}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    apt-get update -q
    apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    # Journaux des conteneurs bornés (sinon ils grossissent sans fin sous /var/lib/docker).
    if [[ ! -f /etc/docker/daemon.json ]]; then
        mkdir -p /etc/docker
        echo '{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }' >/etc/docker/daemon.json
    fi
    systemctl enable --now docker.service containerd.service
    systemctl restart docker.service
fi
command -v docker >/dev/null || echec 'Docker introuvable : relancer avec --installer-docker (ou suivre documentation/INSTALLATION-DEBIAN.md § 2)'
tester_docker info || echec 'Docker ne répond pas : systemctl start docker'
tester_docker compose version || echec 'docker compose (v2) introuvable : apt-get install docker-compose-plugin'
systemctl is-enabled --quiet docker.service 2>/dev/null || alerte 'docker.service non activé au démarrage : systemctl enable docker'
info "Rôle $role ; dossier $dossier"

# Ports publiés libres : sinon Docker refuse de démarrer le conteneur (« port is already allocated » quand un autre
# conteneur le tient, « address already in use » pour un service de l'hôte : Apache, nginx…). Un port déjà tenu par le
# conteneur LogiBTP lui-même (relance de l'installeur) est libre.
verifier_port() {
    local port="$1" conteneur="$2" option="$3" occupant processus
    [[ "$port" =~ ([0-9]+)$ ]] && port="${BASH_REMATCH[1]}"
    [[ -z "$(docker ps -q --filter "name=^${conteneur}$" --filter "publish=$port")" ]] || return 0
    occupant="$(docker ps --format '{{.Names}}' --filter "publish=$port" | paste -sd ' ' -)"
    [[ -z "$occupant" ]] || echec "Port $port déjà publié par le conteneur $occupant : l'arrêter (docker stop $occupant ; docker update --restart=no $occupant) ou relancer avec $option <autre port>"
    if ss -Hltn "sport = :$port" 2>/dev/null | grep -q .; then
        processus="$(ss -Hltnp "sport = :$port" 2>/dev/null | grep -o 'users:(("[^"]*"' | cut -d'"' -f2 | sort -u | paste -sd ' ' -)"
        [[ -n "$processus" ]] || processus="un service de l'hôte"
        echec "Port $port déjà ouvert par $processus :l'arrêter et le désactiver (ex. systemctl disable --now apache2 ou nginx) ou relancer avec $option <autre port>"
    fi
}
if [[ "$role" != base ]]; then
    verifier_port "$port_http" logibtp-api --port-http
    verifier_port "$port_https" logibtp-api --port-https
fi
[[ "$role" == api ]] || verifier_port "$port_base" logibtp-base --port-base

# ---------------------------------------------------------------- 2. dossier et réglages
etape "2. Dossier de l'installation"
mkdir -p "$dossier"/{base,api,outils,sauvegardes}
cp -f "$racine_paquet"/docker/base/* "$dossier/base/"
cp -f "$racine_paquet"/docker/api/* "$dossier/api/"
[[ "$outils" == "$dossier/outils" ]] || cp -f "$outils"/*.sh "$dossier/outils/"
chmod 755 "$dossier"/outils/*.sh
# Root seul : les sauvegardes contiennent les secrets de l'installation (.env, clé de l'autorité).
chown root:root "$dossier"; chmod 700 "$dossier"
definir_reglage "$dossier" LOGIBTP_IMAGE "$image"
definir_reglage "$dossier" LOGIBTP_IMAGE_BASE "$image_base"
definir_reglage "$dossier" LOGIBTP_PORT_HTTP "$port_http"
definir_reglage "$dossier" LOGIBTP_PORT_HTTPS "$port_https"
definir_reglage "$dossier" LOGIBTP_PORT_BASE "$port_base"
definir_reglage "$dossier" LOGIBTP_ROLE "${role^}"
[[ -z "$domaine" ]] || { domaine="${domaine,,}"; definir_reglage "$dossier" LOGIBTP_DOMAINE "$domaine"; }
[[ "$role" == base ]] || definir_reglage "$dossier" LOGIBTP_CERTIFICAT "$certificat"
[[ "$role" != base ]] || definir_reglage "$dossier" LOGIBTP_BASE_DISTANTE 1

# ---------------------------------------------------------------- 3. images, réseau, volumes
etape '3. Images, réseau et volumes'
if [[ "$role" != base ]]; then
    if [[ -n "$fichier_image" ]]; then
        charge="$(docker load -i "$fichier_image")"
        echo "$charge"
        # Image du fichier : prise d'office si --image n'en désigne pas une autre déjà chargée.
        if ! tester_docker image inspect "$image"; then
            image="$(sed -n 's/^Loaded image: \(.*\)$/\1/p' <<<"$charge" | head -n 1)"
            [[ -n "$image" ]] || echec "Image chargée introuvable : $charge"
            definir_reglage "$dossier" LOGIBTP_IMAGE "$image"
        fi
    elif ! tester_docker image inspect "$image"; then docker pull "$image"; fi
fi
tester_docker image inspect "$image_base" || docker pull "$image_base"
tester_docker network inspect logibtp || docker network create --subnet "$reseau" logibtp >/dev/null
case "$role" in
    base) volumes=("${VOLUMES_BASE[@]}") ;;
    api) volumes=("${VOLUMES_API[@]}") ;;
    *) mapfile -t volumes < <(printf '%s\n' "${VOLUMES_API[@]}" "${VOLUMES_BASE[@]}" | sort -u) ;;
esac
for v in "${volumes[@]}"; do
    tester_docker volume inspect "$v" || { docker volume create "$v" >/dev/null; info "volume $v créé"; }
done
# Sauvegardes écrites par PostgreSQL (pg_dump) et par l'API (GED) : dossier partagé.
image_outil="$image"; [[ "$role" != base ]] || image_outil="$image_base"
sur_volume "$image_outil" logibtp-sauvegardes chmod 1777 /v

# Minuterie systemd (service oneshot + timer) : remplace la tâche planifiée Windows.
minuterie() {
    local nom="$1" calendrier="$2" description="$3" commande="$4"
    cat >"/etc/systemd/system/$nom.service" <<EOF
[Unit]
Description=$description
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
ExecStart=$commande
EOF
    cat >"/etc/systemd/system/$nom.timer" <<EOF
[Unit]
Description=$description (minuterie)

[Timer]
OnCalendar=$calendrier
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now "$nom.timer" >/dev/null 2>&1
}
copie=''; [[ -z "$copie_sauvegardes" ]] || copie=" --copie $copie_sauvegardes"

# ---------------------------------------------------------------- rôle base : configuration reçue, base démarrée
if [[ "$role" == base ]]; then
    etape "4. Configuration de la base (préparée par le serveur de l'API)"
    for f in pg_hba.conf postgresql.conf base.crt base.key postgres-mdp; do
        [[ -f "$configuration_base/$f" ]] || echec "$f absent de $configuration_base"
        copier_vers_volume "$image_base" logibtp-base-config "$configuration_base/$f" "$f" 0:0
    done
    sur_volume "$image_base" logibtp-base-config chmod 644 /v/pg_hba.conf /v/postgresql.conf /v/base.crt /v/postgres-mdp
    etape '5. Démarrage de la base'
    compose "$dossier" base up -d --wait
    if ((!sans_taches)); then
        minuterie logibtp-sauvegarde "*-*-* $heure_sauvegarde:00" 'Sauvegarde LogiBTP' "$dossier/outils/sauvegarder-logibtp.sh --dossier $dossier$copie"
        info "Minuterie systemd : sauvegarde des bases chaque jour à $heure_sauvegarde"
    fi
    etape 'Base prête'
    info "Port $port_base : n'ouvrir qu'au serveur de l'API ($adresse_api) dans le pare-feu (documentation/INSTALLATION-DEBIAN.md § 7)."
    info "Relancer l'installeur du serveur de l'API avec --base-demarree."
    exit 0
fi

# ---------------------------------------------------------------- 4. configuration
etape '4. Configuration (.env, sociétés, PostgreSQL)'
if [[ -n "$fichier_env" ]]; then
    info ".env fourni : $fichier_env (conservé tel quel, variables manquantes ajoutées)"
    copier_vers_volume "$image" logibtp-config "$fichier_env" .env 1654:1654
fi
preparer=(installation preparer --domaine "$domaine" --deploiement "$deploiement" --memoire "$memoire" --reseau "$reseau")
[[ -z "$confiance" ]] || preparer+=(--confiance "$confiance")
[[ -z "$libelle" ]] || preparer+=(--libelle "$libelle")
[[ -z "$base_distante" ]] || preparer+=(--base-hote "$base_distante")
installation "$dossier" "${preparer[@]}"

# ---------------------------------------------------------------- 5. certificat
etape '5. Certificat HTTPS'
etat_certificat="$(lire_installation "$dossier" installation certificat etat)"
if [[ "$certificat" == aucun ]]; then
    alerte "Sans certificat, l'application est en HTTP : copier-coller des lignes, empreintes de la GED et borne indisponibles hors du serveur (§ 2)."
elif ! grep -q 'Aucun certificat' <<<"$etat_certificat"; then
    info "Certificat existant conservé : $etat_certificat"
elif [[ "$certificat" == importer ]]; then
    [[ -n "$fichier_certificat" ]] || echec '--fichier-certificat obligatoire avec --certificat importer (.pfx, .p12 ou .pem ; --fichier-cle pour un PEM)'
    nom="import-$(basename "$fichier_certificat")"
    copier_vers_volume "$image" logibtp-config "$fichier_certificat" "$nom" 1654:1654
    importer=(installation certificat importer --certificat "/app/config/$nom")
    if [[ -n "$fichier_cle" ]]; then
        cle="import-$(basename "$fichier_cle")"
        copier_vers_volume "$image" logibtp-config "$fichier_cle" "$cle" 1654:1654
        importer+=(--cle "/app/config/$cle")
    fi
    if [[ "$fichier_certificat" =~ \.(pfx|p12)$ ]]; then
        read -rsp 'Mot de passe du fichier PKCS#12 (vide : aucun) : ' LOGIBTP_CERTIFICAT_MOT_DE_PASSE; echo
        export LOGIBTP_CERTIFICAT_MOT_DE_PASSE
        compose "$dossier" api run --rm -T -e LOGIBTP_CERTIFICAT_MOT_DE_PASSE logibtp-installation "${importer[@]}" || resultat=$?
        unset LOGIBTP_CERTIFICAT_MOT_DE_PASSE
    else
        installation "$dossier" "${importer[@]}" || resultat=$?
    fi
    sur_volume "$image" logibtp-config sh -c 'rm -f /v/import-*'
    [[ -z "${resultat:-}" ]] || echec "Import du certificat en échec (code $resultat)"
elif [[ "$certificat" == letsencrypt ]]; then
    le=("$outils/certificat-letsencrypt.sh" --dossier "$dossier" --fournisseur "$fournisseur_dns" --identifiants "$identifiants_dns" --courriel "$courriel")
    ((!accepter_le)) || le+=(--accepter-conditions)
    "${le[@]}"
else
    creer=(installation certificat creer)
    [[ -z "$organisation" ]] || creer+=(--organisation "$organisation")
    installation "$dossier" "${creer[@]}"
fi

# ---------------------------------------------------------------- 6. base
etape '6. Base de données'
if [[ "$role" == api ]]; then
    installation "$dossier" installation certificat base --nom "$base_distante" --adresses-api "$adresse_api"
    if ((!base_demarree)); then
        export_base="$dossier/base-distante"
        rm -rf "$export_base"
        copier_depuis_volume "$image" logibtp-base-config . "$export_base"
        chmod 700 "$export_base"
        etape 'Étape suivante : serveur de la base'
        info "Recopier le dossier $export_base et le paquet d'installation sur le serveur de la base (scp), puis y lancer :"
        info "  ./installer-logibtp.sh --role base --configuration-base <dossier base-distante> --adresse-api $adresse_api"
        info "Déclarer $base_distante dans le DNS, puis relancer ici le même installeur avec --base-demarree."
        alerte "Le dossier $export_base contient le mot de passe de première initialisation de PostgreSQL : le supprimer après la copie."
        exit 0
    fi
else
    compose "$dossier" base up -d --wait
fi
installation "$dossier" installation base creer
[[ "$role" != api ]] || rm -rf "$dossier/base-distante"

# ---------------------------------------------------------------- 7. API
etape "7. Démarrage de l'API"
compose "$dossier" api up -d --wait

# ---------------------------------------------------------------- 8. premier administrateur
if [[ -n "$administrateur" ]]; then
    etape '8. Premier administrateur'
    if lire_installation "$dossier" comptes liste | grep -Eq "^[[:space:]]*${administrateur}([^[:alnum:]_]|$)"; then
        info "Compte $administrateur existant : inchangé"
    else
        info 'Mot de passe provisoire affiché une seule fois ci-dessous (à changer à la première connexion) :'
        installation "$dossier" comptes creer-admin "$administrateur"
    fi
fi

# ---------------------------------------------------------------- 9. Debian : autorité, minuteries
etape '9. Debian'
racine="$dossier/logibtp-racine.crt"
rm -f "$racine"
if copier_depuis_volume "$image" logibtp-certificats racine.crt "$racine" 2>/dev/null; then
    if ((!sans_racine_serveur)); then
        install -m 644 "$racine" /usr/local/share/ca-certificates/logibtp-racine.crt
        update-ca-certificates >/dev/null
        info 'Autorité LogiBTP installée dans les autorités de confiance de ce serveur (curl, outils du système)'
    fi
else
    racine=''
fi
if ((!sans_taches)); then
    minuterie logibtp-sauvegarde "*-*-* $heure_sauvegarde:00" 'Sauvegarde LogiBTP' "$dossier/outils/sauvegarder-logibtp.sh --dossier $dossier$copie"
    if [[ "$certificat" == letsencrypt ]]; then
        renouveler="$dossier/outils/certificat-letsencrypt.sh --dossier $dossier --renouveler"
    else
        renouveler="/usr/bin/docker compose --env-file $dossier/installation.env -f $dossier/api/compose.yml run --rm -T logibtp-installation installation certificat renouveler"
    fi
    minuterie logibtp-certificat 'Sun *-*-* 03:00:00' 'Renouvellement du certificat LogiBTP' "$renouveler"
    info "Minuteries systemd : sauvegarde chaque jour à $heure_sauvegarde, renouvellement du certificat chaque dimanche (60 jours avant l'échéance)"
    info 'Contrôle : systemctl list-timers "logibtp-*"'
fi

# ---------------------------------------------------------------- 10. rapport
etape '10. Rapport'
ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
zone="${domaine#*.}"; nom="${domaine%%.*}"
etat="$(lire_installation "$dossier" installation certificat etat)"
societes="$(lire_installation "$dossier" installation societes)"
port=''; [[ "$port_https" == 443 ]] || port=":$port_https"
porth=''; [[ "$port_http" == 80 ]] || porth=":$port_http"
{
    echo "Installation LogiBTP du $(date '+%d/%m/%Y %H:%M') (rôle $role, Debian, Docker $(docker version --format '{{.Server.Version}}'))"
    echo
    echo 'Adresses'
    echo "  https://$domaine$port/            (base principale)"
    echo "  https://<société>.$domaine$port/  (une société par sous-domaine)"
    echo "  http://$domaine$porth/certificat  (autorité à installer sur les postes, script, profil iPad)"
    echo
    echo 'Sociétés'
    echo "$societes"
    echo
    echo 'Certificat'
    echo "$etat"
    echo
    echo "DNS (adresse du serveur : ${ip:-?})"
    echo "  Active Directory (PowerShell sur le contrôleur de domaine) :"
    echo "    Add-DnsServerResourceRecordA -ZoneName '$zone' -Name '$nom' -IPv4Address '${ip:-?}'"
    echo "    Add-DnsServerResourceRecordA -ZoneName '$zone' -Name '*.$nom' -IPv4Address '${ip:-?}'"
    echo '  Sans Active Directory : DNS de la box (joker si possible) ou fichier hosts des postes (une ligne par société).'
    echo
    echo 'Postes'
    echo "  Stratégie de groupe : importer $dossier/logibtp-racine.crt dans les autorités racines de confiance de l'ordinateur ;"
    echo "  sinon http://$domaine$porth/certificat sur chaque poste, le TSE et les tablettes."
    echo
    echo 'Sauvegardes'
    echo "  Chaque jour à $heure_sauvegarde dans $dossier/sauvegardes${copie_sauvegardes:+ et $copie_sauvegardes} (minuterie logibtp-sauvegarde)."
    echo "  Restauration : $dossier/outils/restaurer-logibtp.sh --sauvegarde <dossier>."
    echo
    echo 'À GARDER HORS DU SERVEUR'
    echo '  Une sauvegarde complète (elle contient le .env et la clé de l'\''autorité) : leur perte rend illisibles les données'
    echo '  chiffrées (mots de passe des fiches, comptes de messagerie, jetons) et impose de redéployer une nouvelle autorité.'
} | tee "$dossier/INSTALLATION.txt"
chmod 600 "$dossier/INSTALLATION.txt"
info "Rapport enregistré : $dossier/INSTALLATION.txt"
