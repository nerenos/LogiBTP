<#
.SYNOPSIS
    Installe LogiBTP sur un serveur Windows : un conteneur Docker pour l'API (qui sert le client web) et un conteneur
    indépendant pour PostgreSQL, en HTTPS sur le réseau local (ANALYSE-MODULE-INSTALLATION.md § 6).

.DESCRIPTION
    Chaque étape est rejouable : relancer le script avec les mêmes paramètres reprend là où il s'est arrêté, sans rien
    recréer (bases, secrets, certificat). Rôles :
      Complet : API et base sur ce serveur (cas courant).
      Api     : API ici, base sur une autre machine (-BaseDistante) : prépare la configuration de la base dans
                <Dossier>\base-distante, à recopier sur le serveur de la base ; relancer ensuite avec -BaseDemarree.
      Base    : base seule, avec la configuration préparée par le serveur de l'API (-ConfigurationBase).
    Les volumes Docker et le réseau sont externes : « docker compose down -v » ne détruit aucune donnée.

.EXAMPLE
    .\Installer-LogiBTP.ps1 -Domaine logibtp.entreprise.fr -Confiance 192.168.1.0/24 -Administrateur direction

.EXAMPLE
    .\Installer-LogiBTP.ps1 -Domaine logibtp.entreprise.fr -FichierImage .\logibtp-api.tar -Certificat Importer -FichierCertificat .\joker.pfx
#>
[CmdletBinding()]
param(
    [ValidateSet('Complet', 'Api', 'Base')] [string]$Role = 'Complet',
    [string]$Domaine,
    [string]$Dossier = 'C:\LogiBTP',
    [string]$Image = 'logibtp/api:latest',
    [string]$FichierImage,
    [string]$ImageBase = 'postgres:17',
    [ValidateSet('LOCAL', 'INTERNET')] [string]$Deploiement = 'LOCAL',
    [string]$Confiance,
    [int]$MemoireMo = 2048,
    [string]$Libelle,
    [ValidateSet('LogiBTP', 'Importer', 'Aucun')] [string]$Certificat = 'LogiBTP',
    [string]$FichierCertificat,
    [string]$FichierCle,
    [string]$Organisation,
    [string]$Administrateur,
    [string]$FichierEnv,
    [string]$BaseDistante,
    [string]$AdresseApi,
    [switch]$BaseDemarree,
    [string]$ConfigurationBase,
    [int]$PortHttp = 80,
    [int]$PortHttps = 443,
    [int]$PortBase = 5432,
    [string]$Reseau = '172.30.70.0/24',
    [string]$HeureSauvegarde = '01:30',
    [string]$CopieSauvegardes,
    [switch]$SansPareFeu,
    [switch]$SansTaches,
    [switch]$SansRacineServeur
)

. (Join-Path $PSScriptRoot 'Commun.ps1')
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
$racinePaquet = Split-Path $PSScriptRoot -Parent

# ---------------------------------------------------------------- 1. prérequis
Ecrire-Etape '1. Prérequis'
if ($Role -ne 'Base' -and -not $Domaine) { throw '-Domaine obligatoire (ex. logibtp.entreprise.fr : sous-domaine du domaine de l''entreprise, § 5.1)' }
if ($Role -eq 'Api' -and -not $BaseDistante) { throw 'Rôle Api : -BaseDistante obligatoire (nom DNS de la base, ex. base.logibtp.entreprise.fr)' }
if ($Role -ne 'Complet' -and -not $AdresseApi) { throw '-AdresseApi obligatoire : adresse IP du serveur de l''API vue par la base' }
if ($Role -eq 'Base' -and -not $ConfigurationBase) { throw 'Rôle Base : -ConfigurationBase obligatoire (dossier base-distante préparé par le serveur de l''API)' }
$actionsSysteme = -not ($SansPareFeu -and $SansTaches -and ($SansRacineServeur -or $Role -eq 'Base'))
if ($actionsSysteme -and -not (Tester-Administrateur)) { throw 'Lancer PowerShell en administrateur (pare-feu, tâches planifiées, autorité du serveur), ou passer -SansPareFeu -SansTaches -SansRacineServeur' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker introuvable : installer Docker Desktop, Docker Engine (WSL 2) ou configurer le contexte d''une machine virtuelle (§ 4)' }
if (-not (Tester-Docker info)) { throw 'Docker ne répond pas : démarrer Docker (ou la machine virtuelle) puis relancer' }
if (-not (Tester-Docker compose version)) { throw 'docker compose (v2) introuvable' }
$hote = Lire-HoteDocker
switch ($hote) {
    'A' {
        Ecrire-Alerte 'Docker Desktop : il démarre avec la session de l''utilisateur. Sur un serveur, préférer une machine virtuelle Hyper-V (option C, § 4) ou cocher « Start Docker Desktop when you sign in » et ouvrir une session automatique.'
        if ((Get-CimInstance Win32_OperatingSystem).ProductType -ne 1) { Ecrire-Alerte 'Docker Desktop n''est pas pris en charge sur Windows Server.' }
    }
    'B' { Ecrire-Info 'Docker Engine local (WSL 2) : vérifier son démarrage automatique au démarrage de Windows (tâche planifiée « wsl -d <distribution> »).' }
    'C' { Ecrire-Info 'Moteur Docker distant (machine virtuelle) : le pare-feu et les ports se règlent sur la machine virtuelle.' }
}
Ecrire-Info "Hôte Docker : option $hote ; rôle $Role ; dossier $Dossier"

# ---------------------------------------------------------------- 2. dossier et réglages
Ecrire-Etape '2. Dossier de l''installation'
foreach ($d in @($Dossier, "$Dossier\base", "$Dossier\api", "$Dossier\outils", "$Dossier\sauvegardes")) { New-Item -ItemType Directory -Force $d | Out-Null }
Copy-Item (Join-Path $racinePaquet 'docker\base\*') "$Dossier\base" -Force
Copy-Item (Join-Path $racinePaquet 'docker\api\*') "$Dossier\api" -Force
Copy-Item (Join-Path $PSScriptRoot '*.ps1') "$Dossier\outils" -Force
# Droits : administrateurs, SYSTEM et le compte qui installe (les sauvegardes contiennent les secrets de l'installation).
$ErrorActionPreference = 'Continue'
$moi = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
# Sur le seul dossier racine : les entrées héritables se propagent aux sous-dossiers et fichiers.
& icacls $Dossier /grant:r "*${moi}:(OI)(CI)F" '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' /Q | Out-Null
if ($LASTEXITCODE -eq 0) { & icacls $Dossier /inheritance:r /Q | Out-Null }
$ErrorActionPreference = 'Stop'
$reglages = Lire-Reglages $Dossier
$reglages['LOGIBTP_IMAGE'] = $Image
$reglages['LOGIBTP_IMAGE_BASE'] = $ImageBase
$reglages['LOGIBTP_PORT_HTTP'] = "$PortHttp"
$reglages['LOGIBTP_PORT_HTTPS'] = "$PortHttps"
$reglages['LOGIBTP_PORT_BASE'] = "$PortBase"
$reglages['LOGIBTP_ROLE'] = $Role
if ($Role -eq 'Base') { $reglages['LOGIBTP_BASE_DISTANTE'] = '1' }
Ecrire-Reglages $Dossier $reglages

# ---------------------------------------------------------------- 3. images, réseau, volumes
Ecrire-Etape '3. Images, réseau et volumes'
if ($Role -ne 'Base') {
    if ($FichierImage) { Invoquer-Docker load -i $FichierImage }
    elseif (-not (Tester-Docker image inspect $Image)) { Invoquer-Docker pull $Image }
}
if (-not (Tester-Docker image inspect $ImageBase)) { Invoquer-Docker pull $ImageBase }
if (-not (Tester-Docker network inspect logibtp)) { Invoquer-Docker network create --subnet $Reseau logibtp | Out-Null }
$volumes = if ($Role -eq 'Base') { $script:VolumesBase } elseif ($Role -eq 'Api') { $script:VolumesApi } else { ($script:VolumesApi + $script:VolumesBase) | Select-Object -Unique }
foreach ($v in $volumes) { if (-not (Tester-Docker volume inspect $v)) { Invoquer-Docker volume create $v | Out-Null; Ecrire-Info "volume $v créé" } }
# Sauvegardes écrites par PostgreSQL (pg_dump) et par l'API (GED) : dossier partagé.
$imageOutil = if ($Role -eq 'Base') { $ImageBase } else { $Image }
Invoquer-SurVolume $imageOutil 'logibtp-sauvegardes' 'chmod' @('1777', '/v')

# ---------------------------------------------------------------- rôle Base : configuration reçue, base démarrée
if ($Role -eq 'Base') {
    Ecrire-Etape '4. Configuration de la base (préparée par le serveur de l''API)'
    foreach ($f in @('pg_hba.conf', 'postgresql.conf', 'base.crt', 'base.key', 'postgres-mdp')) {
        $chemin = Join-Path $ConfigurationBase $f
        if (-not (Test-Path $chemin)) { throw "$f absent de $ConfigurationBase" }
        Copier-VersVolume $ImageBase 'logibtp-base-config' $chemin $f '0:0'
    }
    Invoquer-SurVolume $ImageBase 'logibtp-base-config' 'chmod' @('644', '/v/pg_hba.conf', '/v/postgresql.conf', '/v/base.crt', '/v/postgres-mdp')
    Ecrire-Etape '5. Démarrage de la base'
    Invoquer-Compose $Dossier 'base' @('up', '-d', '--wait')
    if (-not $SansPareFeu) {
        Get-NetFirewallRule -DisplayName 'LogiBTP - base' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        New-NetFirewallRule -DisplayName 'LogiBTP - base' -Direction Inbound -Protocol TCP -LocalPort $PortBase -RemoteAddress $AdresseApi -Action Allow | Out-Null
        Ecrire-Info "Pare-feu : port $PortBase ouvert au seul serveur de l'API ($AdresseApi)"
    }
    if (-not $SansTaches) {
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Dossier\outils\Sauvegarder-LogiBTP.ps1`" -Dossier `"$Dossier`""
        Register-ScheduledTask -TaskName 'LogiBTP - sauvegarde' -Action $action -Trigger (New-ScheduledTaskTrigger -Daily -At $HeureSauvegarde) `
            -Principal (New-ScheduledTaskPrincipal -UserId "$($env:USERDOMAIN)\$($env:USERNAME)" -LogonType S4U -RunLevel Highest) -Force | Out-Null
        Ecrire-Info "Tâche planifiée : sauvegarde des bases chaque jour à $HeureSauvegarde"
    }
    Ecrire-Etape 'Base prête'
    Ecrire-Info 'Relancer l''installeur du serveur de l''API avec -BaseDemarree.'
    return
}

# ---------------------------------------------------------------- 4. configuration
Ecrire-Etape '4. Configuration (.env, sociétés, PostgreSQL)'
if ($FichierEnv) {
    Ecrire-Info "`.env fourni : $FichierEnv (conservé tel quel, variables manquantes ajoutées)"
    Copier-VersVolume $Image 'logibtp-config' $FichierEnv '.env' '1654:1654'
}
$preparer = @('installation', 'preparer', '--domaine', $Domaine, '--deploiement', $Deploiement, '--memoire', "$MemoireMo", '--reseau', $Reseau)
if ($Confiance) { $preparer += @('--confiance', $Confiance) }
if ($Libelle) { $preparer += @('--libelle', $Libelle) }
if ($BaseDistante) { $preparer += @('--base-hote', $BaseDistante) }
Invoquer-Installation $Dossier $preparer

# ---------------------------------------------------------------- 5. certificat
Ecrire-Etape '5. Certificat HTTPS'
$etatCertificat = Lire-Installation $Dossier @('installation', 'certificat', 'etat')
if ($Certificat -eq 'Aucun') { Ecrire-Alerte 'Sans certificat, l''application est en HTTP : copier-coller des lignes, empreintes de la GED et borne indisponibles hors du serveur (§ 2).' }
elseif ($etatCertificat -notmatch 'Aucun certificat') { Ecrire-Info "Certificat existant conservé : $etatCertificat" }
elseif ($Certificat -eq 'Importer') {
    if (-not $FichierCertificat) { throw '-FichierCertificat obligatoire avec -Certificat Importer (.pfx, .p12 ou .pem ; -FichierCle pour un PEM)' }
    Copier-VersVolume $Image 'logibtp-config' $FichierCertificat ('import-' + (Split-Path $FichierCertificat -Leaf)) '1654:1654'
    $importer = @('installation', 'certificat', 'importer', '--certificat', '/app/config/import-' + (Split-Path $FichierCertificat -Leaf))
    if ($FichierCle) {
        Copier-VersVolume $Image 'logibtp-config' $FichierCle ('import-' + (Split-Path $FichierCle -Leaf)) '1654:1654'
        $importer += @('--cle', '/app/config/import-' + (Split-Path $FichierCle -Leaf))
    }
    if ($FichierCertificat -match '\.(pfx|p12)$') {
        $mdp = Read-Host -AsSecureString 'Mot de passe du fichier PKCS#12 (vide : aucun)'
        $env:LOGIBTP_CERTIFICAT_MOT_DE_PASSE = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($mdp))
        try {
            Invoquer-Compose $Dossier 'api' (@('run', '--rm', '-T', '-e', 'LOGIBTP_CERTIFICAT_MOT_DE_PASSE', 'logibtp-installation') + $importer)
        } finally { Remove-Item Env:LOGIBTP_CERTIFICAT_MOT_DE_PASSE }
    }
    else { Invoquer-Installation $Dossier $importer }
    Invoquer-SurVolume $Image 'logibtp-config' 'sh' @('-c', 'rm -f /v/import-*')
}
else {
    $creer = @('installation', 'certificat', 'creer')
    if ($Organisation) { $creer += @('--organisation', $Organisation) }
    Invoquer-Installation $Dossier $creer
}

# ---------------------------------------------------------------- 6. base
Ecrire-Etape '6. Base de données'
if ($Role -eq 'Api') {
    Invoquer-Installation $Dossier @('installation', 'certificat', 'base', '--nom', $BaseDistante, '--adresses-api', $AdresseApi)
    if (-not $BaseDemarree) {
        $export = Join-Path $Dossier 'base-distante'
        if (Test-Path $export) { Remove-Item $export -Recurse -Force }
        Copier-DepuisVolume $Image 'logibtp-base-config' '.' $export
        Ecrire-Etape 'Étape suivante : serveur de la base'
        Ecrire-Info "Recopier le dossier $export et le paquet d'installation sur le serveur de la base, puis y lancer :"
        Ecrire-Info "  .\Installer-LogiBTP.ps1 -Role Base -ConfigurationBase <dossier base-distante> -AdresseApi $AdresseApi"
        Ecrire-Info "Déclarer $BaseDistante dans le DNS, puis relancer ici le même installeur avec -BaseDemarree."
        Ecrire-Alerte "Le dossier $export contient le mot de passe de première initialisation de PostgreSQL : le supprimer après la copie."
        return
    }
}
else { Invoquer-Compose $Dossier 'base' @('up', '-d', '--wait') }
Invoquer-Installation $Dossier @('installation', 'base', 'creer')
if ($Role -eq 'Api' -and (Test-Path "$Dossier\base-distante")) { Remove-Item "$Dossier\base-distante" -Recurse -Force }

# ---------------------------------------------------------------- 7. API
Ecrire-Etape '7. Démarrage de l''API'
Invoquer-Compose $Dossier 'api' @('up', '-d', '--wait')

# ---------------------------------------------------------------- 8. premier administrateur
if ($Administrateur) {
    Ecrire-Etape '8. Premier administrateur'
    $comptes = Lire-Installation $Dossier @('comptes', 'liste')
    if ($comptes -match "(?m)^\s*$([regex]::Escape($Administrateur))\b") { Ecrire-Info "Compte $Administrateur existant : inchangé" }
    else {
        Ecrire-Info 'Mot de passe provisoire affiché une seule fois ci-dessous (à changer à la première connexion) :'
        Invoquer-Installation $Dossier @('comptes', 'creer-admin', $Administrateur)
    }
}

# ---------------------------------------------------------------- 9. Windows : autorité, pare-feu, tâches
Ecrire-Etape '9. Windows'
$racine = Join-Path $Dossier 'logibtp-racine.crt'
if (Test-Path $racine) { Remove-Item $racine -Force }
try { Copier-DepuisVolume $Image 'logibtp-certificats' 'racine.crt' $racine } catch { $racine = $null }
if ($racine -and -not $SansRacineServeur) {
    Import-Certificate -FilePath $racine -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    Ecrire-Info 'Autorité LogiBTP installée sur ce serveur (navigateurs du serveur et du TSE s''il s''agit du même)'
}
if (-not $SansPareFeu) {
    if ($hote -eq 'C') { Ecrire-Info 'Moteur distant : ouvrir les ports 80 et 443 sur la machine virtuelle.' }
    else {
        $distants = if ($Confiance) { $Confiance -split '[,; ]+' | Where-Object { $_ } } else { @('LocalSubnet') }
        foreach ($r in @(@{ Nom = 'LogiBTP - HTTPS'; Port = $PortHttps }, @{ Nom = 'LogiBTP - HTTP (redirection, certificat)'; Port = $PortHttp })) {
            Get-NetFirewallRule -DisplayName $r.Nom -ErrorAction SilentlyContinue | Remove-NetFirewallRule
            New-NetFirewallRule -DisplayName $r.Nom -Direction Inbound -Protocol TCP -LocalPort $r.Port -RemoteAddress $distants -Action Allow | Out-Null
        }
        Ecrire-Info "Pare-feu : ports $PortHttp et $PortHttps ouverts au réseau local ($($distants -join ', '))"
    }
}
if (-not $SansTaches) {
    $principal = New-ScheduledTaskPrincipal -UserId "$($env:USERDOMAIN)\$($env:USERNAME)" -LogonType S4U -RunLevel Highest
    $copie = if ($CopieSauvegardes) { " -Copie `"$CopieSauvegardes`"" } else { '' }
    $sauvegarde = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Dossier\outils\Sauvegarder-LogiBTP.ps1`" -Dossier `"$Dossier`"$copie"
    Register-ScheduledTask -TaskName 'LogiBTP - sauvegarde' -Action $sauvegarde -Trigger (New-ScheduledTaskTrigger -Daily -At $HeureSauvegarde) -Principal $principal -Force | Out-Null
    $renouveler = New-ScheduledTaskAction -Execute 'docker.exe' -Argument "compose --env-file `"$Dossier\installation.env`" -f `"$Dossier\api\compose.yml`" run --rm -T logibtp-installation installation certificat renouveler"
    Register-ScheduledTask -TaskName 'LogiBTP - certificat' -Action $renouveler -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '03:00') -Principal $principal -Force | Out-Null
    Ecrire-Info "Tâches planifiées : sauvegarde chaque jour à $HeureSauvegarde, renouvellement du certificat chaque dimanche (60 jours avant l'échéance)"
}

# ---------------------------------------------------------------- 10. rapport
Ecrire-Etape '10. Rapport'
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress
$zone = $Domaine.Substring($Domaine.IndexOf('.') + 1)
$nom = $Domaine.Substring(0, $Domaine.IndexOf('.'))
$etat = Lire-Installation $Dossier @('installation', 'certificat', 'etat')
$societes = Lire-Installation $Dossier @('installation', 'societes')
$port = if ($PortHttps -eq 443) { '' } else { ":$PortHttps" }
$rapport = @"
Installation LogiBTP du $(Get-Date -Format 'dd/MM/yyyy HH:mm') (rôle $Role, hôte Docker option $hote)

Adresses
  https://$Domaine$port/            (base principale)
  https://<société>.$Domaine$port/  (une société par sous-domaine)
  http://$Domaine$(if ($PortHttp -ne 80) { ":$PortHttp" })/certificat  (autorité à installer sur les postes, script, profil iPad)

Sociétés
$societes

Certificat
$etat

DNS (serveur DNS de l'Active Directory, à lancer par l'administrateur du domaine ; adresse du serveur : $ip)
  Add-DnsServerResourceRecordA -ZoneName '$zone' -Name '$nom' -IPv4Address '$ip'
  Add-DnsServerResourceRecordA -ZoneName '$zone' -Name '*.$nom' -IPv4Address '$ip'
  Sans Active Directory : DNS de la box (joker si possible) ou fichier hosts des postes (une ligne par société).

Postes
  Stratégie de groupe : importer $Dossier\logibtp-racine.crt dans les autorités racines de confiance de l'ordinateur ;
  sinon http://$Domaine$(if ($PortHttp -ne 80) { ":$PortHttp" })/certificat sur chaque poste, le TSE et les tablettes.

Sauvegardes
  Chaque jour à $HeureSauvegarde dans $Dossier\sauvegardes$(if ($CopieSauvegardes) { " et $CopieSauvegardes" }).
  Restauration : $Dossier\outils\Restaurer-LogiBTP.ps1 -Sauvegarde <dossier>.

À GARDER HORS DU SERVEUR
  Une sauvegarde complète (elle contient le .env et la clé de l'autorité) : leur perte rend illisibles les données
  chiffrées (mots de passe des fiches, comptes de messagerie, jetons) et impose de redéployer une nouvelle autorité.
"@
[System.IO.File]::WriteAllText((Join-Path $Dossier 'INSTALLATION.txt'), $rapport, (New-Object System.Text.UTF8Encoding($true)))
Write-Host $rapport
Ecrire-Info "Rapport enregistré : $Dossier\INSTALLATION.txt"
