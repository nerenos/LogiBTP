namespace LogiBTP.Installation;

/// <summary>Script du manifeste : chemin relatif à la racine du dépôt (séparateur /), rejoué à chaque mise à jour ou non.</summary>
public sealed record ScriptManifeste(string Chemin, bool Rejouable);

/// <summary>
/// Manifeste des scripts SQL d'une base (db/installation/scripts.txt, ANALYSE-MODULE-INSTALLATION.md § 6.3) : un chemin
/// par ligne dans l'ordre d'exécution, suivi de l'indicateur facultatif « rejouable » ; lignes vides et
/// commentaires (#) ignorés. Source unique de l'ordre pour la base de développement et l'installeur.
/// </summary>
public sealed class ManifesteScripts
{
    public const string CheminRelatif = "db/installation/scripts.txt";

    public IReadOnlyList<ScriptManifeste> Scripts { get; }

    private ManifesteScripts(IReadOnlyList<ScriptManifeste> scripts) => Scripts = scripts;

    public static ManifesteScripts Lire(string racine) => Analyser(File.ReadAllLines(Path.Combine(racine, CheminRelatif)));

    public static ManifesteScripts Analyser(IEnumerable<string> lignes)
    {
        var scripts = new List<ScriptManifeste>();
        var n = 0;
        foreach (var brute in lignes)
        {
            n++;
            var l = brute.Trim();
            if (l.Length == 0 || l.StartsWith('#')) continue;
            var mots = l.Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries);
            var inconnus = mots.Skip(1).Where(m => m is not "rejouable").ToList();
            if (inconnus.Count > 0) throw new FormatException($"Manifeste, ligne {n} : indicateur inconnu « {inconnus[0]} »");
            if (!mots[0].EndsWith(".sql", StringComparison.Ordinal) || mots[0].Contains('\\') || mots[0].Contains(".."))
                throw new FormatException($"Manifeste, ligne {n} : chemin de script invalide « {mots[0]} »");
            scripts.Add(new ScriptManifeste(mots[0], mots.Contains("rejouable")));
        }
        return new ManifesteScripts(scripts);
    }

    /// <summary>
    /// Écarts entre le manifeste et le dépôt : scripts SQL de modules/*/db et db/ absents du manifeste, chemins du
    /// manifeste introuvables. Vide : manifeste à jour.
    /// </summary>
    public IReadOnlyList<string> Ecarts(string racine)
    {
        var listes = Scripts.Select(s => s.Chemin).ToHashSet(StringComparer.Ordinal);
        var ecarts = Scripts.Where(s => !File.Exists(Path.Combine(racine, s.Chemin))).Select(s => $"introuvable : {s.Chemin}").Distinct().ToList();
        var dossiers = Directory.GetDirectories(Path.Combine(racine, "modules")).Select(d => Path.Combine(d, "db")).Append(Path.Combine(racine, "db"));
        foreach (var d in dossiers.Where(Directory.Exists))
        {
            foreach (var f in Directory.GetFiles(d, "*.sql"))
            {
                var relatif = Path.GetRelativePath(racine, f).Replace('\\', '/');
                if (!listes.Contains(relatif)) ecarts.Add($"absent du manifeste : {relatif}");
            }
        }
        return ecarts;
    }
}
