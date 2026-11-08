<#
.SYNOPSIS
    Tâche planifiée « LogiBTP - certificat » : renouvelle le certificat HTTPS (Let's Encrypt ou autorité LogiBTP) puis celui
    de la base (60 jours avant l'échéance) ; la base n'est redémarrée que si son certificat a changé.
#>
[CmdletBinding()]
param([string]$Dossier = 'C:\LogiBTP')

. (Join-Path $PSScriptRoot 'Commun.ps1')
$reglages = Lire-Reglages $Dossier
if ($reglages['LOGIBTP_ROLE'] -ne 'Base') {
    Ecrire-Etape 'Certificat HTTPS'
    if ($reglages['LOGIBTP_CERTIFICAT'] -eq 'LetsEncrypt') { & (Join-Path $PSScriptRoot 'Certificat-LetsEncrypt.ps1') -Dossier $Dossier -Renouveler }
    else { Invoquer-Installation $Dossier @('installation', 'certificat', 'renouveler') }
    Ecrire-Etape 'Certificat de la base'
    Renouveler-CertificatBase $Dossier
}
