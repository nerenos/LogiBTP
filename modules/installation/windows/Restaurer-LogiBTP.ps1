<#
.SYNOPSIS
    Restaure un jeu de sauvegarde de LogiBTP (ANALYSE-MODULE-INSTALLATION.md § 7.1) sur une installation en place :
    bases (recréées puis pg_restore sous logibtp_schema), droits des rôles, stockage de la GED ; avec
    -AvecConfiguration, aussi le .env, les sociétés et les certificats (reprise sur un nouveau serveur).

.DESCRIPTION
    L'API est arrêtée pendant la restauration, puis redémarrée. Les bases et la GED en place sont REMPLACÉES : la
    commande demande de taper RESTAURER (ou -Confirmer). Un jeu chiffré est déchiffré par la clé des données du .env en
    place : sur un nouveau serveur, installer d'abord avec -FichierEnv (le .env gardé hors du serveur).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$Sauvegarde,
    [string]$Dossier = 'C:\LogiBTP',
    [switch]$AvecConfiguration,
    [switch]$Confirmer
)

. (Join-Path $PSScriptRoot 'Commun.ps1')
$reglages = Lire-Reglages $Dossier
$image = $reglages['LOGIBTP_IMAGE']
if (-not (Test-Path $Sauvegarde)) { throw "Jeu de sauvegarde introuvable : $Sauvegarde" }
$dumps = @(Get-ChildItem $Sauvegarde -Filter '*.dump*' | ForEach-Object Name)
Write-Host "Jeu $Sauvegarde : $($dumps.Count) base(s)$(if (Test-Path (Join-Path $Sauvegarde 'ged.tar.gz*')) { ', GED' })$(if ($AvecConfiguration) { ', configuration' })"
if (-not $Confirmer) {
    if ((Read-Host 'Les bases et la GED en place seront remplacées. Taper RESTAURER pour continuer') -cne 'RESTAURER') { Write-Host 'Abandon.'; return }
}

Ecrire-Etape 'Arrêt de l''API'
Invoquer-Compose $Dossier 'api' @('stop', 'logibtp-api')
$jeu = 'restauration-' + (Get-Date -Format 'yyyyMMddHHmmss')
try {
    Ecrire-Etape 'Copie du jeu dans le volume des sauvegardes'
    Copier-VersVolume $image 'logibtp-sauvegardes' $Sauvegarde $jeu $null
    # Restauration d'une base : script SQL de pg_restore rejoué avec search_path = public (pg_restore vide le chemin de
    # recherche, et des fonctions appelées sans schéma dans des expressions indexées seraient introuvables).
    $script = Join-Path $env:TEMP 'restaurer-base.sh'
    $contenu = @'
#!/bin/bash
set -euo pipefail
pg_restore --no-owner --role=logibtp_schema -f - "$2"   | sed "s/set_config('search_path', '', false)/set_config('search_path', 'public', false)/"   | psql -v ON_ERROR_STOP=1 -q -o /dev/null -d "$1"
'@
    [System.IO.File]::WriteAllText($script, ($contenu -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))
    Copier-VersVolume $image 'logibtp-sauvegardes' $script "$jeu/restaurer-base.sh" $null
    Remove-Item $script
    Invoquer-SurVolume $image 'logibtp-sauvegardes' 'chmod' @('-R', 'a+rwX', "/v/$jeu")
    if (@(Get-ChildItem $Sauvegarde -Filter '*.chiffre').Count -gt 0) {
        Ecrire-Etape 'Déchiffrement (clé des données du .env en place)'
        Invoquer-Installation $Dossier @('installation', 'sauvegarde', 'dechiffrer', "/app/sauvegardes/$jeu")
        $dumps = @($dumps | ForEach-Object { $_ -replace '\.chiffre$', '' })
    }
    if ($AvecConfiguration) {
        Ecrire-Etape 'Configuration'
        Invoquer-Compose $Dossier 'api' @('run', '--rm', '-T', '--entrypoint', 'tar', 'logibtp-installation', '-xzf', "/app/sauvegardes/$jeu/configuration.tar.gz", '-C', '/app')
    }
    Ecrire-Etape 'Bases'
    foreach ($d in $dumps) {
        $b = [IO.Path]::GetFileNameWithoutExtension($d)
        if ($b -notmatch '^[a-z][a-z0-9_]*$') { throw "Nom de base invalide : $b" }
        Invoquer-Docker exec -u postgres logibtp-base psql -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $b WITH (FORCE)" -c "CREATE DATABASE $b OWNER logibtp_schema ENCODING 'UTF8' TEMPLATE template0"
        Invoquer-Docker exec -u postgres logibtp-base bash "/sauvegardes/$jeu/restaurer-base.sh" $b "/sauvegardes/$jeu/$b.dump"
        Ecrire-Info "base $b restaurée"
    }
    Invoquer-Installation $Dossier @('installation', 'base', 'droits')
    if (Test-Path (Join-Path $Sauvegarde 'ged.tar.gz*')) {
        Ecrire-Etape 'Stockage de la GED'
        Invoquer-Compose $Dossier 'api' @('run', '--rm', '-T', '--entrypoint', 'bash', 'logibtp-installation', '-c', "find /app/stockage-ged -mindepth 1 -delete && tar -xzf /app/sauvegardes/$jeu/ged.tar.gz -C /app/stockage-ged")
    }
}
finally {
    Invoquer-SurVolume $image 'logibtp-sauvegardes' 'rm' @('-rf', "/v/$jeu")
    Ecrire-Etape 'Redémarrage de l''API'
    Invoquer-Compose $Dossier 'api' @('up', '-d', '--wait')
}
Ecrire-Info 'Restauration terminée'
