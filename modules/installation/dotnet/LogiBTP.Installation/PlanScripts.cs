using System.Text;
using System.Text.RegularExpressions;

namespace LogiBTP.Installation;

/// <summary>Dépendance déclarée par une mineure (« -- requiert: document 1.2 ») : module et version au moins égale.</summary>
public sealed record ExigenceModule(string Module, VersionModule Version);

/// <summary>
/// En-têtes facultatifs d'une mineure, lus dans les commentaires de tête du script : « -- requiert: document 1.2, stock 1.1 »
/// et « -- hors-transaction » (exceptionnel : script exécuté sans transaction, signalé au rapport ; une seule instruction).
/// </summary>
public sealed record EnteteMineure(IReadOnlyList<ExigenceModule> Requiert, bool HorsTransaction)
{
    public static readonly EnteteMineure Vide = new([], false);

    private static readonly Regex NomModule = new(@"^[a-z][a-z0-9-]*$");

    public static EnteteMineure Lire(string chemin, string contenu)
    {
        var requiert = new List<ExigenceModule>();
        var hors = false;
        foreach (var brute in contenu.Replace("\r\n", "\n").Split('\n'))
        {
            var l = brute.Trim();
            if (l.Length == 0) continue;
            if (!l.StartsWith("--", StringComparison.Ordinal)) break; // fin des commentaires de tête
            var texte = l[2..].Trim();
            if (texte.StartsWith("requiert:", StringComparison.Ordinal))
            {
                foreach (var item in texte["requiert:".Length..].Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                {
                    var mots = item.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (mots.Length != 2 || !NomModule.IsMatch(mots[0]) || !VersionModule.TryAnalyser(mots[1], out var v))
                        throw new FormatException($"{chemin} : « -- requiert: » attendu sous la forme « module majeur.mineur, … » (reçu « {item} »)");
                    requiert.Add(new ExigenceModule(mots[0], v));
                }
            }
            else if (texte == "hors-transaction") hors = true;
        }
        return new EnteteMineure(requiert, hors);
    }
}

/// <summary>Mineure découverte dans un dossier db : module et version déduits du chemin, en-têtes lus.</summary>
public sealed record MineureScript(string Chemin, string Module, VersionModule Version, EnteteMineure Entete);

/// <summary>Plan invalide (version en double, requiert inconnu, cycle…) : toutes les erreurs trouvées.</summary>
public sealed class PlanInvalideException(IReadOnlyList<string> erreurs)
    : InvalidOperationException("Plan des scripts invalide :\n  " + string.Join("\n  ", erreurs))
{
    public IReadOnlyList<string> Erreurs { get; } = erreurs;
}

/// <summary>
/// Plan d'exécution calculé (plan versionnement-schema, lot 4) : socle 1.0 figé (db/installation/socle-1.0.txt, dans son
/// ordre) jusqu'au repère des rejouables de fin, puis les mineures en tri topologique (ordre numérique dans un module,
/// « requiert » entre modules, à égalité module puis version, ordre binaire du nom de module), puis les rejouables de fin du
/// socle (019n, 176) : ils passent après les mineures, que leurs vues et reprises supposent appliquées.
/// </summary>
public sealed class PlanScripts
{
    public const string CheminSocle = "db/installation/socle-1.0.txt";
    public const string RepereFinSocle = "# ---- rejouables de fin du socle";

    /// <summary>Scripts dans l'ordre d'exécution (socle, mineures, rejouables de fin).</summary>
    public IReadOnlyList<ScriptManifeste> Scripts { get; }

    /// <summary>Mineures dans l'ordre calculé.</summary>
    public IReadOnlyList<MineureScript> Mineures { get; }

    private readonly List<string> _tete;
    private readonly List<string> _fin;

    private PlanScripts(IReadOnlyList<ScriptManifeste> scripts, IReadOnlyList<MineureScript> mineures, List<string> tete, List<string> fin)
    {
        Scripts = scripts;
        Mineures = mineures;
        _tete = tete;
        _fin = fin;
    }

    /// <summary>Calcule le plan du dépôt ; lève <see cref="PlanInvalideException"/> si le graphe est invalide.</summary>
    public static PlanScripts Calculer(string racine, IReadOnlyList<IMigrationCode>? migrations = null)
    {
        var lignes = File.ReadAllLines(Path.Combine(racine, CheminSocle)).ToList();
        var repere = lignes.FindIndex(l => l.StartsWith(RepereFinSocle, StringComparison.Ordinal));
        var tete = repere >= 0 ? lignes[..repere] : lignes;
        var fin = repere >= 0 ? lignes[repere..] : [];
        var socleTete = ManifesteScripts.Analyser(tete).Scripts;
        var socleFin = ManifesteScripts.Analyser(fin).Scripts;
        var erreurs = new List<string>();
        var mineures = Decouvrir(racine, erreurs);
        if (migrations is { Count: > 0 })
        {
            MigrationsCode.Verifier(migrations, erreurs);
            foreach (var m in migrations)
            {
                var chemin = MigrationsCode.Chemin(m);
                // Une mineure est un fichier SQL OU une migration de code, jamais les deux pour la même version.
                if (mineures.Any(x => x.Module == m.Module && x.Version == m.Version))
                    erreurs.Add($"{chemin} : le module {m.Module} a déjà un script SQL en version {m.Version}");
                else mineures.Add(new MineureScript(chemin, m.Module, m.Version, EnteteMineure.Vide));
            }
        }
        var modulesSocle = socleTete.Concat(socleFin).Select(s => VersionsModules.ModuleDe(s.Chemin)).ToHashSet(StringComparer.Ordinal);
        var ordonnees = Ordonner(mineures, modulesSocle, erreurs);
        if (erreurs.Count > 0) throw new PlanInvalideException(erreurs);
        var scripts = socleTete.Concat(ordonnees.Select(m => new ScriptManifeste(m.Chemin, false))).Concat(socleFin).ToList();
        while (tete.Count > 0 && string.IsNullOrWhiteSpace(tete[^1])) tete.RemoveAt(tete.Count - 1);
        return new PlanScripts(scripts, ordonnees, tete, fin);
    }

    /// <summary>Mineures du dépôt (fichiers « majeur.mineur_nom.sql » de modules/*/db et db), ordre binaire des chemins.</summary>
    private static List<MineureScript> Decouvrir(string racine, List<string> erreurs)
    {
        var res = new List<MineureScript>();
        var dossiers = new List<string>();
        var modules = Path.Combine(racine, "modules");
        if (Directory.Exists(modules)) dossiers.AddRange(Directory.GetDirectories(modules).Select(d => Path.Combine(d, "db")));
        dossiers.Add(Path.Combine(racine, "db"));
        foreach (var d in dossiers.Where(Directory.Exists))
        {
            foreach (var f in Directory.GetFiles(d, "*.sql"))
            {
                var chemin = Path.GetRelativePath(racine, f).Replace('\\', '/');
                if (!VersionsModules.EstMineure(chemin)) continue;
                var version = VersionsModules.VersionDe(chemin);
                if (version == VersionModule.Socle) { erreurs.Add($"{chemin} : la version 1.0 est celle du socle"); continue; }
                try { res.Add(new MineureScript(chemin, VersionsModules.ModuleDe(chemin), version, EnteteMineure.Lire(chemin, File.ReadAllText(f)))); }
                catch (FormatException e) { erreurs.Add(e.Message); }
            }
        }
        res.Sort((a, b) => string.CompareOrdinal(a.Chemin, b.Chemin));
        foreach (var g in res.GroupBy(m => (m.Module, m.Version)).Where(g => g.Count() > 1))
            erreurs.Add($"module {g.Key.Module} : deux mineures en version {g.Key.Version} ({string.Join(", ", g.Select(m => m.Chemin))})");
        return res;
    }

    /// <summary>Tri topologique ; à égalité (prêtes en même temps), module puis version.</summary>
    private static List<MineureScript> Ordonner(List<MineureScript> mineures, HashSet<string> modulesSocle, List<string> erreurs)
    {
        var parClef = new Dictionary<(string, VersionModule), MineureScript>();
        foreach (var m in mineures) parClef.TryAdd((m.Module, m.Version), m);
        var predecesseurs = mineures.ToDictionary(m => m, _ => new HashSet<MineureScript>());
        foreach (var m in mineures)
        {
            // Ordre numérique dans le module : chaque mineure suit la précédente du même module.
            var precedente = mineures.Where(x => x.Module == m.Module && x.Version < m.Version).OrderByDescending(x => x.Version).FirstOrDefault();
            if (precedente is not null) predecesseurs[m].Add(precedente);
            foreach (var r in m.Entete.Requiert)
            {
                var existe = modulesSocle.Contains(r.Module) || mineures.Any(x => x.Module == r.Module);
                if (!existe) { erreurs.Add($"{m.Chemin} : requiert le module « {r.Module} », qui n'existe pas"); continue; }
                if (r.Version == VersionModule.Socle && modulesSocle.Contains(r.Module)) continue;
                if (!parClef.TryGetValue((r.Module, r.Version), out var cible))
                {
                    erreurs.Add($"{m.Chemin} : requiert {r.Module} {r.Version}, version inexistante");
                    continue;
                }
                if (cible == m) { erreurs.Add($"{m.Chemin} : requiert sa propre version"); continue; }
                predecesseurs[m].Add(cible);
            }
        }
        var res = new List<MineureScript>();
        var restantes = mineures.ToList();
        while (restantes.Count > 0)
        {
            var prete = restantes.Where(m => predecesseurs[m].All(res.Contains))
                .OrderBy(m => m.Module, StringComparer.Ordinal).ThenBy(m => m.Version).FirstOrDefault();
            if (prete is null)
            {
                erreurs.Add("cycle entre mineures : " + string.Join(", ", restantes.Select(m => $"{m.Module} {m.Version}")));
                break;
            }
            res.Add(prete);
            restantes.Remove(prete);
        }
        return res;
    }

    /// <summary>Contenu du fichier généré db/installation/scripts.txt (déterministe).</summary>
    public string Contenu()
    {
        var sb = new StringBuilder();
        sb.Append("# FICHIER GÉNÉRÉ par « installation manifeste generer » (npm run manifeste) : ne pas modifier à la main.\n");
        sb.Append($"# Plan = socle 1.0 ({CheminSocle}, figé), mineures des modules (tri topologique), rejouables de fin du socle.\n");
        sb.Append("# Toute mineure ajoutée ou retirée se traduit par une régénération, contrôlée par le test du module Installation.\n\n");
        foreach (var l in _tete) sb.Append(l).Append('\n');
        if (Mineures.Any(x => !MigrationsCode.EstCode(x.Chemin)))
        {
            sb.Append("\n# Mineures : ordre calculé (versions d'un module en ordre numérique, « -- requiert: » entre modules).\n");
            foreach (var m in Mineures.Where(x => !MigrationsCode.EstCode(x.Chemin))) sb.Append(m.Chemin).Append('\n');
        }
        if (_fin.Count > 0)
        {
            sb.Append('\n');
            foreach (var l in _fin) sb.Append(l).Append('\n');
        }
        return sb.ToString();
    }
}
