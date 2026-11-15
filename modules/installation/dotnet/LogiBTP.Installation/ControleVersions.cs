using Npgsql;

namespace LogiBTP.Installation;

/// <summary>Situation d'une base vis-à-vis des versions attendues par l'application.</summary>
public enum StatutVersionsBase
{
    /// <summary>Toutes les versions attendues sont appliquées.</summary>
    AJour,
    /// <summary>Au moins une version attendue manque : mise à jour à lancer.</summary>
    EnRetard,
    /// <summary>Journal absent ou vide (base construite à la main : développement, e2e, démonstration) : aucun contrôle possible.</summary>
    SansJournal,
}

/// <summary>Une version attendue qui manque : module, version attendue, version trouvée (null : module jamais appliqué).</summary>
public sealed record VersionManquante(string Module, VersionModule Attendue, VersionModule? Trouvee)
{
    public override string ToString() => $"{Module} {Attendue}" + (Trouvee is { } t ? $" (base en {t})" : " (absent)");
}

/// <summary>État lu d'une base ; Empreinte change à chaque écriture du journal (nombre de lignes et dernière application).</summary>
public sealed record EtatVersionsBase(StatutVersionsBase Statut, IReadOnlyList<VersionManquante> Manquantes, string Empreinte);

/// <summary>
/// Versions attendues par l'application (plan versionnement-schema, lot 6) : plus haute version de chaque module du plan
/// (manifeste <c>db/installation/scripts.txt</c>, hors démonstration et rejouables, et migrations de code), comparées à la vue
/// <c>v_version_module</c> d'une base.
/// </summary>
public sealed class VersionsAttendues(IReadOnlyDictionary<string, VersionModule> parModule)
{
    public IReadOnlyDictionary<string, VersionModule> ParModule { get; } = parModule;

    /// <summary>Versions attendues d'après les lignes du manifeste (et les migrations de code déclarées).</summary>
    public static VersionsAttendues Depuis(IEnumerable<string> lignesManifeste, IReadOnlyList<IMigrationCode>? migrations = null)
    {
        var res = new Dictionary<string, VersionModule>(StringComparer.Ordinal);
        void Retenir(string module, VersionModule v)
        {
            if (!res.TryGetValue(module, out var actuelle) || v > actuelle) res[module] = v;
        }
        foreach (var s in ManifesteScripts.Analyser(lignesManifeste).Scripts.Where(x => !x.Demo && !x.Rejouable)) Retenir(VersionsModules.ModuleDe(s.Chemin), VersionsModules.VersionDe(s.Chemin));
        foreach (var m in migrations ?? []) Retenir(m.Module, m.Version);
        return new VersionsAttendues(res);
    }

    /// <summary>Versions attendues non atteintes par les versions courantes de la base.</summary>
    public IReadOnlyList<VersionManquante> Manquantes(IReadOnlyCollection<VersionModuleBase> reelles)
    {
        var parModule = reelles.ToDictionary(r => r.Module, r => r.Version, StringComparer.Ordinal);
        return ParModule.OrderBy(p => p.Key, StringComparer.Ordinal)
            .Where(p => !parModule.TryGetValue(p.Key, out var v) || v < p.Value)
            .Select(p => new VersionManquante(p.Key, p.Value, parModule.TryGetValue(p.Key, out var t) ? t : null)).ToList();
    }

    /// <summary>Lit le journal d'une base (connexion ouverte) et compare ; ne modifie rien.</summary>
    public async Task<EtatVersionsBase> LireAsync(NpgsqlConnection cnx, CancellationToken ct = default)
    {
        await using (var existe = new NpgsqlCommand($"SELECT to_regclass('{BaseDonnees.TableJournal}') IS NOT NULL", cnx))
            if (!(bool)(await existe.ExecuteScalarAsync(ct))!) return new EtatVersionsBase(StatutVersionsBase.SansJournal, [], "");
        string empreinte;
        await using (var cmd = new NpgsqlCommand($"SELECT count(*)::text || '|' || coalesce(max(isc_applique_le)::text, '') FROM {BaseDonnees.TableJournal}", cnx))
            empreinte = (string)(await cmd.ExecuteScalarAsync(ct))!;
        if (empreinte.StartsWith("0|", StringComparison.Ordinal)) return new EtatVersionsBase(StatutVersionsBase.SansJournal, [], empreinte);
        var manquantes = Manquantes(await VersionsModules.VersionsModulesAsync(cnx, ct));
        return new EtatVersionsBase(manquantes.Count == 0 ? StatutVersionsBase.AJour : StatutVersionsBase.EnRetard, manquantes, empreinte);
    }

    public async Task<EtatVersionsBase> LireAsync(string connexion, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync(ct);
        return await LireAsync(cnx, ct);
    }
}
