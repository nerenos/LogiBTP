using System.Text;
using Npgsql;

namespace LogiBTP.Installation;

/// <summary>Contrôle de dérive d'une base : écarts, et contenu des scripts qu'une mise à jour exécuterait.</summary>
public sealed record RapportDerive(string Base, bool AInstantane, IReadOnlyList<EcartSchema> Ecarts, IReadOnlyList<string> ScriptsAExecuter)
{
    public IReadOnlyList<EcartSchema> Conflits => Ecarts.Where(e => e.EnConflit).ToList();

    /// <summary>Rapport en trois colonnes : attendu / réel / effet de la mise à jour.</summary>
    public string Formater()
    {
        var sb = new StringBuilder();
        if (!AInstantane) return $"{Base} : aucun instantané stocké (base d'avant le contrôle de dérive) : pas de contrôle préalable, instantané pris après la mise à jour";
        if (Ecarts.Count == 0) return $"{Base} : schéma conforme à l'instantané stocké";
        sb.AppendLine($"{Base} : {Ecarts.Count} écart(s) avec l'instantané stocké ({Conflits.Count} en conflit)");
        foreach (var e in Ecarts)
        {
            sb.AppendLine($"  [{(e.EnConflit ? "conflit" : "sans conflit")}] {e.Type} {e.Objet}");
            sb.AppendLine($"      attendu : {e.Attendu ?? "(absent)"}");
            sb.AppendLine($"      réel    : {e.Reel ?? "(absent)"}");
            sb.AppendLine($"      effet   : {(e.EnConflit ? DeriveSchema.Effet(e, ScriptsAExecuter) : "conservé")}");
        }
        return sb.ToString().TrimEnd();
    }
}

public static class ControleSchema
{
    /// <summary>Compare le catalogue réel au dernier instantané stocké (écarts ignorés : x_, préfixes déclarés ; dépendances ajoutées).</summary>
    public static async Task<RapportDerive> ControlerAsync(string connexion, string racine, IEnumerable<ScriptManifeste> scripts, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync(ct);
        var attendu = await JournalSchema.DernierInstantaneAsync(cnx, ct);
        if (attendu is null) return new RapportDerive(cnx.Database!, false, [], []);
        var prefixes = await JournalSchema.PrefixesAsync(cnx, ct);
        var reel = await InstantaneSchema.LireAsync(cnx, ct);
        var ecarts = DeriveSchema.Comparer(attendu, reel, prefixes).Concat(await JournalSchema.DependancesAsync(cnx, prefixes, ct)).ToList();
        var deja = (await BaseDonnees.ScriptsAppliquesAsync(connexion, ct)).Select(s => s.Chemin).ToHashSet(StringComparer.Ordinal);
        var contenus = new List<string>();
        if (ecarts.Any(e => e.EnConflit))
            foreach (var s in scripts.Where(s => s.Rejouable || !deja.Contains(s.Chemin)).DistinctBy(s => s.Chemin))
                contenus.Add(await File.ReadAllTextAsync(Path.Combine(racine, s.Chemin), ct));
        return new RapportDerive(cnx.Database!, true, ecarts, contenus);
    }

    /// <summary>Écarts d'une base (réel) avec une référence (attendu), préfixes de la base ignorés.</summary>
    public static async Task<IReadOnlyList<EcartSchema>> ComparerAsync(string connexionBase, string connexionReference, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexionBase);
        await cnx.OpenAsync(ct);
        var prefixes = await JournalSchema.PrefixesAsync(cnx, ct);
        var reel = await InstantaneSchema.LireAsync(cnx, ct);
        var reference = await InstantaneSchema.LireAsync(connexionReference, ct);
        return DeriveSchema.Comparer(reference, reel, prefixes).Concat(await JournalSchema.DependancesAsync(cnx, prefixes, ct)).ToList();
    }

    /// <summary>
    /// Construit une base de référence temporaire (« &lt;base&gt;_ref_&lt;horodatage&gt; ») par le manifeste, la compare à la base
    /// donnée, la supprime. <paramref name="connexionDe"/> : chaîne de connexion (propriétaire du schéma) d'une base du serveur.
    /// </summary>
    public static async Task<IReadOnlyList<EcartSchema>> ComparerAReferenceAsync(string connexionAdmin, string proprietaire, Func<string, string> connexionDe,
        string base_, string racine, IEnumerable<ScriptManifeste> scripts, TextWriter journal, CancellationToken ct = default)
    {
        var nom = (base_.Length > 40 ? base_[..40] : base_) + "_ref_" + DateTime.Now.ToString("yyyyMMddHHmmss");
        var bd = new BaseDonnees(journal);
        await bd.CreerBaseAsync(connexionAdmin, nom, proprietaire, ct);
        try
        {
            await bd.AppliquerAsync(connexionDe(nom), racine, scripts, ct: ct);
            return await ComparerAsync(connexionDe(base_), connexionDe(nom), ct);
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var cnx = new NpgsqlConnection(connexionAdmin);
            await cnx.OpenAsync(CancellationToken.None);
            await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS {BaseDonnees.VerifierNom(nom)} WITH (FORCE)", cnx);
            await cmd.ExecuteNonQueryAsync(CancellationToken.None);
        }
    }
}
