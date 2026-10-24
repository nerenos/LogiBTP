<#
.SYNOPSIS
    Sauvegarde de l'installation LogiBTP (ANALYSE-MODULE-INSTALLATION.md § 7.1) : chaque base (pg_dump), le stockage de
    la GED et la configuration (.env, sociétés, certificats et autorité), au même moment, dans le volume des
    sauvegardes puis dans <Dossier>\sauvegardes\<AAAAMMJJ-HHmmss> (et la copie demandée : partage réseau, NAS).

.DESCRIPTION
    Lancé chaque nuit par la tâche planifiée « LogiBTP - sauvegarde ». Sur un serveur qui n'a que la base (rôle Base),
    seules les bases sont sauvegardées ; sur un serveur qui n'a que l'API, la GED et la configuration. Conservation : les
    7 dernières, la dernière de chacune des 4 dernières semaines et de chacun des 12 derniers mois. Le résultat
    (derniere-sauvegarde.json) est affiché par la page /parametres/installation ; un échec y est signalé.
    -Chiffrer : jeu chiffré par la clé des données (commande « installation sauvegarde chiffrer »).
#>
[CmdletBinding()]
param(
    [string]$Dossier = 'C:\LogiBTP',
    [string]$Copie,
    [switch]$Chiffrer
)

. (Join-Path $PSScriptRoot 'Commun.ps1')
$reglages = Lire-Reglages $Dossier
$image = if ($reglages['LOGIBTP_ROLE'] -eq 'Base') { $reglages['LOGIBTP_IMAGE_BASE'] } else { $reglages['LOGIBTP_IMAGE'] }
$jeu = Get-Date -Format 'yyyyMMdd-HHmmss'
$conteneurs = @(Lire-Docker ps --format '{{.Names}}')
$avecBase = $conteneurs -contains 'logibtp-base'
$avecApi = $reglages['LOGIBTP_ROLE'] -ne 'Base'
$bases = @()
$erreur = $null

function Ecrire-Resultat([long]$TailleMo) {
    $json = [ordered]@{ le = (Get-Date).ToString('o'); bases = $bases; tailleMo = $TailleMo; chiffree = [bool]$Chiffrer; erreur = $erreur } | ConvertTo-Json -Compress
    $fichier = Join-Path $env:TEMP 'derniere-sauvegarde.json'
    [System.IO.File]::WriteAllText($fichier, $json, (New-Object System.Text.UTF8Encoding($false)))
    Copier-VersVolume $image 'logibtp-sauvegardes' $fichier 'derniere-sauvegarde.json' $null
    Invoquer-SurVolume $image 'logibtp-sauvegardes' 'chmod' @('644', '/v/derniere-sauvegarde.json')
    Remove-Item $fichier
}

try {
    Ecrire-Etape "Sauvegarde $jeu"
    Invoquer-SurVolume $image 'logibtp-sauvegardes' 'mkdir' @('-m', '777', "/v/$jeu")
    if ($avecBase) {
        $bases = @(Lire-Docker exec -u postgres logibtp-base psql -At -c "SELECT datname FROM pg_database WHERE datname LIKE 'logibtp%' ORDER BY 1")
        foreach ($b in $bases) {
            Invoquer-Docker exec -u postgres logibtp-base pg_dump -Fc -d $b -f "/sauvegardes/$jeu/$b.dump"
            Ecrire-Info "base $b"
        }
    }
    if ($avecApi) {
        Invoquer-Compose $Dossier 'api' @('run', '--rm', '-T', '--entrypoint', 'tar', 'logibtp-installation', '-czf', "/app/sauvegardes/$jeu/ged.tar.gz", '-C', '/app/stockage-ged', '.')
        Ecrire-Info 'stockage de la GED'
        Invoquer-Compose $Dossier 'api' @('run', '--rm', '-T', '--entrypoint', 'tar', 'logibtp-installation', '-czf', "/app/sauvegardes/$jeu/configuration.tar.gz", '-C', '/app', 'config', 'certificats', 'base-config')
        Ecrire-Info 'configuration (.env, sociétés, certificats)'
        if ($Chiffrer) {
            Invoquer-Installation $Dossier @('installation', 'sauvegarde', 'chiffrer', "/app/sauvegardes/$jeu")
            Ecrire-Info 'jeu chiffré par la clé des données'
        }
    }
    $cible = Join-Path $Dossier "sauvegardes\$jeu"
    Copier-DepuisVolume $image 'logibtp-sauvegardes' $jeu $cible
    $taille = [long]((Get-ChildItem $cible -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
    if ($Copie) {
        New-Item -ItemType Directory -Force $Copie | Out-Null
        Copy-Item $cible (Join-Path $Copie $jeu) -Recurse -Force
        Ecrire-Info "copie : $Copie\$jeu"
    }
    # Conservation 7 / 4 / 12 : volume, dossier de l'installation et copie.
    $volume = @(Lire-Docker run --rm --entrypoint ls -v 'logibtp-sauvegardes:/v' $image /v)
    foreach ($n in Lire-SauvegardesASupprimer $volume) { Invoquer-SurVolume $image 'logibtp-sauvegardes' 'rm' @('-rf', "/v/$n") }
    foreach ($d in @((Join-Path $Dossier 'sauvegardes'), $Copie) | Where-Object { $_ -and (Test-Path $_) }) {
        foreach ($n in Lire-SauvegardesASupprimer @(Get-ChildItem $d -Directory | ForEach-Object Name)) { Remove-Item (Join-Path $d $n) -Recurse -Force }
    }
    Ecrire-Resultat $taille
    Ecrire-Info "Sauvegarde terminée : $cible ($taille Mo)"
}
catch {
    $erreur = $_.Exception.Message
    try { Ecrire-Resultat 0 } catch { }
    Write-Error "Sauvegarde en échec : $erreur"
    exit 1
}
