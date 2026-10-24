<#
.SYNOPSIS
    Certificat Let's Encrypt du domaine de l'installation et de son joker par défi DNS (ANALYSE-MODULE-INSTALLATION.md
    § 5.3, option B) : reconnu par tous les postes et tablettes sans rien installer.

.DESCRIPTION
    Le domaine de l'installation doit être un sous-domaine d'un domaine public dont le DNS est chez un fournisseur doté
    d'une API (OVH, Cloudflare, Infomaniak, Gandi… : code du fournisseur et variables dans la documentation de lego,
    https://go-acme.github.io/lego/dns/). Le client ACME est l'image goacme/lego (version épinglée), ses données dans le
    volume logibtp-letsencrypt ; les identifiants du fournisseur restent dans <Dossier>\letsencrypt.env (droits du
    dossier). Le certificat obtenu est importé (origine LETSENCRYPT) et rechargé à chaud par l'API.
    -Renouveler (tâche planifiée hebdomadaire) : renouvellement 30 jours avant l'échéance, puis import.
    -AccepterConditions : vous acceptez les conditions d'utilisation de Let's Encrypt (obligatoire la première fois).

.EXAMPLE
    .\Certificat-LetsEncrypt.ps1 -Fournisseur ovh -FichierIdentifiants .\ovh.env -Courriel it@entreprise.fr -AccepterConditions
#>
[CmdletBinding()]
param(
    [string]$Dossier = 'C:\LogiBTP',
    [string]$Fournisseur,
    [string]$FichierIdentifiants,
    [string]$Courriel,
    [switch]$AccepterConditions,
    [switch]$Renouveler,
    [switch]$Essai
)

. (Join-Path $PSScriptRoot 'Commun.ps1')
$lego = 'goacme/lego:v4.21.0'
$reglages = Lire-Reglages $Dossier
$image = $reglages['LOGIBTP_IMAGE']
$domaine = $reglages['LOGIBTP_DOMAINE']
if (-not $domaine) { throw "LOGIBTP_DOMAINE absent de $Dossier\installation.env : installer d'abord (Installer-LogiBTP.ps1)" }
if ($Fournisseur) { $reglages['LOGIBTP_LETSENCRYPT_FOURNISSEUR'] = $Fournisseur }
if ($Courriel) { $reglages['LOGIBTP_LETSENCRYPT_COURRIEL'] = $Courriel }
$Fournisseur = $reglages['LOGIBTP_LETSENCRYPT_FOURNISSEUR']
$Courriel = $reglages['LOGIBTP_LETSENCRYPT_COURRIEL']
if (-not $Fournisseur -or -not $Courriel) { throw '-Fournisseur et -Courriel obligatoires la première fois' }
$identifiants = Join-Path $Dossier 'letsencrypt.env'
if ($FichierIdentifiants) { Copy-Item $FichierIdentifiants $identifiants -Force }
if (-not (Test-Path $identifiants)) { throw "-FichierIdentifiants obligatoire la première fois (variables du fournisseur $Fournisseur pour lego)" }
if (-not $Renouveler -and -not $AccepterConditions -and -not (Tester-Docker run --rm --entrypoint test -v logibtp-letsencrypt:/lego $lego -d /lego/accounts)) {
    throw "-AccepterConditions obligatoire : vous acceptez les conditions d'utilisation de Let's Encrypt"
}
$reglages['LOGIBTP_CERTIFICAT'] = 'LetsEncrypt'
Ecrire-Reglages $Dossier $reglages
if (-not (Tester-Docker volume inspect logibtp-letsencrypt)) { Invoquer-Docker volume create logibtp-letsencrypt | Out-Null }

Ecrire-Etape "Let's Encrypt : $domaine et *.$domaine ($Fournisseur)"
$arguments = @('run', '--rm', '--env-file', $identifiants, '-v', 'logibtp-letsencrypt:/lego', $lego, '--path', '/lego', '--email', $Courriel,
    '--dns', $Fournisseur, '--domains', $domaine, '--domains', "*.$domaine")
if ($AccepterConditions) { $arguments += '--accept-tos' }
if ($Essai) { $arguments += @('--server', 'https://acme-staging-v02.api.letsencrypt.org/directory') }
$deja = Tester-Docker run --rm --entrypoint test -v logibtp-letsencrypt:/lego $lego -f "/lego/certificates/$domaine.crt"
$arguments += if ($deja) { @('renew', '--days', '30') } else { @('run') }
Invoquer-Docker @arguments

Ecrire-Etape 'Import dans l''installation'
$copie = @('run', '--rm', '--user', 'root', '--entrypoint', 'sh', '-v', 'logibtp-letsencrypt:/le:ro', '-v', 'logibtp-config:/c', $image, '-c',
    "cp /le/certificates/$domaine.crt /c/import-le.crt && cp /le/certificates/$domaine.key /c/import-le.key && chown 1654:1654 /c/import-le.crt /c/import-le.key && chmod 600 /c/import-le.key")
Invoquer-Docker @copie
try {
    Invoquer-Installation $Dossier @('installation', 'certificat', 'importer', '--certificat', '/app/config/import-le.crt', '--cle', '/app/config/import-le.key', '--origine', 'LETSENCRYPT')
}
finally { Invoquer-SurVolume $image 'logibtp-config' 'sh' @('-c', 'rm -f /v/import-le.crt /v/import-le.key') }
Ecrire-Info 'Certificat en place (rechargé par l''API sans redémarrage).'
