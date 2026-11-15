namespace LogiBTP.Installation;

/// <summary>
/// Script du manifeste : chemin relatif à la racine du dépôt (séparateur /), rejoué à chaque mise à jour ou non.
/// <paramref name="ExRejouable"/> : ancien rejouable devenu non rejouable (jamais inscrit au journal) : sur une base déjà
/// installée (journal non vide), il est inscrit sans être exécuté ; sur une base neuve, il est appliqué.
/// <paramref name="Demo"/> : script de données de démonstration, appliqué seulement si l'application est demandée avec la
/// démonstration (combinable avec <paramref name="Rejouable"/>).
/// <paramref name="ExtraitDe"/> : script extrait d'un script déjà publié (chemin de celui-ci) : sur une base dont le journal
/// porte l'ancienne empreinte acceptée de ce script (<see cref="EmpreintesAcceptees"/>), son contenu est déjà appliqué, il
/// est inscrit sans être exécuté ; sur une base neuve, il est appliqué.
/// </summary>
public sealed record ScriptManifeste(string Chemin, bool Rejouable, bool ExRejouable = false, bool Demo = false, string? ExtraitDe = null);

/// <summary>
/// Manifeste des scripts SQL d'une base (db/installation/scripts.txt, ANALYSE-MODULE-INSTALLATION.md § 6.3) : un chemin
/// par ligne dans l'ordre d'exécution, suivi d'indicateurs facultatifs (rejouable, ex-rejouable, demo,
/// extrait-de=CHEMIN) ; lignes vides et commentaires (#) ignorés. Source unique de l'ordre pour la base de développement et l'installeur.
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
            var inconnus = mots.Skip(1).Where(m => m is not ("rejouable" or "ex-rejouable" or "demo") && !m.StartsWith(PrefixeExtraitDe, StringComparison.Ordinal)).ToList();
            if (inconnus.Count > 0) throw new FormatException($"Manifeste, ligne {n} : indicateur inconnu « {inconnus[0]} »");
            if (!mots[0].EndsWith(".sql", StringComparison.Ordinal) || mots[0].Contains('\\') || mots[0].Contains(".."))
                throw new FormatException($"Manifeste, ligne {n} : chemin de script invalide « {mots[0]} »");
            if (mots.Contains("rejouable") && mots.Contains("ex-rejouable")) throw new FormatException($"Manifeste, ligne {n} : « rejouable » et « ex-rejouable » s'excluent");
            var extraits = mots.Skip(1).Where(m => m.StartsWith(PrefixeExtraitDe, StringComparison.Ordinal)).Select(m => m[PrefixeExtraitDe.Length..]).ToList();
            if (extraits.Count > 1) throw new FormatException($"Manifeste, ligne {n} : un seul « {PrefixeExtraitDe}… » par script");
            if (extraits.Count == 1 && (!extraits[0].EndsWith(".sql", StringComparison.Ordinal) || extraits[0].Contains('\\') || extraits[0].Contains("..")))
                throw new FormatException($"Manifeste, ligne {n} : chemin « {PrefixeExtraitDe}… » invalide « {extraits[0]} »");
            scripts.Add(new ScriptManifeste(mots[0], mots.Contains("rejouable"), mots.Contains("ex-rejouable"), mots.Contains("demo"), extraits.Count == 1 ? extraits[0] : null));
        }
        var chemins = scripts.Select(x => x.Chemin).ToHashSet(StringComparer.Ordinal);
        var orphelin = scripts.FirstOrDefault(x => x.ExtraitDe is not null && !chemins.Contains(x.ExtraitDe));
        if (orphelin is not null) throw new FormatException($"Manifeste : {orphelin.Chemin} est extrait de {orphelin.ExtraitDe}, absent du manifeste");
        return new ManifesteScripts(scripts);
    }

    /// <summary>
    /// Génère db/installation/scripts.txt depuis le plan calculé (<see cref="PlanScripts"/>) : socle 1.0 figé, mineures,
    /// rejouables de fin. Renvoie le chemin écrit.
    /// </summary>
    public static string Generer(string racine)
    {
        var f = Path.Combine(racine, CheminRelatif);
        File.WriteAllText(f, PlanScripts.Calculer(racine).Contenu(), new System.Text.UTF8Encoding(false));
        return f;
    }

    /// <summary>Vrai si le fichier scripts.txt du dépôt est identique à celui que le plan génère.</summary>
    public static bool EstAJour(string racine)
    {
        var f = Path.Combine(racine, CheminRelatif);
        return File.Exists(f) && File.ReadAllText(f).Replace("\r\n", "\n") == PlanScripts.Calculer(racine).Contenu();
    }

    /// <summary>
    /// Manifeste avec les migrations de code du cœur placées dans le plan (comme des mineures de leur module) ; sans migration,
    /// le manifeste du dépôt tel quel.
    /// </summary>
    public ManifesteScripts AvecMigrations(string racine, IReadOnlyList<IMigrationCode>? migrations) =>
        migrations is { Count: > 0 } ? new ManifesteScripts(PlanScripts.Calculer(racine, migrations).Scripts) : this;

    public const string PrefixeExtraitDe = "extrait-de=";

    /// <summary>Scripts à appliquer à une base : tous, ou seulement ceux qui ne sont pas de démonstration.</summary>
    public IReadOnlyList<ScriptManifeste> Retenus(bool demo) => demo ? Scripts : Scripts.Where(s => !s.Demo).ToList();

    /// <summary>
    /// Écarts entre le manifeste et le dépôt : scripts SQL de modules/*/db et db/ absents du manifeste, chemins du
    /// manifeste introuvables. Vide : manifeste à jour.
    /// </summary>
    public IReadOnlyList<string> Ecarts(string racine)
    {
        var listes = Scripts.Select(s => s.Chemin).ToHashSet(StringComparer.Ordinal);
        var ecarts = Scripts.Where(s => !MigrationsCode.EstCode(s.Chemin) && !File.Exists(Path.Combine(racine, s.Chemin))).Select(s => $"introuvable : {s.Chemin}").Distinct().ToList();
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
