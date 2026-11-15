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
/// <paramref name="Equivalence"/> : création d'une majeure placée dans le plan d'une base existante (inscrite sans exécution).
public sealed record MineureScript(string Chemin, string Module, VersionModule Version, EnteteMineure Entete, bool Equivalence = false)
{
    /// <summary>Script de création d'une majeure (« N.0_nom.sql », N au moins 2), pas une mineure.</summary>
    public bool EstMajeure => VersionsModules.EstMajeure(Chemin);
}

/// <summary>
/// Base trop ancienne pour le plan : un module est passé en majeure depuis, et la version de la base est antérieure au plancher
/// (début de la majeure précédente). Refus avant toute application.
/// </summary>
public sealed class BaseTropAncienneException(string module, VersionModule version, VersionModule plancher, VersionModule courante)
    : InvalidOperationException($"Le module « {module} » de la base est en version {version} : trop ancienne pour cette version du produit " +
        $"(le module est en {courante}, la montée n'est prise en charge qu'à partir de {plancher}). " +
        $"Passer d'abord par une version publiée intermédiaire qui prend encore en charge {version} (module « {module} » en {plancher} au plus), " +
        "mettre la base à jour avec elle, puis avec cette version.")
{
    public string Module { get; } = module;
    public VersionModule Version { get; } = version;
    public VersionModule Plancher { get; } = plancher;
}

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

    /// <summary>
    /// Plan d'une base neuve (celui de scripts.txt) : un module passé en majeure y figure par son script de création le plus récent
    /// (à la place de son socle et de ses mineures des majeures précédentes) ; lève <see cref="PlanInvalideException"/> si le graphe
    /// est invalide.
    /// </summary>
    public static PlanScripts Calculer(string racine, IReadOnlyList<IMigrationCode>? migrations = null) => CalculerPour(racine, null, migrations);

    /// <summary>
    /// Plan d'une base dont les versions par module sont connues (<paramref name="versionsBase"/> ; null ou module absent : module neuf).
    /// Un module passé en majeure N : version de la base au moins N (création déjà appliquée) = plan neuf ; entre le plancher (N-1.0) et N
    /// exclu : les mineures de la majeure précédente manquantes, puis la création N.0 inscrite sans exécution (équivalence), puis les mineures
    /// N.x ; avant le plancher : <see cref="BaseTropAncienneException"/>.
    /// </summary>
    public static PlanScripts CalculerPour(string racine, IReadOnlyDictionary<string, VersionModule>? versionsBase, IReadOnlyList<IMigrationCode>? migrations = null)
    {
        var lignes = File.ReadAllLines(Path.Combine(racine, CheminSocle)).ToList();
        var repere = lignes.FindIndex(l => l.StartsWith(RepereFinSocle, StringComparison.Ordinal));
        var teteBrute = repere >= 0 ? lignes[..repere] : lignes;
        var fin = repere >= 0 ? lignes[repere..] : [];
        var socleTeteBrut = ManifesteScripts.Analyser(teteBrute).Scripts;
        var socleFin = ManifesteScripts.Analyser(fin).Scripts;
        var erreurs = new List<string>();
        var toutes = Decouvrir(racine, erreurs);
        if (migrations is { Count: > 0 })
        {
            MigrationsCode.Verifier(migrations, erreurs);
            foreach (var m in migrations)
            {
                var chemin = MigrationsCode.Chemin(m);
                // Une mineure est un fichier SQL OU une migration de code, jamais les deux pour la même version.
                if (toutes.Any(x => x.Module == m.Module && x.Version == m.Version))
                    erreurs.Add($"{chemin} : le module {m.Module} a déjà un script SQL en version {m.Version}");
                else toutes.Add(new MineureScript(chemin, m.Module, m.Version, EnteteMineure.Vide));
            }
        }
        var modulesSocle = socleTeteBrut.Concat(socleFin).Select(s => VersionsModules.ModuleDe(s.Chemin)).ToHashSet(StringComparer.Ordinal);

        // Modules passés en majeure : création la plus récente, plancher, mode (base neuve / équivalence).
        var courantes = toutes.Where(m => m.EstMajeure).GroupBy(m => m.Module).ToDictionary(g => g.Key, g => g.MaxBy(m => m.Version)!, StringComparer.Ordinal);
        var equivalence = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (module, c) in courantes)
        {
            var plancher = new VersionModule(c.Version.Majeur - 1, 0);
            if (versionsBase is null || !versionsBase.TryGetValue(module, out var v)) continue;
            if (v < plancher) throw new BaseTropAncienneException(module, v, plancher, c.Version);
            if (v < c.Version) equivalence.Add(module);
        }

        // Mineures actives dans ce plan.
        var actives = new List<MineureScript>();
        foreach (var m in toutes)
        {
            if (!courantes.TryGetValue(m.Module, out var c)) { actives.Add(m); continue; }
            if (m.EstMajeure)
            {
                if (m == c && equivalence.Contains(m.Module)) actives.Add(m with { Entete = EnteteMineure.Vide, Equivalence = true });
                continue; // sinon : en tête du plan (création), ou ancienne création (gardée pour la trace, jamais jouée)
            }
            if (m.Version > c.Version || (m.Version < c.Version && equivalence.Contains(m.Module) && m.Version > new VersionModule(c.Version.Majeur - 1, 0))) actives.Add(m);
        }

        // Socle : un module passé en majeure perd ses scripts non rejouables (hors démonstration) au profit de sa création ; une base en
        // équivalence les garde quand le socle 1.0 fait partie de sa majeure précédente (le plancher est alors 1.0), sinon ils sont archivés.
        var tete = new List<string>();
        var socleTete = new List<ScriptManifeste>();
        var inseres = new HashSet<string>(StringComparer.Ordinal);
        var k = 0;
        foreach (var ligne in teteBrute)
        {
            var l = ligne.Trim();
            if (l.Length == 0 || l.StartsWith('#')) { tete.Add(ligne); continue; }
            var s = socleTeteBrut[k++];
            var module = VersionsModules.ModuleDe(s.Chemin);
            if (!courantes.TryGetValue(module, out var c) || s.Rejouable || s.Demo) { tete.Add(ligne); socleTete.Add(s); continue; }
            if (equivalence.Contains(module))
            {
                if (c.Version.Majeur - 1 < 2) { tete.Add(ligne); socleTete.Add(s); }
                continue;
            }
            if (inseres.Add(module)) { tete.Add(c.Chemin); socleTete.Add(new ScriptManifeste(c.Chemin, false)); }
        }
        foreach (var (module, c) in courantes.OrderBy(x => x.Key, StringComparer.Ordinal))
            if (!equivalence.Contains(module) && inseres.Add(module)) { tete.Add(c.Chemin); socleTete.Add(new ScriptManifeste(c.Chemin, false)); }

        var ordonnees = Ordonner(actives, toutes, courantes, modulesSocle, erreurs);
        if (erreurs.Count > 0) throw new PlanInvalideException(erreurs);
        var scripts = socleTete.Concat(ordonnees.Select(m => new ScriptManifeste(m.Chemin, false, SansExecution: m.Equivalence))).Concat(socleFin).ToList();
        while (tete.Count > 0 && string.IsNullOrWhiteSpace(tete[^1])) tete.RemoveAt(tete.Count - 1);
        return new PlanScripts(scripts, ordonnees, tete, fin);
    }

    /// <summary>Vrai si la liste porte au moins un script de création de majeure (« N.0_nom.sql », N au moins 2).</summary>
    public static bool ContientMajeure(IEnumerable<ScriptManifeste> scripts) => scripts.Any(s => VersionsModules.EstMajeure(s.Chemin));

    /// <summary>
    /// Chemins couverts par le plan sans figurer forcément dans scripts.txt : socle 1.0 figé, mineures et créations de majeure du
    /// dépôt (gardées pour les bases qui montent par les mineures). Jamais ceux de db/archive/.
    /// </summary>
    public static HashSet<string> CheminsConnus(string racine)
    {
        var res = new HashSet<string>(StringComparer.Ordinal);
        var f = Path.Combine(racine, CheminSocle);
        if (File.Exists(f)) foreach (var s in ManifesteScripts.Analyser(File.ReadAllLines(f)).Scripts) res.Add(s.Chemin);
        foreach (var m in Decouvrir(racine, [])) res.Add(m.Chemin);
        return res;
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

    /// <summary>
    /// Tri topologique ; à égalité (prêtes en même temps), module puis version. <paramref name="toutes"/> : tout ce qui existe
    /// (validation des « requiert ») ; une cible hors du plan (socle, création en tête, version remplacée par une création) est satisfaite.
    /// </summary>
    private static List<MineureScript> Ordonner(List<MineureScript> mineures, List<MineureScript> toutes, Dictionary<string, MineureScript> courantes,
        HashSet<string> modulesSocle, List<string> erreurs)
    {
        var parClef = new Dictionary<(string, VersionModule), MineureScript>();
        foreach (var m in mineures) parClef.TryAdd((m.Module, m.Version), m);
        var existantes = toutes.Select(m => (m.Module, m.Version)).ToHashSet();
        var predecesseurs = mineures.ToDictionary(m => m, _ => new HashSet<MineureScript>());
        foreach (var m in mineures)
        {
            // Ordre numérique dans le module : chaque mineure suit la précédente du même module.
            var precedente = mineures.Where(x => x.Module == m.Module && x.Version < m.Version).OrderByDescending(x => x.Version).FirstOrDefault();
            if (precedente is not null) predecesseurs[m].Add(precedente);
            foreach (var r in m.Entete.Requiert)
            {
                var existe = modulesSocle.Contains(r.Module) || toutes.Any(x => x.Module == r.Module);
                if (!existe) { erreurs.Add($"{m.Chemin} : requiert le module « {r.Module} », qui n'existe pas"); continue; }
                if (r.Version == VersionModule.Socle && modulesSocle.Contains(r.Module)) continue;
                if (!parClef.TryGetValue((r.Module, r.Version), out var cible))
                {
                    // Version remplacée par une création de majeure (archivée ou gardée hors plan) : satisfaite par la création.
                    if (courantes.TryGetValue(r.Module, out var creation) && r.Version <= creation.Version) continue;
                    if (!existantes.Contains((r.Module, r.Version))) erreurs.Add($"{m.Chemin} : requiert {r.Module} {r.Version}, version inexistante");
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
