using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Métrés MDE (PMEMETRE, PMEMETRELIGNE, PMEMETREVAR) traduits en scripts LogiBTP : chaque ligne de formule (TYPE F)
/// est totalisée (Totalisation de MDE : somme des résultats des lignes de niveau de total non nul) ; « NOM=expr »
/// (ou la variable de résultat de la ligne) devient une variable locale du script, elle aussi totalisée ; les
/// affectations du métré de la ligne récapitulative (TYPELIG R, non reprise) et les variables globales de PMEMETREVAR
/// forment le métré du document (variables $$NOM, plan metres-tranches-document, lot 7), lues par les formules des
/// lignes quelle que soit leur casse. Le métré d'une tranche (T) devient un métré de tranche (quantité de la tranche).
/// Données de la ligne citées entre crochets ([POIDS], [LONGUEUR]…) : colonnes techniques de la ligne ({{lig_poids}}…,
/// <see cref="DonneesLigne"/>) ; un nom inconnu reste tel quel et est signalé.
/// Autres types de ligne : commentaires (signalés).
/// </summary>
public sealed partial class MetresMde
{
    /// <summary>Ligne de métré MDE.</summary>
    public sealed record Ligne(int Ordre, string Type, string? Libelle, int NiveauTotal, string? Variable);

    /// <summary>Variable d'un métré MDE (PMEMETREVAR) : globale au document ou propre au métré.</summary>
    public sealed record Variable(string Nom, decimal Valeur, bool Globale);

    /// <summary>Métré MDE.</summary>
    public sealed record Metre(string Cle, string? Libelle, List<Ligne> Lignes, List<Variable> Variables);

    public const string TypeFormule = "F";
    public const string NomTotal = "Total";

    private readonly Dictionary<string, Metre> parCle;

    public MetresMde(IEnumerable<Metre> metres) => parCle = metres.ToDictionary(m => m.Cle, StringComparer.Ordinal);

    public Metre? Trouver(string? cle) => cle is { } c && parCle.TryGetValue(c, out var m) ? m : null;

    /// <summary>Métrés cités par les lignes des pièces de vente et des marchés (requêtes constantes).</summary>
    public static async Task<MetresMde> ChargerAsync(ContexteReprise ctx, CancellationToken ct)
    {
        const string Cites = """
            SELECT CLEMETRE FROM PMEDOCDEVCLILIG WHERE CLEMETRE IS NOT NULL
            UNION SELECT CLEMETRE FROM PMEDOCCDECLILIG WHERE CLEMETRE IS NOT NULL
            UNION SELECT CLEMETRE FROM PMEDOCBLCLILIG WHERE CLEMETRE IS NOT NULL
            UNION SELECT CLEMETRE FROM PMEDOCFACCLILIG WHERE CLEMETRE IS NOT NULL
            UNION SELECT CLEMETRE FROM PMEAFFBASEDOCLIG WHERE CLEMETRE IS NOT NULL
            """;
        var lignes = (await SqlReprise.SourceAsync(ctx,
                "SELECT L.CLEMETRE, L.NUMORDRE, L.TYPE, L.LIBELLE, L.NIVTOT, L.VARRESULT FROM PMEMETRELIGNE L WHERE L.CLEMETRE IN (" + Cites + ") ORDER BY L.CLEMETRE, L.NUMORDRE, L.CLE", ct))
            .GroupBy(l => l.Texte("CLEMETRE") ?? "").ToDictionary(g => g.Key, g => g.Select(l => new Ligne(
                (int)(l.Entier("NUMORDRE") ?? 0), (l.Texte("TYPE") ?? "").Trim().ToUpperInvariant(), l.Texte("LIBELLE"),
                (int)(l.Entier("NIVTOT") ?? 0), l.Texte("VARRESULT") is { } v && !string.IsNullOrWhiteSpace(v) ? v.Trim() : null)).ToList(), StringComparer.Ordinal);
        var variables = (await SqlReprise.SourceAsync(ctx,
                "SELECT V.CLEMETRE, V.LIBELLE, V.VALEUR, V.GLOBALE FROM PMEMETREVAR V WHERE V.CLEMETRE IN (" + Cites + ")", ct))
            .Where(v => EstNom(v.Texte("LIBELLE")?.Trim()))
            .GroupBy(v => v.Texte("CLEMETRE") ?? "").ToDictionary(g => g.Key, g => g.Select(v => new Variable(
                v.Texte("LIBELLE")!.Trim(), v.Decimal("VALEUR") ?? 0, (v.Decimal("GLOBALE") ?? 0) != 0)).ToList(), StringComparer.Ordinal);
        var metres = await SqlReprise.SourceAsync(ctx, "SELECT M.CLE, M.LIBELLE FROM PMEMETRE M WHERE M.CLE IN (" + Cites + ")", ct);
        return new MetresMde(metres.Select(m => new Metre(m.Texte("CLE")!, m.Texte("LIBELLE"),
            lignes.GetValueOrDefault(m.Texte("CLE")!) ?? [], variables.GetValueOrDefault(m.Texte("CLE")!) ?? [])));
    }

    /// <summary>
    /// Pièce complétée de ses métrés : métré du document (affectations des métrés des lignes non reprises, variables
    /// globales), script de chaque ligne reprise (tranche comprise) qui cite un métré à formules.
    /// </summary>
    public PieceSource Appliquer(ContexteReprise ctx, PieceSource p, List<LigneSource> source, string emplacement)
    {
        if (parCle.Count == 0) return p;
        var parCleLigne = source.Where(l => l.Texte("CLE") is not null).GroupBy(l => l.Texte("CLE")!).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var reprises = p.Lignes.Select(l => l.Reference).OfType<string>().ToHashSet(StringComparer.Ordinal);
        var globales = new List<(string Nom, string Expr)>();
        // Lignes non reprises (récapitulatif) : leurs affectations sont globales au document, dans l'ordre ; puis les
        // valeurs des variables globales de PMEMETREVAR (dernière valeur connue de MDE, qui l'emporte).
        foreach (var l in source.Where(l => l.Texte("CLE") is { } c && !reprises.Contains(c)))
            if (Trouver(l.Texte("CLEMETRE")) is { } m)
                globales.AddRange(Affectations(m));
        foreach (var m in source.Select(l => Trouver(l.Texte("CLEMETRE"))).OfType<Metre>().Distinct())
            foreach (var v in m.Variables.Where(v => v.Globale)) globales.Add((v.Nom, Nombre(v.Valeur)));

        var noms = Noms(globales);
        var donnees = DonneesLigne(ctx.Options.VolumeMde);
        void SignalerInconnues(Metre m)
        {
            var inconnues = m.Lignes.Where(x => x.Type == TypeFormule).SelectMany(x => ChampsInconnus(x.Libelle, donnees)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (inconnues.Count > 0)
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.MetreEcart, emplacement,
                    $"Métré « {m.Libelle} » : donnée{(inconnues.Count > 1 ? "s" : "")} {string.Join(", ", inconnues.Select(i => $"[{i}]"))} sans équivalent sur la ligne, laissée{(inconnues.Count > 1 ? "s" : "")} telle{(inconnues.Count > 1 ? "s" : "")} quelle{(inconnues.Count > 1 ? "s" : "")} (script à corriger)");
        }
        foreach (var l in source.Where(l => l.Texte("CLE") is { } c && !reprises.Contains(c)))
            if (Trouver(l.Texte("CLEMETRE")) is { } m) SignalerInconnues(m);
        var lignes = p.Lignes.Select(l =>
        {
            if (l.Reference is not { } r || !parCleLigne.TryGetValue(r, out var ls) || Trouver(ls.Texte("CLEMETRE")) is not { } m
                || !m.Lignes.Any(x => x.Type == TypeFormule && !string.IsNullOrWhiteSpace(x.Libelle))) return l;
            var (script, ignores) = Script(m, noms, donnees);
            foreach (var t in ignores)
                ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.MetreEcart, emplacement,
                    $"Métré « {m.Libelle} » : ligne de type {t} reprise en commentaire");
            SignalerInconnues(m);
            return l with { Metre = new MetrePiece(m.Libelle, script) };
        }).ToList();
        return p with
        {
            Lignes = lignes, Variables = [],
            MetreDocument = globales.Count == 0 ? null : new MetrePiece(LibelleMetreDocument, ScriptDocument(globales, donnees)),
        };
    }

    public const string LibelleMetreDocument = "Récapitulatif";

    /// <summary>Noms des variables globales, à la casse de leur première affectation.</summary>
    private static List<string> Noms(IEnumerable<(string Nom, string Expr)> globales)
    {
        var noms = new List<string>();
        foreach (var (nom, _) in globales)
            if (!noms.Any(n => string.Equals(n, nom, StringComparison.OrdinalIgnoreCase))) noms.Add(nom);
        return noms;
    }

    /// <summary>
    /// Script du métré du document : chaque variable globale déclarée à sa première affectation (non locale : publiée
    /// en $$), réaffectée ensuite dans l'ordre ; formules au format LogiBTP (noms à la casse de leur déclaration).
    /// </summary>
    public static string ScriptDocument(IReadOnlyList<(string Nom, string Expr)> globales, IReadOnlyDictionary<string, string>? donnees = null)
    {
        var noms = Noms(globales);
        var declarees = new List<string>();
        var sb = new StringBuilder("// Récapitulatif repris de MDE : variables du document\n");
        foreach (var (nom, expr) in globales)
        {
            var declaree = noms.First(n => string.Equals(n, nom, StringComparison.OrdinalIgnoreCase));
            var traduite = Expression(expr, [], noms, donnees);
            if (declarees.Contains(declaree)) sb.Append(declaree).Append(" = ").Append(traduite).Append('\n');
            else
            {
                declarees.Add(declaree);
                sb.Append(declaree).Append(" est un numérique = ").Append(traduite).Append('\n');
            }
        }
        return sb.ToString().TrimEnd('\n');
    }

    /// <summary>Affectations « NOM=expr » des lignes de formule d'un métré (dans l'ordre).</summary>
    public static IEnumerable<(string Nom, string Expr)> Affectations(Metre m)
    {
        foreach (var l in m.Lignes.Where(l => l.Type == TypeFormule))
        {
            if (Affectation(l.Libelle) is { } a) yield return a;
            else if (l.Variable is { } v && EstNom(v) && !string.IsNullOrWhiteSpace(l.Libelle)) yield return (v, l.Libelle.Trim());
        }
    }

    /// <summary>
    /// Script d'un métré : une seule formule sans variable → « Renvoyer expr » ; sinon variables locales, total cumulé
    /// des lignes de niveau de total non nul, « Renvoyer Total ». Types de ligne autres que F : commentaires (rendus).
    /// </summary>
    public static (string Script, List<string> Ignores) Script(Metre m, IReadOnlyCollection<string> globales, IReadOnlyDictionary<string, string>? donnees = null)
    {
        var ignores = new List<string>();
        var formules = m.Lignes.Where(l => l.Type == TypeFormule && !string.IsNullOrWhiteSpace(l.Libelle)).ToList();
        var locales = m.Variables.Where(v => !v.Globale).Select(v => v.Nom).ToList();
        var sb = new StringBuilder();
        sb.Append("// Métré repris de MDE").Append(m.Libelle is { } lib ? " : " + UneLigne(lib) : "").Append('\n');
        if (formules.Count == 1 && locales.Count == 0 && m.Lignes.Count == 1 && Affectation(formules[0].Libelle) is null && formules[0].Variable is null)
        {
            sb.Append("Renvoyer ").Append(Expression(formules[0].Libelle!, globales, locales, donnees));
            return (sb.ToString(), ignores);
        }
        foreach (var v in m.Variables.Where(v => !v.Globale))
            sb.Append("local ").Append(v.Nom).Append(" est un numérique = ").Append(Nombre(v.Valeur)).Append('\n');
        sb.Append("local ").Append(NomTotal).Append(" est un numérique = 0\n");
        foreach (var l in m.Lignes)
        {
            if (l.Type != TypeFormule)
            {
                if (!string.IsNullOrWhiteSpace(l.Libelle)) sb.Append("// ").Append(UneLigne(l.Libelle)).Append('\n');
                if (!ignores.Contains(l.Type)) ignores.Add(l.Type);
                continue;
            }
            if (string.IsNullOrWhiteSpace(l.Libelle)) continue;
            var (nom, expr) = Affectation(l.Libelle) ?? (l.Variable is { } v && EstNom(v) ? (v, l.Libelle.Trim()) : (null, l.Libelle.Trim()));
            var traduite = Expression(expr, globales, locales, donnees);
            if (nom is null)
            {
                if (l.NiveauTotal != 0) sb.Append(NomTotal).Append(" += ").Append(traduite).Append('\n');
                else sb.Append("// ").Append(UneLigne(l.Libelle)).Append(" (hors total)\n");
                continue;
            }
            var existante = locales.FirstOrDefault(x => string.Equals(x, nom, StringComparison.OrdinalIgnoreCase));
            if (existante is null)
            {
                locales.Add(nom);
                sb.Append("local ").Append(nom).Append(" est un numérique = ").Append(traduite).Append('\n');
            }
            else sb.Append(existante).Append(" = ").Append(traduite).Append('\n');
            if (l.NiveauTotal != 0) sb.Append(NomTotal).Append(" += ").Append(existante ?? nom).Append('\n');
        }
        sb.Append("Renvoyer ").Append(NomTotal);
        return (sb.ToString(), ignores);
    }

    /// <summary>
    /// Données de la ligne citées par les métrés MDE entre crochets → colonnes de la ligne lues par les scripts (unités de
    /// MDE : m, kg ; VOLUME de MDE = surface par défaut, volume selon l'option de la reprise, comme la bibliothèque).
    /// </summary>
    public static IReadOnlyDictionary<string, string> DonneesLigne(string? volumeMde = null) => new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["POIDS"] = "lig_poids", ["LONGUEUR"] = "lig_longueur", ["LARGEUR"] = "lig_largeur", ["HAUTEUR"] = "lig_hauteur",
        ["EPAISSEUR"] = "lig_epaisseur", ["SURFACE"] = "lig_surface",
        ["VOLUME"] = volumeMde == LogiBTP.Import.VolumeMde.Volume ? "lig_volume" : "lig_surface",
    };

    /// <summary>Données entre crochets d'une formule sans équivalent sur la ligne.</summary>
    public static IEnumerable<string> ChampsInconnus(string? expr, IReadOnlyDictionary<string, string>? donnees = null)
    {
        donnees ??= DonneesLigne();
        return expr is null ? [] : Crochets().Matches(expr).Select(m => m.Groups[1].Value).Where(n => !donnees.ContainsKey(n));
    }

    /// <summary>
    /// Formule MDE au format LogiBTP : virgule décimale entre chiffres → point, données de la ligne entre crochets →
    /// {{lig_…}}, noms des variables locales à leur casse déclarée, noms des variables globales préfixés de $$ (casse de
    /// leur déclaration), fonctions gardées.
    /// </summary>
    public static string Expression(string expr, IReadOnlyCollection<string> globales, IReadOnlyCollection<string> locales,
        IReadOnlyDictionary<string, string>? donnees = null)
    {
        donnees ??= DonneesLigne();
        var texte = Crochets().Replace(VirguleDecimale().Replace(expr.Trim(), "."),
            m => donnees.TryGetValue(m.Groups[1].Value, out var colonne) ? "{{" + colonne + "}}" : m.Value);
        return Identifiant().Replace(texte, x =>
        {
            var nom = x.Value;
            if (x.Index > 0 && texte[x.Index - 1] is '$' or '{' or '[') return nom;
            var suite = texte.AsSpan(x.Index + x.Length).TrimStart();
            if (suite.Length > 0 && suite[0] == '(') return nom;
            if (locales.FirstOrDefault(l => string.Equals(l, nom, StringComparison.OrdinalIgnoreCase)) is { } local) return local;
            if (globales.FirstOrDefault(g => string.Equals(g, nom, StringComparison.OrdinalIgnoreCase)) is { } globale) return "$$" + globale;
            return nom;
        });
    }

    private static (string Nom, string Expr)? Affectation(string? libelle)
    {
        if (libelle is null) return null;
        var m = AffectationRegex().Match(libelle);
        return m.Success ? (m.Groups[1].Value, m.Groups[2].Value.Trim()) : null;
    }

    private static bool EstNom(string? nom) => nom is { Length: > 0 } && NomRegex().IsMatch(nom);

    private static string Nombre(decimal v) => v.ToString("0.############", CultureInfo.InvariantCulture);

    private static string UneLigne(string texte) => texte.ReplaceLineEndings(" ").Trim();

    [GeneratedRegex(@"\[\s*([\p{L}_][\p{L}\p{N}_]*)\s*\]")]
    private static partial Regex Crochets();

    [GeneratedRegex(@"(?<=\d),(?=\d)")]
    private static partial Regex VirguleDecimale();

    [GeneratedRegex(@"(?<![\p{L}\p{N}_.])[\p{L}_][\p{L}\p{N}_]*")]
    private static partial Regex Identifiant();

    [GeneratedRegex(@"^\s*([\p{L}_][\p{L}\p{N}_]*)\s*=(?!=)\s*(.+)$", RegexOptions.Singleline)]
    private static partial Regex AffectationRegex();

    [GeneratedRegex(@"^[\p{L}_][\p{L}\p{N}_]*$")]
    private static partial Regex NomRegex();
}
