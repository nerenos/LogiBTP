using System.Data;
using System.Data.Common;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

namespace LogiBTP.Import.Reprise.Lecteurs;

/// <summary>Requête refusée par un lecteur de source : seules les lectures sont admises.</summary>
public sealed class LectureRefuseeException(string message) : Exception(message);

/// <summary>
/// Lecteur ADO.NET commun aux sources (plan reprise-mde-optim, lot 2). Trois protections contre toute écriture dans la
/// base source : la requête doit être une seule lecture (<see cref="VerifierLecture"/>), chaque lecture ouvre sa propre
/// connexion (prise dans le pool : les domaines peuvent imbriquer des lectures) dans une transaction de lecture seule
/// ou annulée à la fin, et les noms de table passés à <see cref="CompterAsync"/> doivent figurer dans la base.
/// </summary>
public abstract partial class LecteurAdo(string source) : ILecteurSource
{
    private IReadOnlyList<string>? tables;

    public string Source { get; } = source;

    /// <summary>Délai d'une requête (secondes) : les grosses tables des sources se lisent en une fois, en flux.</summary>
    public int DelaiSecondes { get; init; } = 600;

    protected abstract DbConnection NouvelleConnexion();

    /// <summary>Transaction de la lecture : lecture seule quand le moteur le permet, annulée à la fin dans tous les cas.</summary>
    protected abstract Task<DbTransaction> CommencerLectureAsync(DbConnection connexion, CancellationToken ct);

    /// <summary>Requête constante des tables de la base (une colonne : le nom).</summary>
    protected abstract string RequeteTables { get; }

    /// <summary>Nom de table protégé pour la requête de comptage.</summary>
    protected abstract string Proteger(string table);

    public async Task<IReadOnlyList<string>> TablesAsync(CancellationToken ct)
    {
        if (tables is not null) return tables;
        var liste = new List<string>();
        await foreach (var l in ExecuterAsync(RequeteTables, null, ct)) liste.Add((string)l.Brut(l.Colonnes.First())!);
        liste.Sort(StringComparer.OrdinalIgnoreCase);
        return tables = liste;
    }

    public async Task<long> CompterAsync(string table, CancellationToken ct)
    {
        var nom = (await TablesAsync(ct)).FirstOrDefault(t => string.Equals(t, table, StringComparison.OrdinalIgnoreCase))
            ?? throw new LectureRefuseeException($"Table absente de la base source : {table}");
        await foreach (var l in ExecuterAsync($"SELECT COUNT(*) AS nombre FROM {Proteger(nom)}", null, ct))
            return l.Entier("nombre") ?? 0;
        return 0;
    }

    public IAsyncEnumerable<LigneSource> LireAsync(string requete, IReadOnlyDictionary<string, object?>? parametres, CancellationToken ct)
    {
        VerifierLecture(requete);
        return ExecuterAsync(requete, parametres, ct);
    }

    private async IAsyncEnumerable<LigneSource> ExecuterAsync(string requete, IReadOnlyDictionary<string, object?>? parametres,
        [EnumeratorCancellation] CancellationToken ct)
    {
        await using var connexion = NouvelleConnexion();
        await connexion.OpenAsync(ct);
        await using var transaction = await CommencerLectureAsync(connexion, ct);
        try
        {
            await using var commande = connexion.CreateCommand();
            commande.Transaction = transaction;
            commande.CommandText = requete;
            commande.CommandTimeout = DelaiSecondes;
            foreach (var (nom, valeur) in parametres ?? new Dictionary<string, object?>())
            {
                var p = commande.CreateParameter();
                p.ParameterName = nom.StartsWith('@') ? nom : "@" + nom;
                p.Value = valeur ?? DBNull.Value;
                commande.Parameters.Add(p);
            }
            await using var lecteur = await commande.ExecuteReaderAsync(CommandBehavior.SequentialAccess, ct);
            var noms = Enumerable.Range(0, lecteur.FieldCount).Select(lecteur.GetName).ToArray();
            while (await lecteur.ReadAsync(ct))
            {
                var valeurs = new Dictionary<string, object?>(noms.Length, StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < noms.Length; i++)
                {
                    var v = await lecteur.IsDBNullAsync(i, ct) ? null : lecteur.GetValue(i);
                    if (!valeurs.TryAdd(noms[i], v))
                        throw new LectureRefuseeException($"Colonne en double dans la requête : {noms[i]} (mettre un alias)");
                }
                yield return new LigneSource(valeurs);
            }
        }
        finally
        {
            // Rien n'est jamais validé sur une base source.
            await transaction.RollbackAsync(CancellationToken.None);
        }
    }

    /// <summary>
    /// Refuse toute requête qui n'est pas une seule lecture : elle commence par SELECT ou WITH, ne contient ni point-virgule
    /// ni mot d'écriture (INTO, INSERT, UPDATE, DELETE, MERGE, EXEC…), commentaires et chaînes compris.
    /// </summary>
    public static void VerifierLecture(string requete)
    {
        if (string.IsNullOrWhiteSpace(requete)) throw new LectureRefuseeException("Requête vide");
        if (!Debut().IsMatch(requete)) throw new LectureRefuseeException("Seules les requêtes SELECT ou WITH sont admises");
        if (requete.Contains(';')) throw new LectureRefuseeException("Une seule instruction par requête (point-virgule refusé)");
        if (MotEcriture().Match(requete) is { Success: true } m)
            throw new LectureRefuseeException($"Mot réservé à l'écriture refusé dans une lecture : {m.Value.ToUpperInvariant()}");
    }

    [GeneratedRegex(@"^\s*(SELECT|WITH)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Debut();

    [GeneratedRegex(@"\b(INTO|INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE\s+INTO|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|EXEC|EXECUTE|CALL|DECLARE|LOCK|HANDLER|LOAD|OUTFILE|DUMPFILE|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK|SHUTDOWN|KILL|DBCC|BACKUP|RESTORE)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex MotEcriture();

    public ValueTask DisposeAsync()
    {
        GC.SuppressFinalize(this);
        return ValueTask.CompletedTask;
    }
}
