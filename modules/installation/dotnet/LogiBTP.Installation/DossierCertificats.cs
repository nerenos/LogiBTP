using System.Security.Cryptography.X509Certificates;
using System.Text.Json;

namespace LogiBTP.Installation;

/// <summary>Origine du certificat du serveur (ANALYSE-MODULE-INSTALLATION.md § 5.3).</summary>
public static class OrigineCertificat
{
    /// <summary>Autorité LogiBTP créée par l'installeur (option C) : racine à installer sur les postes.</summary>
    public const string LogiBtp = "LOGIBTP";
    /// <summary>Certificat importé (autorité de l'Active Directory, prestataire : options A et D).</summary>
    public const string Importe = "IMPORTE";
    /// <summary>Let's Encrypt par défi DNS (option B).</summary>
    public const string LetsEncrypt = "LETSENCRYPT";
}

/// <summary>Description du certificat installé (certificat.json), sans aucun secret.</summary>
public sealed record InfosCertificat(string Origine, string Domaine, IReadOnlyList<string> Noms, DateTimeOffset Debut, DateTimeOffset Fin,
    string Emetteur, string? EmpreinteRacine, DateTimeOffset InstalleLe);

/// <summary>
/// Dossier des certificats de l'installation (volume logibtp-certificats, /app/certificats) : serveur.crt et
/// serveur.key (PEM, lus par Kestrel), racine.crt (autorité à diffuser sur les postes, si elle est à installer),
/// racine.key (clé de l'autorité LogiBTP, chiffrée par la clé des données), certificat.json (description).
/// </summary>
public sealed class DossierCertificats(string dossier)
{
    public string Dossier { get; } = dossier;
    public string Certificat => Path.Combine(Dossier, "serveur.crt");
    public string Cle => Path.Combine(Dossier, "serveur.key");
    public string Racine => Path.Combine(Dossier, "racine.crt");
    public string CleRacine => Path.Combine(Dossier, "racine.key");
    public string Description => Path.Combine(Dossier, "certificat.json");

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public bool Present => File.Exists(Certificat) && File.Exists(Cle);

    public InfosCertificat? Infos() => File.Exists(Description) ? JsonSerializer.Deserialize<InfosCertificat>(File.ReadAllText(Description), Json) : null;

    public X509Certificate2? LireRacine() => File.Exists(Racine) ? X509Certificate2.CreateFromPem(File.ReadAllText(Racine)) : null;

    /// <summary>
    /// Écrit le certificat du serveur (chaîne PEM : le certificat puis les intermédiaires), sa clé, la racine éventuelle
    /// et la description ; fichiers remplacés en dernier (le serveur relit serveur.crt à son changement).
    /// </summary>
    public void Ecrire(string origine, string domaine, string chainePem, string clePem, X509Certificate2? racine, DateTimeOffset maintenant)
    {
        Directory.CreateDirectory(Dossier);
        using var cert = X509Certificate2.CreateFromPem(chainePem, clePem);
        if (racine is not null) File.WriteAllText(Racine, racine.ExportCertificatePem() + "\n");
        else if (origine != OrigineCertificat.LogiBtp && File.Exists(Racine)) File.Delete(Racine);
        var infos = new InfosCertificat(origine, domaine, AutoriteCertificats.NomsDns(cert), cert.NotBefore, cert.NotAfter,
            cert.Issuer, racine is null ? null : AutoriteCertificats.Empreinte(racine), maintenant);
        File.WriteAllText(Description, JsonSerializer.Serialize(infos, Json));
        EcrireSecret(Cle, clePem);
        File.WriteAllText(Certificat + ".tmp", chainePem.Trim() + "\n");
        File.Move(Certificat + ".tmp", Certificat, true);
    }

    /// <summary>Fichier lisible du seul compte du service (0600 hors Windows).</summary>
    public static void EcrireSecret(string chemin, string contenu)
    {
        File.WriteAllText(chemin + ".tmp", contenu);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(chemin + ".tmp", UnixFileMode.UserRead | UnixFileMode.UserWrite);
        File.Move(chemin + ".tmp", chemin, true);
    }

    /// <summary>
    /// Lit un certificat fourni : PKCS#12 (.pfx, .p12, mot de passe facultatif) ou PEM (certificat, chaîne, clé à part).
    /// Renvoie la chaîne PEM (certificat du serveur d'abord, autorités ensuite), la clé PEM et la racine si elle est jointe.
    /// </summary>
    public static (string ChainePem, string ClePem, X509Certificate2? Racine) LireFourni(string fichier, string? cle, string? motDePasse)
    {
        if (fichier.EndsWith(".pfx", StringComparison.OrdinalIgnoreCase) || fichier.EndsWith(".p12", StringComparison.OrdinalIgnoreCase))
        {
            var tous = X509CertificateLoader.LoadPkcs12CollectionFromFile(fichier, motDePasse, X509KeyStorageFlags.Exportable);
            var serveur = tous.FirstOrDefault(c => c.HasPrivateKey) ?? throw new InvalidOperationException("Le fichier PKCS#12 ne contient aucune clé privée");
            var autres = tous.Where(c => c != serveur).ToList();
            var clePem = serveur.GetRSAPrivateKey()?.ExportPkcs8PrivateKeyPem() ?? serveur.GetECDsaPrivateKey()?.ExportPkcs8PrivateKeyPem()
                ?? throw new InvalidOperationException("Clé privée non prise en charge (RSA ou ECDSA)");
            var chaine = string.Join("\n", new[] { serveur }.Concat(autres.Where(c => c.Subject != c.Issuer)).Select(c => c.ExportCertificatePem()));
            return (chaine, clePem, autres.FirstOrDefault(c => c.Subject == c.Issuer));
        }
        if (cle is null) throw new ArgumentException("Certificat PEM : fichier de la clé privée obligatoire (--cle)");
        var pem = File.ReadAllText(fichier);
        var certs = new X509Certificate2Collection();
        certs.ImportFromPem(pem);
        if (certs.Count == 0) throw new InvalidOperationException("Aucun certificat dans le fichier PEM");
        var racine = certs.Cast<X509Certificate2>().FirstOrDefault(c => c.Subject == c.Issuer && certs.Count > 1);
        var chainePem = string.Join("\n", certs.Cast<X509Certificate2>().Where(c => c != racine).Select(c => c.ExportCertificatePem()));
        return (chainePem, File.ReadAllText(cle), racine);
    }
}
