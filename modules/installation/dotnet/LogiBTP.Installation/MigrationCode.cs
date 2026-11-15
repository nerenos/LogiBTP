using Npgsql;

namespace LogiBTP.Installation;

/// <summary>
/// Migration de code figée (plan versionnement-schema, lot 5) : reprise de données impossible en SQL, déclarée par le cœur
/// (liste passée à l'installeur, comme le manifeste). Elle occupe la place d'une mineure de son module (« majeur.mineur » :
/// jamais en même temps qu'un fichier SQL de même version), s'exécute dans la transaction de cette mineure et s'inscrit
/// au journal (type « mineure », chemin « code:&lt;module&gt;/&lt;version&gt;_&lt;nom&gt; »).
/// Règle « figée » (documentation/MIGRATIONS.md) : le code ne dépend ni des entités, ni des services, ni des règles courantes
/// de l'application, seulement de SQL et de la connexion reçue ; il ne change plus une fois publié.
/// </summary>
public interface IMigrationCode
{
    /// <summary>Module concerné (nom de dossier sous modules/, ou « coeur »).</summary>
    string Module { get; }

    /// <summary>Version mineure apportée (au-delà de 1.0).</summary>
    VersionModule Version { get; }

    /// <summary>Nom court (lettres minuscules, chiffres, tirets, soulignés), partie du chemin au journal.</summary>
    string Nom { get; }

    /// <summary>Empreinte déclarée, stable d'une version de l'application à l'autre ; null : nom complet du type + version de l'assembly.</summary>
    string? EmpreinteDeclaree => null;

    /// <summary>Exécution dans la transaction de la mineure (ne jamais valider ni annuler soi-même).</summary>
    Task ExecuterAsync(NpgsqlConnection cnx, NpgsqlTransaction tx, CancellationToken ct);
}

/// <summary>Chemin et empreinte au journal des migrations de code.</summary>
public static class MigrationsCode
{
    public const string Prefixe = "code:";

    public static bool EstCode(string chemin) => chemin.StartsWith(Prefixe, StringComparison.Ordinal);

    public static string Chemin(IMigrationCode m) => $"{Prefixe}{m.Module}/{m.Version}_{m.Nom}";

    /// <summary>Empreinte inscrite : déclarée, sinon nom complet du type et version de son assembly (sert à la trace, jamais à la détection de modification).</summary>
    public static string Empreinte(IMigrationCode m) =>
        m.EmpreinteDeclaree ?? $"{m.GetType().FullName}@{m.GetType().Assembly.GetName().Version}";

    /// <summary>Vérifie les migrations : module et nom valides, pas de doublon de (module, version).</summary>
    public static void Verifier(IReadOnlyList<IMigrationCode> migrations, List<string> erreurs)
    {
        foreach (var m in migrations)
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(m.Module, "^[a-z][a-z0-9-]*$")) erreurs.Add($"{m.GetType().Name} : module « {m.Module} » invalide");
            if (!System.Text.RegularExpressions.Regex.IsMatch(m.Nom, "^[a-z0-9][a-z0-9_-]*$")) erreurs.Add($"{m.GetType().Name} : nom « {m.Nom} » invalide");
            if (m.Version == VersionModule.Socle) erreurs.Add($"{Chemin(m)} : la version 1.0 est celle du socle");
        }
        foreach (var g in migrations.GroupBy(m => (m.Module, m.Version)).Where(g => g.Count() > 1))
            erreurs.Add($"module {g.Key.Module} : deux migrations de code en version {g.Key.Version}");
    }
}
