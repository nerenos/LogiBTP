using System.Net;
using System.Text;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace LogiBTP.Installation.Web;

/// <summary>
/// Page d'amorçage du certificat (ANALYSE-MODULE-INSTALLATION.md § 5.5), publique, en HTTP comme en HTTPS :
/// /certificat (empreinte de la racine, consignes par cible, adresses des sociétés), /certificat/logibtp-racine.cer
/// (DER), /certificat/Installer-Certificat-LogiBTP.ps1 (postes Windows et TSE), /certificat/logibtp.mobileconfig
/// (iPad de la borne). Sans autorité à installer (certificat de l'Active Directory, d'un prestataire ou de
/// Let's Encrypt), la page l'indique et ne propose aucun téléchargement. Page statique, sans script.
/// </summary>
public static class Amorcage
{
    public static IEndpointRouteBuilder MapAmorcage(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/certificat", (HttpContext http, DossierCertificats d, IConfiguration c, IOptions<OptionsSocietes> s) =>
        {
            http.Response.Headers.ContentSecurityPolicy = ClientWeb.Csp;
            http.Response.Headers.CacheControl = "no-cache";
            return Results.Content(Page(d, c["LOGIBTP_DOMAINE"], s.Value), "text/html; charset=utf-8");
        });
        routes.MapGet("/certificat/logibtp-racine.cer", (DossierCertificats d) =>
            d.LireRacine() is { } r ? Results.File(r.RawData, "application/pkix-cert", "logibtp-racine.cer") : Results.NotFound());
        routes.MapGet("/certificat/Installer-Certificat-LogiBTP.ps1", (DossierCertificats d, IConfiguration c) =>
            d.LireRacine() is { } r ? Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(AutoriteCertificats.ScriptPostes(r, c["LOGIBTP_DOMAINE"] ?? ""))).ToArray(),
                "text/plain; charset=utf-8", "Installer-Certificat-LogiBTP.ps1") : Results.NotFound());
        routes.MapGet("/certificat/logibtp.mobileconfig", (DossierCertificats d, IConfiguration c) =>
            d.LireRacine() is { } r ? Results.File(Encoding.UTF8.GetBytes(AutoriteCertificats.ProfilApple(r, c["LOGIBTP_DOMAINE"] ?? "")),
                "application/x-apple-aspen-config", "logibtp.mobileconfig") : Results.NotFound());
        return routes;
    }

    private static string E(string? v) => WebUtility.HtmlEncode(v ?? "");

    public static string Page(DossierCertificats d, string? domaine, OptionsSocietes societes)
    {
        var infos = d.Infos();
        var racine = d.LireRacine();
        var s = new StringBuilder();
        s.Append($$"""
            <!doctype html>
            <html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
            <title>LogiBTP – certificat</title>
            <style>
              body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.5;color:#1d2433;background:#fff}
              h1{font-size:1.4em} h2{font-size:1.1em;margin-top:1.6em} code{background:#f1f3f6;padding:1px 4px;border-radius:3px;word-break:break-all}
              .bouton{display:inline-block;margin:4px 8px 4px 0;padding:6px 12px;border:1px solid #2f5fb3;border-radius:4px;color:#2f5fb3;text-decoration:none}
              @media (prefers-color-scheme:dark){body{background:#161a22;color:#e3e7ee} code{background:#262c38} .bouton{color:#8fb3ff;border-color:#8fb3ff} }
            </style></head><body>
            <h1>LogiBTP {{E(domaine)}} : connexion sécurisée</h1>
            """);
        if (infos is null)
        {
            s.Append("<p>Aucun certificat n'est installé sur ce serveur.</p></body></html>");
            return s.ToString();
        }
        s.Append($"<p>Certificat valable jusqu'au <strong>{infos.Fin.ToLocalTime():dd/MM/yyyy}</strong>, émis par <code>{E(infos.Emetteur)}</code>.</p>");
        if (racine is null || infos.Origine == OrigineCertificat.LetsEncrypt)
        {
            s.Append("<p>Ce certificat est reconnu par les postes sans rien installer (autorité publique ou de votre domaine Active Directory).</p>");
        }
        else
        {
            s.Append($"""
                <p>Les postes doivent reconnaître l'<strong>autorité de l'installation</strong> une fois pour toutes. Avant de l'installer,
                comparez son empreinte SHA-256 avec celle donnée par l'installeur :</p>
                <p><code>{E(AutoriteCertificats.Empreinte(racine))}</code></p>
                <p><a class="bouton" href="/certificat/logibtp-racine.cer">Autorité (logibtp-racine.cer)</a>
                <a class="bouton" href="/certificat/Installer-Certificat-LogiBTP.ps1">Script des postes Windows</a>
                <a class="bouton" href="/certificat/logibtp.mobileconfig">Profil iPad / iPhone</a></p>
                <h2>Postes d'un domaine Active Directory</h2>
                <p>Stratégie de groupe : Configuration ordinateur › Stratégies › Paramètres Windows › Paramètres de sécurité ›
                Stratégies de clé publique › Autorités de certification racines de confiance › Importer <code>logibtp-racine.cer</code>.</p>
                <h2>Poste Windows hors domaine, serveur TSE</h2>
                <p>Enregistrer le script puis, dans PowerShell en administrateur :
                <code>powershell -ExecutionPolicy Bypass -File .\Installer-Certificat-LogiBTP.ps1</code>. Sur le TSE, une seule fois :
                l'autorité vaut pour toutes les sessions. Edge et Chrome lisent le magasin de Windows ; Firefox aussi (version 120 et
                suivantes), sinon stratégie <code>ImportEnterpriseRoots</code>.</p>
                <h2>Tablettes de la borne</h2>
                <p>iPad : ouvrir le profil, l'installer (Réglages › Profil téléchargé), puis Réglages › Général › Informations ›
                Réglages des certificats › activer la confiance totale. Android : Paramètres › Sécurité › Installer un certificat ›
                Certificat CA, avec <code>logibtp-racine.cer</code>.</p>
                """);
        }
        if (!string.IsNullOrEmpty(domaine))
        {
            s.Append("<h2>Adresses</h2><ul>");
            s.Append($"<li><a href=\"https://{E(domaine)}/\">https://{E(domaine)}/</a> ({E(societes.LibellePrincipale)})</li>");
            foreach (var (code, soc) in societes.Liste)
                s.Append($"<li><a href=\"https://{E(code)}.{E(domaine)}/\">https://{E(code)}.{E(domaine)}/</a> ({E(string.IsNullOrEmpty(soc.Libelle) ? code : soc.Libelle)})</li>");
            s.Append("</ul><p>Une adresse qui ne répond pas : le nom n'est pas déclaré dans le DNS du réseau (voir l'administrateur).</p>");
        }
        s.Append("</body></html>");
        return s.ToString();
    }
}
