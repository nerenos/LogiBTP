using System.Formats.Asn1;
using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace LogiBTP.Installation;

/// <summary>Certificat émis avec sa clé privée (PEM).</summary>
public sealed record CertificatEmis(X509Certificate2 Certificat, string CertificatPem, string ClePem);

/// <summary>
/// Autorité de certification de l'installation (ANALYSE-MODULE-INSTALLATION.md § 5.3, option C) : racine RSA 3072 de
/// 10 ans à contrainte de noms (elle ne garantit que les noms de l'installation, même si sa clé fuit), certificats de
/// serveur RSA 2048 de 730 jours au plus (les appareils Apple refusent au-delà de 825 jours), nom de base et joker.
/// Aucune dépendance : API de cryptographie de .NET.
/// </summary>
public static class AutoriteCertificats
{
    public const int JoursServeurMax = 730;
    private const string OidContrainteNoms = "2.5.29.30";
    private const string OidAuthentificationServeur = "1.3.6.1.5.5.7.3.1";

    /// <summary>Noms d'une installation : le domaine et son joker (une société par sous-domaine).</summary>
    public static string[] NomsInstallation(string domaine) => [domaine, "*." + domaine];

    /// <summary>
    /// Racine de l'installation : contrainte de noms (dNSName) limitée aux <paramref name="perimetre"/> (le domaine de
    /// l'installation couvre aussi ses sous-domaines, la base distante comprise si elle en fait partie).
    /// </summary>
    public static CertificatEmis CreerRacine(string domaine, IEnumerable<string> perimetre, DateTimeOffset maintenant, string? organisation = null)
    {
        using var cle = RSA.Create(3072);
        var sujet = new X500DistinguishedNameBuilder();
        if (!string.IsNullOrWhiteSpace(organisation)) sujet.AddOrganizationName(organisation.Trim());
        sujet.AddCommonName($"Autorité LogiBTP {domaine}");
        var req = new CertificateRequest(sujet.Build(), cle, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, true, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        req.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(req.PublicKey, false));
        req.CertificateExtensions.Add(new X509Extension(OidContrainteNoms, ContrainteNoms(perimetre), true));
        var cert = req.CreateSelfSigned(maintenant.AddDays(-1), maintenant.AddYears(10));
        return new CertificatEmis(cert, cert.ExportCertificatePem(), cle.ExportPkcs8PrivateKeyPem());
    }

    /// <summary>Certificat de serveur signé par la racine (noms DNS ; le premier sert de nom commun).</summary>
    public static CertificatEmis Emettre(X509Certificate2 racine, string clePemRacine, IReadOnlyList<string> noms, DateTimeOffset maintenant, int jours = JoursServeurMax)
    {
        if (noms.Count == 0) throw new ArgumentException("Au moins un nom");
        if (jours is < 1 or > JoursServeurMax) throw new ArgumentException($"Durée d'un certificat de serveur : 1 à {JoursServeurMax} jours");
        using var cleRacine = RSA.Create();
        cleRacine.ImportFromPem(clePemRacine);
        using var cle = RSA.Create(2048);
        var sujet = new X500DistinguishedNameBuilder();
        sujet.AddCommonName(noms[0]);
        var req = new CertificateRequest(sujet.Build(), cle, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        req.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension([new Oid(OidAuthentificationServeur)], false));
        req.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(req.PublicKey, false));
        req.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(racine, true, false));
        var san = new SubjectAlternativeNameBuilder();
        foreach (var n in noms)
        {
            if (IPAddress.TryParse(n, out var ip)) san.AddIpAddress(ip);
            else san.AddDnsName(n);
        }
        req.CertificateExtensions.Add(san.Build());
        var fin = maintenant.AddDays(jours);
        if (fin > racine.NotAfter) fin = racine.NotAfter;
        var serie = RandomNumberGenerator.GetBytes(16);
        serie[0] &= 0x7F;
        using var publique = X509CertificateLoader.LoadCertificate(racine.RawData);
        using var signataire = publique.CopyWithPrivateKey(cleRacine);
        using var cert = req.Create(signataire, maintenant.AddDays(-1), fin, serie);
        var complet = cert.CopyWithPrivateKey(cle);
        return new CertificatEmis(complet, complet.ExportCertificatePem(), cle.ExportPkcs8PrivateKeyPem());
    }

    /// <summary>Extension NameConstraints (RFC 5280 § 4.2.1.10) : sous-arbres permis en dNSName.</summary>
    public static byte[] ContrainteNoms(IEnumerable<string> noms)
    {
        var w = new AsnWriter(AsnEncodingRules.DER);
        using (w.PushSequence())
        using (w.PushSequence(new Asn1Tag(TagClass.ContextSpecific, 0)))
        {
            foreach (var n in noms.Select(x => x.Trim().TrimStart('*', '.').ToLowerInvariant()).Distinct())
            {
                using (w.PushSequence()) w.WriteCharacterString(UniversalTagNumber.IA5String, n, new Asn1Tag(TagClass.ContextSpecific, 2));
            }
        }
        return w.Encode();
    }

    /// <summary>Noms permis par la contrainte de noms d'un certificat (vide : aucune contrainte).</summary>
    public static IReadOnlyList<string> NomsPermis(X509Certificate2 c)
    {
        var ext = c.Extensions.FirstOrDefault(e => e.Oid?.Value == OidContrainteNoms);
        if (ext is null) return [];
        var res = new List<string>();
        var r = new AsnReader(ext.RawData, AsnEncodingRules.DER).ReadSequence();
        var permis = r.ReadSequence(new Asn1Tag(TagClass.ContextSpecific, 0));
        while (permis.HasData)
        {
            var sous = permis.ReadSequence();
            res.Add(sous.ReadCharacterString(UniversalTagNumber.IA5String, new Asn1Tag(TagClass.ContextSpecific, 2)));
        }
        return res;
    }

    /// <summary>Noms DNS du certificat (extension subjectAltName).</summary>
    public static IReadOnlyList<string> NomsDns(X509Certificate2 c) =>
        c.Extensions.OfType<X509SubjectAlternativeNameExtension>().SelectMany(e => e.EnumerateDnsNames()).ToList();

    /// <summary>Le certificat couvre-t-il ce nom (joker sur un seul niveau, sans le nom de base) ?</summary>
    public static bool Couvre(X509Certificate2 c, string nom)
    {
        nom = nom.ToLowerInvariant();
        return NomsDns(c).Any(n =>
        {
            n = n.ToLowerInvariant();
            if (!n.StartsWith("*.", StringComparison.Ordinal)) return n == nom;
            var i = nom.IndexOf('.');
            return i > 0 && nom[(i + 1)..] == n[2..];
        });
    }

    /// <summary>Empreinte SHA-256 en hexadécimal par paires (affichée pour comparaison avant l'installation de la racine).</summary>
    public static string Empreinte(X509Certificate2 c) => string.Join(':', Convert.ToHexString(c.GetCertHash(HashAlgorithmName.SHA256)).Chunk(2).Select(p => new string(p)));

    /// <summary>Clé privée chiffrée (PKCS#8, AES-256, 600 000 itérations) par un mot de passe : clé de la racine rangée par la clé des données.</summary>
    public static string ChiffrerCle(string clePem, string motDePasse)
    {
        using var cle = RSA.Create();
        cle.ImportFromPem(clePem);
        return cle.ExportEncryptedPkcs8PrivateKeyPem(motDePasse, new PbeParameters(PbeEncryptionAlgorithm.Aes256Cbc, HashAlgorithmName.SHA256, 600_000));
    }

    public static string DechiffrerCle(string clePemChiffree, string motDePasse)
    {
        using var cle = RSA.Create();
        try { cle.ImportFromEncryptedPem(clePemChiffree, motDePasse); }
        catch (CryptographicException) { throw new InvalidOperationException("Clé de l'autorité illisible : la clé des données (LOGIBTP_CLE_CHIFFREMENT) a changé"); }
        return cle.ExportPkcs8PrivateKeyPem();
    }

    /// <summary>
    /// Profil de configuration iOS / iPadOS (tablettes de la borne) installant la racine : identifiants tirés de son
    /// empreinte (le même profil pour la même racine). Après installation : Réglages › Général › Informations ›
    /// Réglages des certificats › confiance totale.
    /// </summary>
    public static string ProfilApple(X509Certificate2 racine, string domaine)
    {
        var h = racine.GetCertHash(HashAlgorithmName.SHA256);
        string Uuid(int decalage) => new Guid(h.AsSpan(decalage, 16)).ToString().ToUpperInvariant();
        string X(string v) => System.Security.SecurityElement.Escape(v);
        var s = new StringBuilder();
        s.Append("""
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
            <dict>
              <key>PayloadContent</key>
              <array>
                <dict>
                  <key>PayloadCertificateFileName</key><string>logibtp-racine.cer</string>
                  <key>PayloadContent</key><data>
            """);
        s.Append(Convert.ToBase64String(racine.RawData));
        s.Append($"""
            </data>
                  <key>PayloadDescription</key><string>{X($"Autorité de l'installation LogiBTP {domaine}")}</string>
                  <key>PayloadDisplayName</key><string>{X(racine.GetNameInfo(X509NameType.SimpleName, false))}</string>
                  <key>PayloadIdentifier</key><string>fr.logibtp.racine.{Uuid(0)}</string>
                  <key>PayloadType</key><string>com.apple.security.root</string>
                  <key>PayloadUUID</key><string>{Uuid(0)}</string>
                  <key>PayloadVersion</key><integer>1</integer>
                </dict>
              </array>
              <key>PayloadDisplayName</key><string>{X($"LogiBTP {domaine}")}</string>
              <key>PayloadIdentifier</key><string>fr.logibtp.profil.{Uuid(16)}</string>
              <key>PayloadRemovalDisallowed</key><false/>
              <key>PayloadType</key><string>Configuration</string>
              <key>PayloadUUID</key><string>{Uuid(16)}</string>
              <key>PayloadVersion</key><integer>1</integer>
            </dict>
            </plist>

            """);
        return s.ToString();
    }

    /// <summary>
    /// Script PowerShell des postes (administrateur) : racine intégrée, empreinte vérifiée, magasin de l'ordinateur
    /// (toutes les sessions, serveur TSE compris).
    /// </summary>
    public static string ScriptPostes(X509Certificate2 racine, string domaine)
    {
        var empreinte = Convert.ToHexString(racine.GetCertHash(HashAlgorithmName.SHA1));
        return $$"""
            # Installer-Certificat-LogiBTP.ps1 : autorité de l'installation LogiBTP {{domaine}} dans les autorités racines de
            # confiance de l'ordinateur (toutes les sessions Windows, serveur TSE compris). À lancer en administrateur :
            #   powershell -ExecutionPolicy Bypass -File .\Installer-Certificat-LogiBTP.ps1
            # Empreinte SHA-256 attendue (à comparer avec celle affichée par l'installeur) :
            #   {{Empreinte(racine)}}
            #Requires -RunAsAdministrator
            $ErrorActionPreference = 'Stop'
            $der = [Convert]::FromBase64String('{{Convert.ToBase64String(racine.RawData)}}')
            $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($der)
            if ($cert.Thumbprint -ne '{{empreinte}}') { throw 'Empreinte inattendue : certificat altéré' }
            $magasin = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root', 'LocalMachine')
            $magasin.Open('ReadWrite')
            try { $magasin.Add($cert) } finally { $magasin.Close() }
            Write-Host "Autorité LogiBTP {{domaine}} installée (empreinte $($cert.Thumbprint)). Redémarrer le navigateur."

            """;
    }
}
