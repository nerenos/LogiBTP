using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json.Serialization;

namespace LogiBTP.Import.Reprise;

/// <summary>Temps cumulé d'un poste de la reprise (lecture de la source, calcul, écriture…) et nombre de passages.</summary>
public sealed record ChronoPoste(
    [property: JsonPropertyName("poste")] string Poste,
    [property: JsonPropertyName("duree_ms")] long DureeMs,
    [property: JsonPropertyName("nombre")] long Nombre);

/// <summary>
/// Chronomètres d'une exécution, par poste : où passe le temps d'une grosse reprise. Portés par le flux asynchrone de
/// l'exécution (<see cref="Courant"/>, posé par le moteur) : un domaine, un lecteur ou une aide d'écriture mesure sans
/// recevoir le contexte. Sans exécution en cours (tests, commande sans moteur), les mesures ne coûtent rien.
/// </summary>
public sealed class ChronosReprise
{
    /// <summary>Postes mesurés par le moteur lui-même ; les domaines du cœur ajoutent les leurs (codes libres).</summary>
    public const string LectureSource = "LECTURE_SOURCE";

    private static readonly AsyncLocal<ChronosReprise?> courant = new();

    private sealed class Compteur
    {
        public long Ticks;
        public long Nombre;
    }

    private readonly ConcurrentDictionary<string, Compteur> postes = new(StringComparer.Ordinal);

    /// <summary>Chronomètres de l'exécution en cours dans ce flux asynchrone (null hors exécution).</summary>
    public static ChronosReprise? Courant { get => courant.Value; internal set => courant.Value = value; }

    /// <summary>Ajoute une durée mesurée à un poste.</summary>
    public void Ajouter(string poste, long ticks, long nombre = 1)
    {
        var c = postes.GetOrAdd(poste, _ => new Compteur());
        Interlocked.Add(ref c.Ticks, ticks);
        Interlocked.Add(ref c.Nombre, nombre);
    }

    /// <summary>Mesure une opération asynchrone sur le poste (exécution courante ; sinon simple appel).</summary>
    public static async Task<T> MesurerAsync<T>(string poste, Func<Task<T>> operation)
    {
        if (Courant is not { } c) return await operation();
        var debut = Stopwatch.GetTimestamp();
        try { return await operation(); }
        finally { c.Ajouter(poste, Stopwatch.GetTimestamp() - debut); }
    }

    public static async Task MesurerAsync(string poste, Func<Task> operation) =>
        await MesurerAsync<bool>(poste, async () => { await operation(); return true; });

    /// <summary>Mesure une opération synchrone (calcul) sur le poste.</summary>
    public static T Mesurer<T>(string poste, Func<T> operation)
    {
        if (Courant is not { } c) return operation();
        var debut = Stopwatch.GetTimestamp();
        try { return operation(); }
        finally { c.Ajouter(poste, Stopwatch.GetTimestamp() - debut); }
    }

    /// <summary>Postes du plus long au plus court (instantané).</summary>
    public IReadOnlyList<ChronoPoste> Postes() => postes
        .Select(p => new ChronoPoste(p.Key, Interlocked.Read(ref p.Value.Ticks) * 1000 / Stopwatch.Frequency, Interlocked.Read(ref p.Value.Nombre)))
        .OrderByDescending(p => p.DureeMs).ThenBy(p => p.Poste, StringComparer.Ordinal).ToList();
}
