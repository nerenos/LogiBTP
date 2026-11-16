using Npgsql;

namespace LogiBTP.Import.Reprise;

/// <summary>Ligne reprise : table et clé d'origine, table et identifiant LogiBTP.</summary>
public sealed record Correspondance(string TableSource, string CleSource, string TableCible, long IdCible);

/// <summary>
/// Clés d'origine des lignes reprises : sert aux jointures pendant la reprise (un domaine retrouve l'identifiant LogiBTP
/// d'un tiers repris par un domaine précédent) puis est enregistré dans <c>import_correspondance</c>. Une même clé
/// source peut viser plusieurs lignes cibles (fusion de doublons : plusieurs clés source vers une cible).
/// </summary>
public sealed class RegistreCorrespondances
{
    private readonly Dictionary<(string Table, string Cle), Correspondance> parCle = new();
    private readonly List<Correspondance> nouvelles = [];
    private readonly Dictionary<(string Table, string Cle), string> codes = new();

    public int Nombre => parCle.Count;

    /// <summary>Inscrit une ligne reprise ; une clé déjà inscrite est refusée (faute du domaine).</summary>
    public void Inscrire(string tableSource, string cleSource, string tableCible, long idCible)
    {
        var c = new Correspondance(tableSource, cleSource.TrimEnd(), tableCible, idCible);
        if (!parCle.TryAdd((tableSource, c.CleSource), c))
            throw new InvalidOperationException($"Ligne source déjà reprise : {tableSource} {cleSource}");
        nouvelles.Add(c);
    }

    /// <summary>Identifiant LogiBTP d'une ligne source reprise, sinon null.</summary>
    public long? Trouver(string tableSource, string? cleSource) =>
        cleSource is not null && parCle.TryGetValue((tableSource, cleSource.TrimEnd()), out var c) ? c.IdCible : null;

    public IEnumerable<Correspondance> Toutes => parCle.Values;

    /// <summary>
    /// Référentiel à code texte (unité, mode de règlement, pays, civilité…) : code cible d'une valeur source, gardé en
    /// mémoire pour les domaines suivants (non enregistré : le rapport donne les correspondances appliquées).
    /// Réinscrire la même valeur remplace le code.
    /// </summary>
    public void InscrireCode(string tableSource, string cleSource, string codeCible) =>
        codes[(tableSource, cleSource.TrimEnd())] = codeCible;

    /// <summary>Code cible d'une valeur source d'un référentiel à code texte, sinon null.</summary>
    public string? TrouverCode(string tableSource, string? cleSource) =>
        cleSource is not null && codes.TryGetValue((tableSource, cleSource.TrimEnd()), out var c) ? c : null;

    /// <summary>Écrit les correspondances inscrites depuis le dernier appel dans <c>import_correspondance</c>.</summary>
    public async Task EnregistrerAsync(NpgsqlConnection connexion, NpgsqlTransaction transaction, long repriseId, CancellationToken ct)
    {
        if (nouvelles.Count == 0) return;
        await using var lot = new NpgsqlBatch(connexion, transaction);
        foreach (var c in nouvelles)
        {
            var commande = new NpgsqlBatchCommand(
                "INSERT INTO import_correspondance (imc_irp_id, imc_table_source, imc_cle_source, imc_table_cible, imc_id_cible) " +
                "VALUES ($1, $2, $3, $4, $5)");
            commande.Parameters.Add(new() { Value = repriseId });
            commande.Parameters.Add(new() { Value = c.TableSource });
            commande.Parameters.Add(new() { Value = c.CleSource });
            commande.Parameters.Add(new() { Value = c.TableCible });
            commande.Parameters.Add(new() { Value = c.IdCible });
            lot.BatchCommands.Add(commande);
        }
        await lot.ExecuteNonQueryAsync(ct);
        nouvelles.Clear();
    }
}
