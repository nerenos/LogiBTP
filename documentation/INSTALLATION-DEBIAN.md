# Installation de LogiBTP sur un serveur Debian 13 (Docker)

Procédure d'installation et d'exploitation de LogiBTP sur un serveur **Debian 13 (trixie)** avec Docker Engine. C'est
l'option C de l'[analyse du module Installation](conception/ANALYSE-MODULE-INSTALLATION.md) (§ 4) : la plus robuste,
qu'il s'agisse d'une machine physique, d'une machine virtuelle Hyper-V / VMware / Proxmox ou d'un serveur hébergé.

L'application tourne dans deux conteneurs indépendants :

| Conteneur | Image | Rôle | Ports publiés |
|---|---|---|---|
| `logibtp-api` | `logibtp/api:<version>` (construite depuis le dépôt) | API ASP.NET Core, client web, HTTPS | 80 (redirection, page `/certificat`), 443 |
| `logibtp-base` | `postgres:17` officielle | Une base par société, TLS obligatoire | 5432 |

Les scripts Linux (`modules/installation/linux/`) suivent exactement le déroulé des scripts Windows
(`modules/installation/windows/`) ; toute la logique (bases, secrets, certificats, scripts SQL) est dans l'image, par les
commandes `installation …`.

---

## 1. Prérequis

### 1.1 Serveur

| Ressource | Minimum | Conseillé (20 à 50 utilisateurs) |
|---|---|---|
| Processeur | 2 vCPU x86-64 | 4 vCPU |
| Mémoire | 4 Go | 8 Go (PostgreSQL en reçoit 2 Go par défaut, option `--memoire`) |
| Disque | 40 Go | 100 Go et plus selon la GED, idéalement un disque séparé pour `/var/lib/docker` |
| Système | Debian 13 « trixie » amd64, installation minimale + serveur SSH | |
| Réseau | Adresse IP **fixe** sur le réseau local | |

### 1.2 Informations à réunir

- **Nom de l'installation** : un sous-domaine du domaine de l'entreprise, par exemple `logibtp.entreprise.fr` (§ 5.1 de
  l'analyse). Chaque société est servie sur `https://<code>.logibtp.entreprise.fr`.
- **Réseau de confiance** (option `--confiance`) : réseau local des postes, par exemple `192.168.1.0/24`.
- **Origine du certificat HTTPS** :
  - `logibtp` (défaut) : autorité LogiBTP créée sur le serveur, à installer sur les postes (stratégie de groupe ou page
    `/certificat`) ;
  - `letsencrypt` : certificat public reconnu partout, si le DNS du domaine est chez un fournisseur doté d'une API (OVH,
    Cloudflare, Gandi, Infomaniak…) ;
  - `importer` : certificat fourni (PKCS#12 ou PEM couvrant le domaine **et** le joker `*.domaine`).
- **Pseudo du premier administrateur** (option `--administrateur`).
- **Emplacement de la copie des sauvegardes** (NAS, partage réseau monté) : fortement conseillé.

### 1.3 Ce qu'il faut sur le poste qui prépare l'installation

Le dépôt LogiBTP, Docker (Docker Desktop ou Engine) et le fichier `cle-construction.secret` (clé de construction des
binaires, jamais versionnée, D25).

---

## 2. Préparer Debian 13

En `root` (ou `sudo -i`) sur le serveur :

```bash
apt-get update && apt-get full-upgrade -y
apt-get install -y ca-certificates curl unattended-upgrades
timedatectl set-timezone Europe/Paris
timedatectl set-ntp true
dpkg-reconfigure -plow unattended-upgrades
```

Adresse IP fixe : dans `/etc/network/interfaces` (installation minimale) ou par NetworkManager, puis vérifier avec
`ip -4 addr`.

### 2.1 Docker Engine

L'installeur sait le faire (option `--installer-docker`). À la main, depuis le dépôt officiel de Docker (pas le
paquet `docker.io` de Debian, plus ancien) :

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Bornes des journaux des conteneurs (sinon ils grossissent sans fin), puis démarrage au boot :

```bash
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }' > /etc/docker/daemon.json
systemctl enable --now docker containerd
systemctl restart docker
docker version && docker compose version
```

---

## 3. Préparer le paquet d'installation (poste de développement)

Depuis la racine du dépôt, à la version à livrer (ici `1.0.0`) :

```bash
docker build --secret id=cle_construction,src=cle-construction.secret -t logibtp/api:1.0.0 .
docker save logibtp/api:1.0.0 | gzip > logibtp-api-1.0.0.tar.gz
sha256sum logibtp-api-1.0.0.tar.gz > logibtp-api-1.0.0.tar.gz.sha256
tar czf logibtp-installation.tar.gz -C modules/installation docker linux
```

Le paquet `logibtp-installation.tar.gz` contient les projets Compose (`docker/api`, `docker/base`) et les scripts
(`linux/`). Les copier sur le serveur avec l'image :

```bash
scp logibtp-api-1.0.0.tar.gz logibtp-api-1.0.0.tar.gz.sha256 logibtp-installation.tar.gz admin@serveur:/tmp/
```

Avec un registre d'images privé, `docker push` puis l'option `--image registre/logibtp/api:1.0.0` remplacent le fichier.

---

## 4. Installer

Sur le serveur, en `root` :

```bash
mkdir -p /root/logibtp-paquet && tar xzf /tmp/logibtp-installation.tar.gz -C /root/logibtp-paquet
cd /tmp && sha256sum -c logibtp-api-1.0.0.tar.gz.sha256
cd /root/logibtp-paquet/linux && chmod +x *.sh
```

Installation courante (API et base sur ce serveur, autorité LogiBTP) :

```bash
./installer-logibtp.sh --installer-docker --domaine logibtp.entreprise.fr --confiance 192.168.1.0/24 --fichier-image /tmp/logibtp-api-1.0.0.tar.gz --image logibtp/api:1.0.0 --administrateur direction --copie-sauvegardes /mnt/nas/logibtp
```

Le script est **rejouable** : en cas d'erreur, corriger la cause et relancer la même commande. Il enchaîne :

1. prérequis (root, Debian 13, Docker et Compose v2, Docker activé au démarrage) ;
2. dossier `/opt/logibtp` (root seul, `chmod 700`) : projets Compose, scripts dans `outils/`, `installation.env`
   (image, ports, rôle : aucun secret) ;
3. chargement des images, réseau `logibtp` et volumes **externes** (`docker compose down -v` ne détruit rien) ;
4. `installation preparer` : `.env` aux secrets générés et chiffrés (volume `logibtp-config`), sociétés, configuration
   PostgreSQL (`pg_hba.conf` en `hostssl` + SCRAM, certificat TLS de la base) ;
5. certificat HTTPS (selon `--certificat`) ;
6. démarrage de la base et `installation base creer` (rôles, base principale, scripts du manifeste) ;
7. démarrage de l'API (attente de son état « healthy ») ;
8. premier administrateur : **mot de passe provisoire affiché une seule fois**, à changer à la première connexion ;
9. autorité LogiBTP ajoutée aux autorités de confiance du serveur (`update-ca-certificates`), minuteries systemd
   `logibtp-sauvegarde` (chaque jour à 01:30) et `logibtp-certificat` (chaque dimanche à 03:00) ;
10. rapport `/opt/logibtp/INSTALLATION.txt` : adresses, sociétés, certificat, commandes DNS, consignes des postes.

### 4.1 Options

| Option | Défaut | Rôle |
|---|---|---|
| `--domaine D` | — (obligatoire) | Nom de l'installation |
| `--confiance CIDR[,CIDR]` | — | Adresses de confiance (`LOGIBTP_ADRESSES_CONFIANCE` : pas de double facteur depuis ces réseaux) |
| `--administrateur pseudo` | — | Premier compte administrateur |
| `--fichier-image F` / `--image I` | `logibtp/api:latest` | Image de l'API (fichier `docker save`, gzip accepté, ou image d'un registre) |
| `--certificat logibtp\|importer\|letsencrypt\|aucun` | `logibtp` | Origine du certificat HTTPS |
| `--organisation O` | — | Nom de l'organisation dans l'autorité LogiBTP |
| `--fichier-certificat F` `--fichier-cle K` | — | Certificat importé (mot de passe PKCS#12 demandé) |
| `--fournisseur-dns P` `--identifiants-dns F` `--courriel C` `--accepter-conditions-letsencrypt` | — | Let's Encrypt (§ 6.2) |
| `--fichier-env F` | — | `.env` d'une installation précédente (reprise : clés conservées) |
| `--deploiement LOCAL\|INTERNET` | `LOCAL` | Exposition de l'installation |
| `--memoire Mo` | `2048` | Mémoire donnée à PostgreSQL |
| `--libelle L` | — | Libellé de la société principale |
| `--port-http` / `--port-https` / `--port-base` | 80 / 443 / 5432 | Ports publiés |
| `--reseau CIDR` | `172.30.70.0/24` | Réseau Docker `logibtp` (à changer s'il chevauche le réseau local) |
| `--heure-sauvegarde HH:MM` | `01:30` | Heure de la sauvegarde quotidienne |
| `--copie-sauvegardes /chemin` | — | Copie de chaque jeu (NAS monté, § 8.1) |
| `--dossier /chemin` | `/opt/logibtp` | Dossier de l'installation |
| `--installer-docker` | — | Installe Docker Engine depuis le dépôt officiel s'il manque |
| `--sans-taches` / `--sans-racine-serveur` | — | Ni minuteries systemd / ni autorité dans les certificats du serveur |
| `--role complet\|api\|base` | `complet` | Base sur une autre machine (§ 10) |

---

## 5. Vérifier

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -s https://logibtp.entreprise.fr/api/sante
cd /opt/logibtp && docker compose --env-file installation.env -f api/compose.yml run --rm -T logibtp-installation installation etat
systemctl list-timers 'logibtp-*'
```

Les deux conteneurs doivent être `healthy`. Depuis un poste (après le DNS, § 7), ouvrir `https://logibtp.entreprise.fr`,
se connecter avec le compte administrateur, puis **Paramètres › Installation** (`/parametres/installation`) : version,
bases et scripts appliqués, chiffrement de la base, certificat, dernière sauvegarde, espace disque.

Journaux : `docker logs -f logibtp-api`, `docker logs -f logibtp-base` ; journal technique de l'API dans le volume
`logibtp-journaux`.

---

## 6. Certificat HTTPS

### 6.1 Autorité LogiBTP (défaut)

Le serveur porte une autorité racine à **contrainte de noms** (elle ne peut signer que le domaine de l'installation) et
un certificat serveur couvrant le domaine et son joker, renouvelé seul 60 jours avant l'échéance (minuterie
`logibtp-certificat`). La racine est à installer sur les postes :

- **Active Directory** : stratégie de groupe › Configuration ordinateur › Paramètres Windows › Paramètres de sécurité ›
  Stratégies de clé publique › Autorités de certification racines de confiance › importer
  `/opt/logibtp/logibtp-racine.crt` (le récupérer par `scp`) ;
- **sans AD** : `http://logibtp.entreprise.fr/certificat` sur chaque poste, le TSE et les tablettes (certificat, script
  PowerShell, profil iPad).

### 6.2 Let's Encrypt (défi DNS)

Fichier d'identifiants du fournisseur au format de [lego](https://go-acme.github.io/lego/dns/), par exemple pour OVH :

```bash
cat > /root/ovh.env <<'EOF'
OVH_ENDPOINT=ovh-eu
OVH_APPLICATION_KEY=...
OVH_APPLICATION_SECRET=...
OVH_CONSUMER_KEY=...
EOF
chmod 600 /root/ovh.env
./installer-logibtp.sh --domaine logibtp.entreprise.fr --certificat letsencrypt --fournisseur-dns ovh --identifiants-dns /root/ovh.env --courriel it@entreprise.fr --accepter-conditions-letsencrypt
```

`--accepter-conditions-letsencrypt` vaut acceptation des conditions d'utilisation de Let's Encrypt. Essai préalable sur
l'environnement de test : `/opt/logibtp/outils/certificat-letsencrypt.sh --essai …`. Le renouvellement (30 jours avant
l'échéance) passe par la minuterie hebdomadaire `logibtp-certificat`.

### 6.3 Certificat fourni

```bash
./installer-logibtp.sh --domaine logibtp.entreprise.fr --certificat importer --fichier-certificat /root/joker.pfx
```

Le mot de passe du PKCS#12 est demandé au clavier ; pour un PEM, ajouter `--fichier-cle /root/joker.key`. Le
renouvellement est alors à votre charge : `installation certificat importer` (§ 9).

---

## 7. DNS et réseau

Le domaine et son joker pointent vers l'adresse du serveur (commandes exactes dans `INSTALLATION.txt`) :

- **DNS de l'Active Directory** (PowerShell sur le contrôleur de domaine) :
  `Add-DnsServerResourceRecordA -ZoneName 'entreprise.fr' -Name 'logibtp' -IPv4Address '192.168.1.20'` et la même pour
  `-Name '*.logibtp'` ;
- **sans AD** : DNS de la box (joker si possible), sinon fichier `hosts` des postes, une ligne par société.

### 7.1 Pare-feu

Docker publie ses ports par ses propres règles, **avant** celles d'`ufw` ou de `firewalld` : un pare-feu de l'hôte ne
filtre pas les ports 80, 443 et 5432 des conteneurs. Pour limiter l'accès au réseau local, filtrer dans la chaîne
`DOCKER-USER` (prévue par Docker pour cela), rechargée après chaque démarrage de Docker :

```bash
cat > /usr/local/sbin/logibtp-pare-feu.sh <<'EOF'
#!/bin/sh
# Ports des conteneurs LogiBTP ouverts au seul réseau local (adapter le réseau et l'interface).
iptables -F DOCKER-USER
iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A DOCKER-USER -i eth0 ! -s 192.168.1.0/24 -j DROP
iptables -A DOCKER-USER -j RETURN
EOF
chmod 755 /usr/local/sbin/logibtp-pare-feu.sh
cat > /etc/systemd/system/logibtp-pare-feu.service <<'EOF'
[Unit]
Description=Pare-feu des conteneurs LogiBTP (chaîne DOCKER-USER)
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/logibtp-pare-feu.sh

[Install]
WantedBy=docker.service
EOF
systemctl daemon-reload && systemctl enable --now logibtp-pare-feu.service
```

SSH (port 22) reste à protéger par le pare-feu de l'hôte ou du réseau. Le port 5432 n'a pas besoin d'être joignable
depuis les postes : sur un serveur complet, `--port-base 127.0.0.1:5432` le limite au serveur lui-même. Dans tous les
cas, PostgreSQL n'accepte que des connexions TLS authentifiées par SCRAM.

---

## 8. Exploitation

Toutes les commandes en `root`, depuis `/opt/logibtp/outils`.

### 8.1 Sauvegardes

Chaque nuit, la minuterie `logibtp-sauvegarde` lance `sauvegarder-logibtp.sh` : `pg_dump` de chaque base, archive de la
GED, archive de la configuration (`.env`, sociétés, certificats, clé de l'autorité), dans
`/opt/logibtp/sauvegardes/<AAAAMMJJ-HHMMSS>` et la copie demandée. Conservation : les 7 derniers jeux, le dernier de
chacune des 4 dernières semaines et de chacun des 12 derniers mois. Le résultat s'affiche dans `/parametres/installation`.

```bash
./sauvegarder-logibtp.sh                 # sauvegarde immédiate
./sauvegarder-logibtp.sh --chiffrer      # jeu chiffré par la clé des données (copie hors site)
journalctl -u logibtp-sauvegarde         # résultats des sauvegardes nocturnes
```

Copie sur un NAS : monter le partage de façon permanente, par exemple en CIFS (`apt-get install cifs-utils`) :

```bash
# /etc/fstab
//nas/sauvegardes/logibtp  /mnt/nas/logibtp  cifs  credentials=/root/.nas,uid=0,gid=0,file_mode=0600,dir_mode=0700,_netdev,nofail  0  0
```

> **À garder hors du serveur** : au moins un jeu complet récent. Il contient le `.env` (clés de chiffrement) et la clé
> de l'autorité : leur perte rend illisibles les données chiffrées (mots de passe des fiches, comptes de messagerie,
> jetons) et impose de redéployer une nouvelle autorité sur tous les postes.

### 8.2 Restauration

```bash
./restaurer-logibtp.sh --sauvegarde /opt/logibtp/sauvegardes/20261027-013000
```

L'API est arrêtée, les bases et la GED en place sont **remplacées** (taper `RESTAURER`), les droits des rôles rétablis,
puis l'API redémarre. Un jeu chiffré est déchiffré par la clé du `.env` en place.

**Reprise sur un nouveau serveur** : installer d'abord avec le `.env` de l'ancien serveur (extrait de
`configuration.tar.gz` du jeu, dossier `config/`), puis restaurer avec la configuration :

```bash
mkdir /tmp/jeu && tar xzf /chemin/jeu/configuration.tar.gz -C /tmp/jeu config/.env
./installer-logibtp.sh --domaine logibtp.entreprise.fr --fichier-image /tmp/logibtp-api-1.0.0.tar.gz --fichier-env /tmp/jeu/config/.env
./restaurer-logibtp.sh --sauvegarde /chemin/jeu --avec-configuration
```

### 8.3 Mise à jour de LogiBTP

```bash
./mettre-a-jour-logibtp.sh --fichier-image /tmp/logibtp-api-1.1.0.tar.gz --empreinte "$(cut -d' ' -f1 /tmp/logibtp-api-1.1.0.tar.gz.sha256)"
```

Vérification de l'empreinte, sauvegarde complète, arrêt de l'API, scripts SQL de la nouvelle version sur toutes les
bases (`installation base mettre-a-jour`), redémarrage. En cas d'échec, **retour automatique** à l'image précédente et à
la sauvegarde prise juste avant. Le conteneur de la base n'est pas touché.

Mise à jour de PostgreSQL dans sa version majeure (17.x) : `docker pull postgres:17`, puis
`docker compose --env-file /opt/logibtp/installation.env -f /opt/logibtp/base/compose.yml up -d`. Un changement de
version majeure passe par une sauvegarde et une restauration dans une base neuve.

Mise à jour de Debian et de Docker : `apt-get update && apt-get full-upgrade` ; les conteneurs redémarrent seuls
(`restart: unless-stopped`).

### 8.4 Ajouter une société

```bash
cd /opt/logibtp
docker compose --env-file installation.env -f api/compose.yml run --rm -T logibtp-installation installation societe ajouter BTP2 --libelle "BTP 2"
docker compose --env-file installation.env -f api/compose.yml restart logibtp-api
```

Puis l'enregistrement DNS `btp2.logibtp.entreprise.fr` si le joker n'est pas déclaré.

### 8.5 Comptes de secours

```bash
cd /opt/logibtp
alias logibtp='docker compose --env-file /opt/logibtp/installation.env -f /opt/logibtp/api/compose.yml run --rm -T logibtp-installation'
logibtp comptes liste [--societe CODE]
logibtp comptes reinitialiser <pseudo> [--societe CODE]
logibtp comptes deverrouiller <pseudo> [--societe CODE]
logibtp comptes creer-admin <pseudo> [--societe CODE]
```

### 8.6 Changer la clé des données

```bash
./changer-cle-donnees-logibtp.sh
```

Sauvegarde, nouvelle clé, rechiffrement de toutes les bases (API arrêtée), nouvelle sauvegarde à garder hors du serveur.

---

## 9. Commandes de l'image

`docker compose --env-file /opt/logibtp/installation.env -f /opt/logibtp/api/compose.yml run --rm -T logibtp-installation installation <commande>` :

| Commande | Effet |
|---|---|
| `etat` | État de l'installation (bases, scripts, certificat) |
| `societes` / `societe ajouter CODE [--libelle L]` | Sociétés |
| `scripts verifier` | Écarts entre le manifeste et les bases |
| `base mettre-a-jour` / `base droits` | Scripts manquants / droits des rôles |
| `certificat etat \| creer \| renouveler [--avant 60] \| importer --certificat F [--cle K]` | Certificat HTTPS |
| `sauvegarde chiffrer \| dechiffrer DOSSIER` | Chiffrement d'un jeu (chemin sous `/app/sauvegardes`) |
| `cle-donnees changer \| rechiffrer` | Clé des données |

---

## 10. Base sur une autre machine

Deux serveurs Debian, l'API sur `srv-api` (192.168.1.20), la base sur `srv-base` (192.168.1.21, nom DNS
`base.logibtp.entreprise.fr`) :

1. sur `srv-api` :
   `./installer-logibtp.sh --role api --domaine logibtp.entreprise.fr --base-distante base.logibtp.entreprise.fr --adresse-api 192.168.1.20 --fichier-image …`
   → configuration de la base préparée dans `/opt/logibtp/base-distante` (certificat TLS, `pg_hba.conf`, mot de passe
   initial) ;
2. copier ce dossier et le paquet sur `srv-base` (`scp -r`), puis y lancer :
   `./installer-logibtp.sh --role base --configuration-base /root/base-distante --adresse-api 192.168.1.20`,
   et supprimer la copie du dossier ;
3. déclarer `base.logibtp.entreprise.fr` dans le DNS, ouvrir 5432 au seul `srv-api` (§ 7.1 avec `-s 192.168.1.20`) ;
4. relancer sur `srv-api` la commande de l'étape 1 avec `--base-demarree`.

L'API vérifie alors le certificat de la base et son nom (`VerifyFull`). Chaque serveur a sa minuterie de sauvegarde :
les bases sur `srv-base`, la GED et la configuration sur `srv-api`. La restauration se lance sur `srv-api` avec le
conteneur de la base local seulement : sur deux machines, restaurer les bases sur `srv-base` par `pg_restore` (voir le
script `restaurer-base.sh` écrit par `restaurer-logibtp.sh`).

---

## 11. Dépannage

| Symptôme | Piste |
|---|---|
| `logibtp-api` redémarre en boucle | `docker logs logibtp-api` ; `.env` incomplet → relancer l'installeur (rejouable) |
| `logibtp-base` « unhealthy » | `docker logs logibtp-base` ; droits de `base.key` ; espace disque (`df -h /var/lib/docker`) |
| Le navigateur refuse le certificat | Autorité non installée sur le poste (§ 6.1), ou nom hors du domaine (adresse IP, autre nom) |
| `/parametres/installation` : scripts en attente | `mettre-a-jour-logibtp.sh` avec l'image en place, ou `installation base mettre-a-jour` |
| Le réseau `logibtp` chevauche le réseau local | Réinstaller avec `--reseau` sur un réseau libre (supprimer d'abord le réseau : conteneurs arrêtés, `docker network rm logibtp`) |
| La sauvegarde nocturne n'a pas tourné | `systemctl list-timers 'logibtp-*'`, `journalctl -u logibtp-sauvegarde` |
| Double facteur demandé sur le réseau local | Adresse du poste hors de `--confiance` ; relancer l'installeur avec le bon réseau |
