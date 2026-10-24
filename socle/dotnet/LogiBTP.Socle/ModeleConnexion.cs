using System.Data.Common;

namespace LogiBTP.Socle;

/// <summary>
/// Serveur PostgreSQL de l'installation (ANALYSE-MODULE-INSTALLATION.md § 6.4) : hôte, port et TLS une fois, la base
/// de chaque société déduite de son code (préfixe + « _ » + code ; la base principale porte le préfixe seul).
/// Variables du .env : LOGIBTP_BASE_HOTE, LOGIBTP_BASE_PORT, LOGIBTP_BASE_PREFIXE, LOGIBTP_BASE_SSL (Disable, Require,
/// VerifyFull), LOGIBTP_BASE_RACINE (certificat de l'autorité, VerifyFull).
/// </summary>
public sealed record ModeleConnexion(string Hote, int Port = 5432, string Prefixe = "logibtp", string? Ssl = null, string? Racine = null)
{
    /// <summary>Lit le modèle (null sans LOGIBTP_BASE_HOTE).</summary>
    public static ModeleConnexion? Lire(Func<string, string?> valeur)
    {
        var hote = valeur("LOGIBTP_BASE_HOTE");
        if (string.IsNullOrWhiteSpace(hote)) return null;
        var port = int.TryParse(valeur("LOGIBTP_BASE_PORT"), out var p) ? p : 5432;
        var prefixe = valeur("LOGIBTP_BASE_PREFIXE");
        return new ModeleConnexion(hote.Trim(), port, string.IsNullOrWhiteSpace(prefixe) ? "logibtp" : prefixe.Trim(),
            string.IsNullOrWhiteSpace(valeur("LOGIBTP_BASE_SSL")) ? null : valeur("LOGIBTP_BASE_SSL")!.Trim(),
            string.IsNullOrWhiteSpace(valeur("LOGIBTP_BASE_RACINE")) ? null : valeur("LOGIBTP_BASE_RACINE")!.Trim());
    }

    /// <summary>Base d'une société (null : base principale) ; le tiret du sous-domaine devient « _ ».</summary>
    public string NomBase(string? societe) => string.IsNullOrEmpty(societe) ? Prefixe : $"{Prefixe}_{societe.ToLowerInvariant().Replace('-', '_')}";

    /// <summary>Chaîne de connexion Npgsql à une base, pour un rôle.</summary>
    public string Chaine(string baseDonnees, string utilisateur, string? motDePasse)
    {
        var c = new DbConnectionStringBuilder
        {
            ["Host"] = Hote, ["Port"] = Port, ["Database"] = baseDonnees, ["Username"] = utilisateur,
            // Aucun chiffrement GSS (Kerberos) : bibliothèque absente des images, essai inutile à chaque connexion.
            ["GSS Encryption Mode"] = "Disable",
        };
        if (!string.IsNullOrEmpty(motDePasse)) c["Password"] = motDePasse;
        if (Ssl is not null) c["SSL Mode"] = Ssl;
        if (Racine is not null) c["Root Certificate"] = Racine;
        return c.ConnectionString;
    }
}
