using System.Text;
using System.Text.RegularExpressions;

namespace LogiBTP.Installation;

/// <summary>Résultat d'un passage en majeure : script de création produit, scripts archivés, points à relire.</summary>
public sealed record ResultatMajeure(string Module, VersionModule Nouvelle, string Creation, IReadOnlyList<string> Sources,
    IReadOnlyList<string> Archives, IReadOnlyList<string> Avertissements);

/// <summary>
/// Passage d'un module en majeure (plan versionnement-schema, lot 9 ; analyse § 7.1), déclenché à la main pour un module :
/// <list type="number">
/// <item>produit <c>&lt;db&gt;/&lt;N+1&gt;.0_creation.sql</c>, script de création de la majeure pour les bases neuves ;</item>
/// <item>archive dans <c>&lt;db&gt;/archive/</c> les scripts de la majeure N-1 et antérieures (socle 1.0 compris quand N vaut 2 ou plus),
/// devenus inutiles : plancher de montée = N.0, jamais exécutés, gardés pour la trace ;</item>
/// <item>régénère db/installation/scripts.txt.</item>
/// </list>
/// Les mineures N.x restent en place : les bases en N.x les rejouent puis inscrivent N+1.0 sans l'exécuter.
/// <para>
/// <b>Méthode : squelette, pas fusion automatique.</b> Le script produit est la concaténation ordonnée des scripts du module qu'une base
/// neuve exécute aujourd'hui (socle non rejouable, ou création de la majeure courante, puis mineures N.x, dans l'ordre du plan). Une
/// extraction du schéma par différence d'instantanés (base construite jusqu'au module seul, puis <c>pg_dump</c> des objets ajoutés) n'est
/// pas fiable : les objets du socle 1.0 ne sont pas étiquetés par module, le cœur modifie les tables des modules par ALTER, les vues
/// des modules sont reprises par des rejouables placés plus tard dans le plan, les scripts mélangent schéma et données de référence.
/// Le squelette est donc à relire (et à alléger : colonnes ajoutées puis retirées, vues remplacées…) ; la garantie vient du contrôle
/// de publication (<c>installation publier --verifier</c>), qui compare une base neuve et une base montée : tout écart y est signalé.
/// </para>
/// </summary>
public static partial class PassageMajeure
{
    [GeneratedRegex(@"^[ \t]*--[ \t]*(requiert:|hors-transaction)", RegexOptions.Multiline)]
    private static partial Regex EnteteInterprete();

    [GeneratedRegex(@"^[a-z][a-z0-9-]*$")]
    private static partial Regex NomModule();

    [GeneratedRegex(@"^[a-z0-9_]+$")]
    private static partial Regex NomFichier();

    /// <summary>Dossier db d'un module (« coeur » : db/).</summary>
    public static string DossierDb(string racine, string module) =>
        module == VersionsModules.Coeur ? Path.Combine(racine, "db") : Path.Combine(racine, "modules", module, "db");

    private static string CheminRelatif(string racine, string fichier) => Path.GetRelativePath(racine, fichier).Replace('\\', '/');

    /// <summary>Prépare le passage du module en majeure : écrit, archive, régénère. Lève <see cref="InvalidOperationException"/> si impossible.</summary>
    public static ResultatMajeure Executer(string racine, string module, string nom = "creation")
    {
        if (!NomModule().IsMatch(module)) throw new ArgumentException($"Nom de module invalide : « {module} »");
        if (!NomFichier().IsMatch(nom)) throw new ArgumentException($"Nom de script invalide : « {nom} » (minuscules, chiffres, _)");
        var dossier = DossierDb(racine, module);
        if (!Directory.Exists(dossier)) throw new InvalidOperationException($"Module « {module} » introuvable : {CheminRelatif(racine, dossier)} n'existe pas");

        var plan = PlanScripts.Calculer(racine);
        var sources = plan.Scripts.Where(s => !s.Rejouable && !s.Demo && VersionsModules.ModuleDe(s.Chemin) == module).Select(s => s.Chemin).ToList();
        if (sources.Count == 0) throw new InvalidOperationException($"Module « {module} » : aucun script de création ni mineure dans le plan");
        if (sources.Any(MigrationsCode.EstCode)) throw new InvalidOperationException($"Module « {module} » : une migration de code ne se fusionne pas dans un script SQL");
        var courante = sources.Max(c => VersionsModules.VersionDe(c).Majeur);
        var nouvelle = new VersionModule(courante + 1, 0);
        var creation = Path.Combine(dossier, $"{nouvelle}_{nom}.sql");
        if (File.Exists(creation) || Directory.GetFiles(dossier, $"{nouvelle}_*.sql").Length > 0)
            throw new InvalidOperationException($"Module « {module} » : la version {nouvelle} existe déjà ({CheminRelatif(racine, creation)})");

        var avertissements = new List<string>();
        var corps = new StringBuilder();
        var requiert = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var chemin in sources)
        {
            var contenu = File.ReadAllText(Path.Combine(racine, chemin)).Replace("\r\n", "\n");
            var entete = EnteteMineure.Lire(chemin, contenu);
            if (entete.HorsTransaction) throw new InvalidOperationException($"{chemin} s'exécute hors transaction : il ne peut pas être fusionné dans un script de création (à reprendre à la main)");
            foreach (var r in entete.Requiert.Where(r => r.Module != module)) requiert.Add($"{r.Module} {r.Version}");
            // Les en-têtes « requiert: » des sources sont repris en commentaire inerte : seul l'en-tête du squelette fait foi.
            corps.Append($"\n-- ======== source : {chemin} ========\n");
            corps.Append(EnteteInterprete().Replace(contenu, "-- [repris] $1"));
            if (!contenu.EndsWith('\n')) corps.Append('\n');
        }
        if (requiert.Count > 0)
            avertissements.Add($"des mineures fusionnées requièrent {string.Join(", ", requiert)} : la création est placée dans le socle, avant les mineures des autres modules ; " +
                "si elle en dépend, déplacer ces instructions dans une mineure du module (« -- requiert: ») de la nouvelle majeure");
        var tete = new StringBuilder();
        tete.Append($"-- Création du module « {module} » en version {nouvelle} (passage en majeure) : SQUELETTE À RELIRE avant publication.\n");
        tete.Append("-- Exécuté seulement sur une base neuve. Une base en " + courante + ".x monte par les mineures " + courante + ".x puis inscrit ce script sans l'exécuter\n");
        tete.Append("-- (équivalence) : il doit donc produire exactement le même schéma. Contrôle : installation publier --verifier --base <développement>.\n");
        tete.Append("-- Produit par « installation module majeure " + module + " » : concaténation ordonnée des scripts ci-dessous, dans l'ordre du plan.\n");
        tete.Append("-- Une fois publié, ce script ne se modifie plus (l'empreinte du journal bloque la mise à jour).\n");
        var contenuFinal = tete.ToString() + corps;

        File.WriteAllText(creation, contenuFinal, new UTF8Encoding(false));
        var archives = Archiver(racine, module, courante, dossier);
        // scripts.txt : la création remplace le socle et les mineures des majeures précédentes.
        var manifeste = Path.Combine(racine, ManifesteScripts.CheminRelatif);
        if (Directory.Exists(Path.GetDirectoryName(manifeste)!)) ManifesteScripts.Generer(racine);
        return new ResultatMajeure(module, nouvelle, CheminRelatif(racine, creation), sources, archives, avertissements);
    }

    /// <summary>
    /// Archive les scripts du module d'une majeure antérieure à la majeure courante moins un : mineures et créations N-1.x et avant, et
    /// le socle 1.0 (non rejouable, hors démonstration) quand la majeure précédente n'est plus la 1. Déplacés dans db/archive/.
    /// </summary>
    private static List<string> Archiver(string racine, string module, int courante, string dossier)
    {
        var archives = new List<string>();
        var aArchiver = new List<string>();
        foreach (var f in Directory.GetFiles(dossier, "*.sql"))
        {
            var chemin = CheminRelatif(racine, f);
            if (VersionsModules.EstMineure(chemin) && VersionsModules.VersionDe(chemin).Majeur < courante) aArchiver.Add(chemin);
        }
        if (courante >= 2)
        {
            var socle = Path.Combine(racine, PlanScripts.CheminSocle);
            if (File.Exists(socle))
                foreach (var s in ManifesteScripts.Analyser(File.ReadAllLines(socle)).Scripts)
                    if (!s.Rejouable && !s.Demo && VersionsModules.ModuleDe(s.Chemin) == module && File.Exists(Path.Combine(racine, s.Chemin))) aArchiver.Add(s.Chemin);
        }
        if (aArchiver.Count == 0) return archives;
        var dest = Path.Combine(dossier, "archive");
        Directory.CreateDirectory(dest);
        foreach (var chemin in aArchiver.Distinct().Order(StringComparer.Ordinal))
        {
            var cible = Path.Combine(dest, Path.GetFileName(chemin));
            if (File.Exists(cible)) throw new InvalidOperationException($"{CheminRelatif(racine, cible)} existe déjà : archivage de {chemin} impossible");
            File.Move(Path.Combine(racine, chemin), cible);
            archives.Add(chemin);
        }
        return archives;
    }
}
