using System.Globalization;
using System.Net;
using System.Text;

namespace LogiBTP.Installation;

/// <summary>
/// Réglages du serveur PostgreSQL de l'installation (conteneur de la base, ANALYSE-MODULE-INSTALLATION.md § 3.2) :
/// réseau Docker commun avec l'API, adresses du serveur de l'API quand la base est sur une autre machine (TLS),
/// mémoire dédiée, fuseau.
/// </summary>
public sealed class ReglagesPostgres
{
    /// <summary>Sous-réseau du réseau Docker « logibtp » (CIDR) : API et base sur le même hôte.</summary>
    public string Reseau { get; init; } = "172.30.70.0/24";
    /// <summary>Base sur une autre machine : adresses (ou CIDR) du serveur de l'API, connexion en TLS seulement.</summary>
    public IReadOnlyList<string> AdressesApi { get; init; } = [];
    /// <summary>TLS du serveur (certificat de la base émis par l'autorité de l'installation) ; obligatoire avec AdressesApi.</summary>
    public bool Ssl { get; init; }
    /// <summary>Mémoire dédiée à PostgreSQL (Mo) : règle shared_buffers, effective_cache_size, work_mem.</summary>
    public int MemoireMo { get; init; } = 2048;
    public string Fuseau { get; init; } = "Europe/Paris";
    /// <summary>Dossier des fichiers de configuration dans le conteneur de la base.</summary>
    public string Dossier { get; init; } = "/etc/logibtp";
    /// <summary>Clé TLS recopiée par le conteneur dans un dossier à lui (PostgreSQL exige une clé du compte postgres en 0600).</summary>
    public string CleSsl { get; init; } = "/var/lib/postgresql/ssl/base.key";

    /// <summary>Rôles de connexion : superutilisateur (installeur) puis schéma, application, lecture (db/installation/roles.sql).</summary>
    public static readonly string[] Roles = ["postgres", "logibtp_schema", "logibtp_app", "logibtp_lecture"];

    public void Verifier()
    {
        if (!Cidr(Reseau)) throw new ArgumentException($"Réseau Docker invalide : {Reseau}");
        foreach (var a in AdressesApi) if (!Cidr(a) && !IPAddress.TryParse(a, out _)) throw new ArgumentException($"Adresse du serveur de l'API invalide : {a}");
        if (AdressesApi.Count > 0 && !Ssl) throw new ArgumentException("Base sur une autre machine : TLS obligatoire");
        if (MemoireMo < 256) throw new ArgumentException("Mémoire de PostgreSQL : 256 Mo au moins");
    }

    private static bool Cidr(string v) => v.Contains('/') && IPNetwork.TryParse(v, out _);
}

/// <summary>Fichiers pg_hba.conf et postgresql.conf générés par l'installeur (montés en lecture seule dans le conteneur de la base).</summary>
public static class ConfigurationPostgres
{
    public static string PgHba(ReglagesPostgres r)
    {
        r.Verifier();
        var roles = string.Join(',', ReglagesPostgres.Roles);
        var appli = string.Join(',', ReglagesPostgres.Roles.Skip(1));
        var s = new StringBuilder();
        s.AppendLine("# pg_hba.conf de l'installation LogiBTP : généré par « installation preparer », ne pas modifier à la main.");
        s.AppendLine("# TYPE   BASE  UTILISATEUR  ADRESSE  MÉTHODE");
        s.AppendLine("# Superutilisateur par le socket du conteneur (docker exec -u postgres : sauvegardes, dépannage).");
        s.AppendLine("local    all   postgres     peer");
        s.AppendLine("# Réseau Docker « logibtp » : API et commandes de l'installeur sur le même hôte.");
        s.AppendLine($"host     all   {roles}  {r.Reseau}  scram-sha-256");
        if (r.AdressesApi.Count > 0)
        {
            s.AppendLine("# Serveur de l'API sur une autre machine : TLS seulement, rôles de l'application.");
            foreach (var a in r.AdressesApi) s.AppendLine($"hostssl  all   {appli}  {(a.Contains('/') ? a : a + (a.Contains(':') ? "/128" : "/32"))}  scram-sha-256");
        }
        s.AppendLine("# Tout le reste est refusé.");
        s.AppendLine("host     all   all          0.0.0.0/0  reject");
        s.AppendLine("host     all   all          ::/0       reject");
        return s.ToString();
    }

    public static string PostgresqlConf(ReglagesPostgres r)
    {
        r.Verifier();
        var m = r.MemoireMo;
        string Mo(int v) => v.ToString(CultureInfo.InvariantCulture) + "MB";
        var s = new StringBuilder();
        s.AppendLine("# postgresql.conf de l'installation LogiBTP : généré par « installation preparer », ne pas modifier à la main.");
        s.AppendLine($"# Mémoire dédiée : {m} Mo.");
        s.AppendLine("listen_addresses = '*'");
        s.AppendLine("port = 5432");
        s.AppendLine($"hba_file = '{r.Dossier}/pg_hba.conf'");
        s.AppendLine("password_encryption = scram-sha-256");
        s.AppendLine("max_connections = 100");
        s.AppendLine($"shared_buffers = {Mo(m / 4)}");
        s.AppendLine($"effective_cache_size = {Mo(m * 3 / 4)}");
        s.AppendLine($"work_mem = {Mo(Math.Clamp(m / 128, 4, 64))}");
        s.AppendLine($"maintenance_work_mem = {Mo(Math.Clamp(m / 16, 64, 1024))}");
        s.AppendLine($"timezone = '{r.Fuseau}'");
        s.AppendLine($"log_timezone = '{r.Fuseau}'");
        s.AppendLine("datestyle = 'iso, dmy'");
        s.AppendLine("log_min_duration_statement = 5000");
        if (r.Ssl)
        {
            s.AppendLine("ssl = on");
            s.AppendLine($"ssl_cert_file = '{r.Dossier}/base.crt'");
            s.AppendLine($"ssl_key_file = '{r.CleSsl}'");
            s.AppendLine("ssl_min_protocol_version = 'TLSv1.2'");
        }
        else s.AppendLine("ssl = off");
        return s.ToString();
    }
}
