# Fonctions communes des scripts d'installation LogiBTP (Windows PowerShell 5.1 et PowerShell 7), chargées par
# « . $PSScriptRoot\Commun.ps1 ». Tout passe par la commande docker : la même procédure vaut pour Docker Desktop, Docker
# Engine dans WSL 2 ou dans une machine virtuelle (contexte docker distant) : aucun dossier Windows n'est monté dans un
# conteneur, les fichiers passent par « docker cp » (ANALYSE-MODULE-INSTALLATION.md § 4).

$ErrorActionPreference = 'Stop'

$script:VolumesApi = @('logibtp-config', 'logibtp-base-config', 'logibtp-certificats', 'logibtp-ged', 'logibtp-journaux', 'logibtp-sauvegardes')
$script:VolumesBase = @('logibtp-base-donnees', 'logibtp-base-config', 'logibtp-sauvegardes')

function Ecrire-Etape([string]$Texte) { Write-Host ''; Write-Host "== $Texte" -ForegroundColor Cyan }
function Ecrire-Info([string]$Texte) { Write-Host "   $Texte" }
function Ecrire-Alerte([string]$Texte) { Write-Host "   ⚠ $Texte" -ForegroundColor Yellow }

# Appels de docker : seul le code de retour compte. Les arguments passent par $args (fonction simple) : une fonction à
# paramètres lierait « -v », « -d » ou « -u » de docker aux paramètres communs de PowerShell (-Verbose, -Debug…). Sous Windows PowerShell 5.1, la sortie d'erreur d'une commande
# redirigée devient une erreur PowerShell (bloquante avec « Stop ») : chaque fonction travaille donc en « Continue ».

# Commande docker ; une sortie non nulle est une erreur.
function Invoquer-Docker {
    $Arguments = [string[]]$args
    $ErrorActionPreference = 'Continue'
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker $($Arguments -join ' ') : échec (code $LASTEXITCODE)" }
}

# Commande docker dont on lit la sortie (lignes) ; erreur si elle échoue.
function Lire-Docker {
    $Arguments = [string[]]$args
    $ErrorActionPreference = 'Continue'
    $sortie = & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker $($Arguments -join ' ') : échec (code $LASTEXITCODE)" }
    return $sortie
}

function Tester-Docker {
    $Arguments = [string[]]$args
    $ErrorActionPreference = 'Continue'
    & docker @Arguments *> $null
    return ($LASTEXITCODE -eq 0)
}

# Réglages des projets Compose (installation.env du dossier de l'installation : image, ports, base distante).
function Lire-Reglages([string]$Dossier) {
    $r = @{}
    $fichier = Join-Path $Dossier 'installation.env'
    if (Test-Path $fichier) {
        foreach ($l in Get-Content $fichier -Encoding UTF8) {
            if ($l -match '^\s*([A-Z_]+)=(.*)$') { $r[$Matches[1]] = $Matches[2].Trim() }
        }
    }
    return $r
}

function Ecrire-Reglages([string]$Dossier, [hashtable]$Reglages) {
    $lignes = @('# Réglages des projets Compose de LogiBTP (image, ports) : écrits par Installer-LogiBTP.ps1, aucun secret.')
    foreach ($c in ($Reglages.Keys | Sort-Object)) { $lignes += "$c=$($Reglages[$c])" }
    [System.IO.File]::WriteAllLines((Join-Path $Dossier 'installation.env'), $lignes, (New-Object System.Text.UTF8Encoding($false)))
}

# docker compose sur le projet « base » ou « api » de l'installation (surcharge distante de la base si demandée).
function Invoquer-Compose([string]$Dossier, [string]$Projet, [string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    $fichiers = @('-f', (Join-Path $Dossier "$Projet\compose.yml"))
    $r = Lire-Reglages $Dossier
    if ($Projet -eq 'base' -and $r['LOGIBTP_BASE_DISTANTE'] -eq '1') { $fichiers += @('-f', (Join-Path $Dossier 'base\compose.distant.yml')) }
    $tout = @('compose', '--env-file', (Join-Path $Dossier 'installation.env')) + $fichiers + $Arguments
    & docker @tout
    if ($LASTEXITCODE -ne 0) { throw "docker compose ($Projet) $($Arguments -join ' ') : échec (code $LASTEXITCODE)" }
}

# Commande de l'image de l'API (installation …, comptes …) dans le service d'outils.
function Invoquer-Installation([string]$Dossier, [string[]]$Arguments) {
    Invoquer-Compose $Dossier 'api' (@('run', '--rm', '-T', 'logibtp-installation') + $Arguments)
}

# Même commande, sortie lue (lignes jointes) ; une erreur n'interrompt pas (état à afficher).
function Lire-Installation([string]$Dossier, [string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    $tout = @('compose', '--env-file', (Join-Path $Dossier 'installation.env'), '-f', (Join-Path $Dossier 'api\compose.yml'), 'run', '--rm', '-T', 'logibtp-installation') + $Arguments
    return ((& docker @tout 2>$null) -join "`n")
}

# Conteneur d'outils arrêté qui monte un volume sous /v : sert de passage à « docker cp ».
function Nouveau-Passage([string]$Image, [string]$Volume) {
    $nom = 'logibtp-passage-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    Lire-Docker create --name $nom --user root --entrypoint true -v "${Volume}:/v" $Image | Out-Null
    return $nom
}

# Copie un fichier ou un dossier Windows dans un volume (chemin relatif à la racine du volume) ; propriétaire facultatif (uid:gid).
function Copier-VersVolume([string]$Image, [string]$Volume, [string]$Source, [string]$Cible, [string]$Proprietaire) {
    $p = Nouveau-Passage $Image $Volume
    try { Invoquer-Docker cp $Source "${p}:/v/$Cible" } finally { Invoquer-Docker rm -f $p | Out-Null }
    if ($Proprietaire) { Invoquer-Docker run --rm --user root --entrypoint chown -v "${Volume}:/v" $Image -R $Proprietaire "/v/$Cible" }
}

function Copier-DepuisVolume([string]$Image, [string]$Volume, [string]$Source, [string]$Cible) {
    $p = Nouveau-Passage $Image $Volume
    try { Invoquer-Docker cp "${p}:/v/$Source" $Cible } finally { Invoquer-Docker rm -f $p | Out-Null }
}

# Commande dans un conteneur jetable de l'image, sur un volume monté sous /v (compte root : droits des fichiers).
function Invoquer-SurVolume([string]$Image, [string]$Volume, [string]$Entree, [string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    $tout = @('run', '--rm', '--user', 'root', '--entrypoint', $Entree, '-v', "${Volume}:/v", $Image) + $Arguments
    & docker @tout
    if ($LASTEXITCODE -ne 0) { throw "docker $Entree sur $Volume : échec (code $LASTEXITCODE)" }
}

# Hôte Docker (§ 4) : A = Docker Desktop, B = Docker Engine local (WSL 2), C = moteur distant (machine virtuelle).
function Lire-HoteDocker {
    $ErrorActionPreference = 'Continue'
    $os = (Lire-Docker info --format '{{.OperatingSystem}}') -join ''
    $hote = (& docker context inspect --format '{{.Endpoints.docker.Host}}' 2>$null) -join ''
    if ($os -match 'Docker Desktop') { return 'A' }
    if ($hote -match '^(ssh|tcp)://') { return 'C' }
    return 'B'
}

function Tester-Administrateur {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Jeux de sauvegardes à garder (§ 7.1) : les 7 dernières, la dernière de chacune des 4 dernières semaines, la dernière de
# chacun des 12 derniers mois. Noms au format AAAAMMJJ-HHmmss ; renvoie ceux à supprimer.
function Lire-SauvegardesASupprimer([string[]]$Noms) {
    $valides = @($Noms | Where-Object { $_ -match '^\d{8}-\d{6}$' } | Sort-Object -Descending)
    $garder = New-Object 'System.Collections.Generic.HashSet[string]'
    $valides | Select-Object -First 7 | ForEach-Object { [void]$garder.Add($_) }
    $culture = [Globalization.CultureInfo]::InvariantCulture
    $semaines = $valides | Group-Object { $d = [datetime]::ParseExact($_.Substring(0, 8), 'yyyyMMdd', $culture); "$($d.Year)-$($culture.Calendar.GetWeekOfYear($d, 'FirstFourDayWeek', 'Monday'))" }
    $semaines | Select-Object -First 4 | ForEach-Object { [void]$garder.Add(@($_.Group | Sort-Object -Descending)[0]) }
    $mois = $valides | Group-Object { $_.Substring(0, 6) }
    $mois | Select-Object -First 12 | ForEach-Object { [void]$garder.Add(@($_.Group | Sort-Object -Descending)[0]) }
    return @($valides | Where-Object { -not $garder.Contains($_) })
}
