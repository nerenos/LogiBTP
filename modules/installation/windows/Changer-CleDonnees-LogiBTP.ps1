<#
.SYNOPSIS
    Change la clé des données de LogiBTP (LOGIBTP_CLE_CHIFFREMENT : mots de passe des fiches, comptes de messagerie, jetons
    OAuth, clé de l'autorité) et rechiffre toutes les bases (ANALYSE-MODULE-INSTALLATION.md § 10, lot 4).

.DESCRIPTION
    Sauvegarde, arrêt de l'API, nouvelle clé (l'ancienne reste dans LOGIBTP_CLE_CHIFFREMENT_PRECEDENTES : elle déchiffre ce
    qui ne serait pas encore rechiffré et les sauvegardes antérieures), rechiffrement, redémarrage, nouvelle sauvegarde.
    Interrompu, il se reprend par « installation cle-donnees rechiffrer ». Les sessions ouvertes sont fermées.
    Après coup : garder hors du serveur la nouvelle sauvegarde (elle contient le nouveau .env).
#>
[CmdletBinding()]
param(
    [string]$Dossier = 'C:\LogiBTP',
    [switch]$Confirmer
)

. (Join-Path $PSScriptRoot 'Commun.ps1')
if (-not $Confirmer) {
    if ((Read-Host 'La clé des données va changer et toutes les bases être rechiffrées. Taper CHANGER pour continuer') -cne 'CHANGER') { Write-Host 'Abandon.'; return }
}
Ecrire-Etape '1. Sauvegarde'
& (Join-Path $PSScriptRoot 'Sauvegarder-LogiBTP.ps1') -Dossier $Dossier
if ($LASTEXITCODE -ne 0) { throw 'Sauvegarde en échec : rien n''a changé' }
Ecrire-Etape '2. Nouvelle clé et rechiffrement (API arrêtée)'
Invoquer-Compose $Dossier 'api' @('stop', 'logibtp-api')
try { Invoquer-Installation $Dossier @('installation', 'cle-donnees', 'changer') }
finally {
    Ecrire-Etape '3. Redémarrage de l''API'
    Invoquer-Compose $Dossier 'api' @('up', '-d', '--wait')
}
Ecrire-Etape '4. Sauvegarde avec la nouvelle clé'
& (Join-Path $PSScriptRoot 'Sauvegarder-LogiBTP.ps1') -Dossier $Dossier
Ecrire-Alerte 'Garder hors du serveur cette dernière sauvegarde (nouveau .env) : sans elle, les données chiffrées sont perdues.'
