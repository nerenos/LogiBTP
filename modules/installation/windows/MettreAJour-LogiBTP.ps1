<#
.SYNOPSIS
    Met à jour LogiBTP (ANALYSE-MODULE-INSTALLATION.md § 7.2) : nouvelle image de l'API, sauvegarde complète, scripts SQL
    de la nouvelle version sur toutes les bases (journal installation_script), droits, conversions, redémarrage.

.DESCRIPTION
    En cas d'échec (scripts ou démarrage de l'API), retour automatique : image précédente remise et jeu de sauvegarde
    pris juste avant restauré (les scripts SQL ne se défont pas autrement). Le conteneur de la base n'est pas touché.

.EXAMPLE
    .\MettreAJour-LogiBTP.ps1 -FichierImage .\logibtp-api-1.2.0.tar -Empreinte 3f5c…   (serveur sans internet)
.EXAMPLE
    .\MettreAJour-LogiBTP.ps1 -Image ghcr.io/editeur/logibtp-api:1.2.0
#>
[CmdletBinding()]
param(
    [string]$Image,
    [string]$FichierImage,
    [string]$Empreinte,
    [string]$Dossier = 'C:\LogiBTP'
)

. (Join-Path $PSScriptRoot 'Commun.ps1')
if (-not $Image -and -not $FichierImage) { throw '-Image ou -FichierImage obligatoire' }
$reglages = Lire-Reglages $Dossier
$precedente = $reglages['LOGIBTP_IMAGE']
if ($reglages['LOGIBTP_ROLE'] -eq 'Base') { throw 'Serveur de la base seule : la mise à jour se lance sur le serveur de l''API' }

Ecrire-Etape '1. Nouvelle image'
if ($FichierImage) {
    if ($Empreinte) {
        $calculee = (Get-FileHash $FichierImage -Algorithm SHA256).Hash
        if ($calculee -ne $Empreinte.Replace(':', '').ToUpperInvariant()) { throw "Empreinte SHA-256 du fichier différente de celle publiée ($calculee) : fichier altéré ou incomplet" }
        Ecrire-Info 'Empreinte SHA-256 vérifiée'
    }
    $charge = (Lire-Docker load -i $FichierImage) -join "`n"
    if ($charge -notmatch 'Loaded image: (\S+)') { throw "Image chargée introuvable : $charge" }
    $Image = $Matches[1]
}
elseif (-not (Tester-Docker image inspect $Image)) { Invoquer-Docker pull $Image }
if ($Image -eq $precedente) { Ecrire-Alerte "Image identique à l'actuelle ($Image) : seuls les scripts et les droits seront rejoués" }
Ecrire-Info "$precedente → $Image"

Ecrire-Etape '2. Sauvegarde complète avant mise à jour'
& (Join-Path $PSScriptRoot 'Sauvegarder-LogiBTP.ps1') -Dossier $Dossier
if ($LASTEXITCODE -ne 0) { throw 'Sauvegarde en échec : mise à jour abandonnée (rien n''a changé)' }
$jeu = (Get-ChildItem (Join-Path $Dossier 'sauvegardes') -Directory | Sort-Object Name | Select-Object -Last 1).FullName

function Revenir([string]$Raison) {
    Ecrire-Etape "Retour à la version précédente ($Raison)"
    $r = Lire-Reglages $Dossier
    $r['LOGIBTP_IMAGE'] = $precedente
    $r.Remove('LOGIBTP_IMAGE_PRECEDENTE')
    Ecrire-Reglages $Dossier $r
    & (Join-Path $PSScriptRoot 'Restaurer-LogiBTP.ps1') -Dossier $Dossier -Sauvegarde $jeu -Confirmer
    throw "Mise à jour annulée : $Raison. Version $precedente et données du $(Split-Path $jeu -Leaf) rétablies."
}

Ecrire-Etape '3. Arrêt de l''API et scripts de la nouvelle version'
Invoquer-Compose $Dossier 'api' @('stop', 'logibtp-api')
$reglages['LOGIBTP_IMAGE'] = $Image
$reglages['LOGIBTP_IMAGE_PRECEDENTE'] = $precedente
Ecrire-Reglages $Dossier $reglages
try { Invoquer-Installation $Dossier @('installation', 'base', 'mettre-a-jour') } catch { Revenir "scripts SQL : $($_.Exception.Message)" }

Ecrire-Etape '4. Démarrage de la nouvelle version'
try { Invoquer-Compose $Dossier 'api' @('up', '-d', '--wait') } catch { Revenir 'l''API ne démarre pas' }
Write-Host (Lire-Installation $Dossier @('installation', 'etat'))
Ecrire-Info "Mise à jour terminée ($Image). Sauvegarde d'avant : $jeu"
