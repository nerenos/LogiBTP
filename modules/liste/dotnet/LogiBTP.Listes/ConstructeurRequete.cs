using System.Text.RegularExpressions;

namespace LogiBTP.Listes;

/// <summary>Paramètre d'une requête : texte, tableau de textes ou entier.</summary>
public sealed record ParametreSql(string Nom, object? Valeur);

public sealed record RequeteSql(string Texte, IReadOnlyList<ParametreSql> Parametres);

/// <summary>
/// Construction des requêtes d'une liste sur une source encadrée (<c>SELECT … FROM (source) s</c>). Réplique de la
/// sémantique de modules/liste/js/src/requete.js (jeux partagés modules/liste/tests/cas) :
/// <list type="bullet">
/// <item>filtres fixes de la vue : toujours appliqués, en ET ;</item>
/// <item>recherche : chaque mot contenu, sans casse ni accents (f_sans_accent), dans au moins une colonne de recherche ;</item>
/// <item>segments : valeur (texte brut) parmi celles retenues, null = vide ;</item>
/// <item>tri : colonnes demandées puis identifiant croissant, vides toujours en dernier ;</item>
/// <item>pagination par clé : lignes strictement après le curseur (valeurs de tri de la dernière ligne, puis ID).</item>
/// </list>
/// Les identifiants ne viennent jamais du client tels quels : seules les colonnes connues de la source sont
/// acceptées, et toutes les valeurs passent en paramètres. Classe mère : les étapes sont surchargeables.
/// </summary>
public partial class ConstructeurRequete
{
    public const int MotsMax = 10;

    /// <summary>Opérateurs des filtres fixes (même liste que OPERATEURS_VUE côté JS).</summary>
    public static readonly IReadOnlySet<string> OperateursVue = new HashSet<string>(StringComparer.Ordinal)
    {
        "=", "<>", ">", ">=", "<", "<=", "entre", "contient", "commence", "finit", "dans", "vide", "nonvide", "vrai", "faux",
    };

    [GeneratedRegex(@"^(smallint|integer|bigint|numeric|decimal|real|double precision|money)")]
    private static partial Regex TypeNumerique();
    public const int ControleMax = 20000;

    [GeneratedRegex(@"^[a-z][a-z0-9 _]*(\(\d+(,\d+)?\))?(\[\])?$")]
    private static partial Regex TypeSur();

    private readonly List<ParametreSql> _parametres = [];
    private readonly Dictionary<string, ColonneSource> _colonnes;

    public ConstructeurRequete(SourceResolue source, DefinitionVue definition, DemandeListe demande)
    {
        Source = source;
        Definition = definition;
        Demande = demande;
        _colonnes = source.Colonnes.GroupBy(c => c.Code, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        if (!_colonnes.ContainsKey(source.ColonneId)) throw new ErreurListe("COLONNE_ID", $"Colonne identifiant {source.ColonneId} absente de la source");
        if (source.ColonneType is { } t && !_colonnes.ContainsKey(t)) throw new ErreurListe("COLONNE_TYPE", $"Colonne type d'élément {t} absente de la source");
    }

    protected SourceResolue Source { get; }
    protected DefinitionVue Definition { get; }
    protected DemandeListe Demande { get; }

    // ------------------------------------------------------------------ briques

    public static string Identifiant(string nom) => "\"" + nom.Replace("\"", "\"\"") + "\"";

    protected string P(object? valeur)
    {
        var nom = $"p{_parametres.Count}";
        _parametres.Add(new ParametreSql(nom, valeur));
        return "@" + nom;
    }

    protected bool Connue(string code) => _colonnes.ContainsKey(code);

    /// <summary>Colonne de la source ; une colonne inconnue est refusée (jamais insérée dans le SQL).</summary>
    protected string Col(string code) =>
        Connue(code) ? "s." + Identifiant(code) : throw new ErreurListe("COLONNE_INCONNUE", $"Colonne {code} inconnue de la source");

    /// <summary>Valeur de curseur convertie au type de la colonne (texte si le type n'est pas reconnu).</summary>
    protected (string Colonne, string Valeur) Typee(string code, string? valeur)
    {
        var type = _colonnes[code].Type.ToLowerInvariant();
        return TypeSur().IsMatch(type) ? (Col(code), $"CAST({P(valeur)} AS {type})") : (Col(code) + "::text", P(valeur));
    }

    protected string Id => Col(Source.ColonneId);

    /// <summary>Colonnes lues : colonnes non calculées de la vue présentes dans la source.</summary>
    protected virtual IReadOnlyList<string> ColonnesLues() =>
        Definition.Colonnes.Where(c => !c.Calcul && Connue(c.Code)).Select(c => c.Code).Distinct(StringComparer.Ordinal).ToList();

    protected virtual IReadOnlyList<string> ColonnesRecherche() =>
        Definition.Colonnes.Where(c => !c.Calcul && (c.Recherche ?? true) && Connue(c.Code)).Select(c => c.Code).Distinct(StringComparer.Ordinal).ToList();

    /// <summary>Tri effectif : celui de la demande, sinon celui de la vue ; colonnes inconnues ignorées.</summary>
    public virtual IReadOnlyList<TriColonne> Tri() =>
        (Demande.Tri.Count > 0 ? Demande.Tri : Definition.Tri).Where(t => Connue(t.Colonne))
            .Select(t => new TriColonne { Colonne = t.Colonne, Sens = t.Sens == "desc" ? "desc" : "asc" }).ToList();

    public static IReadOnlyList<string> Mots(string? recherche) =>
        (recherche ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Take(MotsMax).ToList();

    public static string EchapperLike(string mot) => mot.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    /// <summary>Conditions de recherche et de segments (sauf le segment <paramref name="sansSegment"/>).</summary>
    protected virtual List<string> Conditions(string? sansSegment = null)
    {
        var conditions = Definition.Filtres.Select(ConditionFiltre).ToList();
        var colonnes = ColonnesRecherche();
        foreach (var mot in Mots(Demande.Recherche))
        {
            if (colonnes.Count == 0) { conditions.Add("FALSE"); break; }
            var p = P("%" + EchapperLike(mot) + "%");
            conditions.Add("(" + string.Join(" OR ", colonnes.Select(c => $"f_sans_accent({Col(c)}::text) LIKE f_sans_accent({p}) ESCAPE '\\'")) + ")");
        }
        foreach (var (colonne, valeurs) in Demande.Segments.OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            if (valeurs is not { Count: > 0 } || colonne == sansSegment) continue;
            var parties = new List<string>();
            var nonVides = valeurs.Where(v => v is not null).Cast<string>().ToArray();
            if (nonVides.Length > 0) parties.Add($"{Col(colonne)}::text = ANY({P(nonVides)})");
            if (valeurs.Any(v => v is null)) parties.Add($"{Col(colonne)} IS NULL");
            conditions.Add("(" + string.Join(" OR ", parties) + ")");
        }
        return conditions;
    }

    /// <summary>Valeur saisie convertie au type de la colonne (virgule décimale acceptée pour un nombre).</summary>
    protected string ValeurFiltre(string colonne, string? valeur)
    {
        var type = _colonnes[colonne].Type.ToLowerInvariant();
        var v = TypeNumerique().IsMatch(type) ? valeur?.Trim().Replace(',', '.') : valeur;
        return Typee(colonne, v).Valeur;
    }

    /// <summary>Condition SQL d'un filtre fixe ; même sémantique que correspondFiltreVue (requete.js).</summary>
    protected virtual string ConditionFiltre(FiltreVue f)
    {
        if (!OperateursVue.Contains(f.Op)) throw new ErreurListe("FILTRE_OPERATEUR", $"Opérateur de filtre inconnu : {f.Op}");
        var col = Col(f.Colonne);
        string Motif(string debut, string fin) =>
            $"f_sans_accent({col}::text) LIKE f_sans_accent({P(debut + EchapperLike(f.Valeur ?? "") + fin)}) ESCAPE '\\'";
        switch (f.Op)
        {
            case "vide": return $"({col} IS NULL OR {col}::text = '')";
            case "nonvide": return $"({col} IS NOT NULL AND {col}::text <> '')";
            case "vrai": return $"({col})::boolean IS TRUE";
            case "faux": return $"({col})::boolean IS FALSE";
            case "dans": return $"{col}::text = ANY({P((f.Valeurs ?? []).ToArray())})";
            case "contient": return Motif("%", "%");
            case "commence": return Motif("", "%");
            case "finit": return Motif("%", "");
        }
        var (colonne, _) = Typee(f.Colonne, f.Valeur);
        if (f.Op == "entre") return $"{colonne} BETWEEN {ValeurFiltre(f.Colonne, f.Valeur)} AND {ValeurFiltre(f.Colonne, f.Valeur2)}";
        return $"{colonne} {f.Op} {ValeurFiltre(f.Colonne, f.Valeur)}";
    }

    /// <summary>
    /// Ligne strictement après le curseur, dans l'ordre (col IS NULL), col [ASC|DESC] …, id ASC :
    /// OU sur k de (colonnes 0..k-1 égales ET colonne k après), puis égalité complète et ID supérieur.
    /// </summary>
    protected string ApresCurseur(IReadOnlyList<TriColonne> tri, IReadOnlyList<string?> curseur)
    {
        if (curseur.Count != tri.Count + 1) throw new ErreurListe("CURSEUR", "Curseur incompatible avec le tri");
        var branches = new List<string>();
        var egalites = new List<string>();
        for (var k = 0; k <= tri.Count; k++)
        {
            if (k == tri.Count)
            {
                var (colId, valId) = Typee(Source.ColonneId, curseur[k]);
                branches.Add(string.Join(" AND ", [.. egalites, $"{colId} > {valId}"]));
                break;
            }
            var t = tri[k];
            var v = curseur[k];
            if (v is null)
            {
                // Vides en dernier : rien n'est après un vide sur cette colonne, sauf à égalité (vide aussi).
                egalites.Add($"{Col(t.Colonne)} IS NULL");
                continue;
            }
            var (col, val) = Typee(t.Colonne, v);
            var apres = t.Sens == "desc" ? "<" : ">";
            branches.Add(string.Join(" AND ", [.. egalites, $"({Col(t.Colonne)} IS NULL OR {col} {apres} {val})"]));
            egalites.Add($"{col} = {Typee(t.Colonne, v).Valeur}");
        }
        return "(" + string.Join(" OR ", branches.Select(b => "(" + b + ")")) + ")";
    }

    protected string OrdreSql(IReadOnlyList<TriColonne> tri) =>
        string.Join(", ", [.. tri.Select(t => $"({Col(t.Colonne)} IS NULL), {Col(t.Colonne)} {(t.Sens == "desc" ? "DESC" : "ASC")}"), $"{Id} ASC"]);

    protected static string Where(IEnumerable<string> conditions)
    {
        var liste = conditions.ToList();
        return liste.Count == 0 ? "" : " WHERE " + string.Join(" AND ", liste);
    }

    protected string Depuis => $"FROM ({Source.Sql}) s";

    /// <summary>Colonnes renvoyées : données de la vue, puis _id, _type, _h (empreinte md5 de la ligne source).</summary>
    protected string Selection(bool avecCurseur)
    {
        var parties = ColonnesLues().Select(c => $"{Col(c)} AS {Identifiant(c)}").ToList();
        parties.Add($"{Id} AS \"_id\"");
        parties.Add(Source.ColonneType is { } t ? $"{Col(t)}::text AS \"_type\"" : $"{P(Source.TypeElement)}::text AS \"_type\"");
        parties.Add("md5(row_to_json(s)::text) AS \"_h\"");
        if (avecCurseur)
        {
            var tri = Tri();
            for (var i = 0; i < tri.Count; i++) parties.Add($"{Col(tri[i].Colonne)}::text AS \"_t{i}\"");
            parties.Add($"{Id}::text AS \"_tid\"");
        }
        return string.Join(", ", parties);
    }

    private RequeteSql Fin(string texte) => new(texte, _parametres.ToList());

    // ------------------------------------------------------------------ requêtes

    /// <summary>Lot : taille + 1 lignes (la ligne en trop indique qu'une suite existe).</summary>
    public virtual RequeteSql Lot(int taille)
    {
        var tri = Tri();
        var conditions = Conditions();
        if (Demande.Apres is { Count: > 0 } apres) conditions.Add(ApresCurseur(tri, apres));
        return Fin($"SELECT {Selection(true)} {Depuis}{Where(conditions)} ORDER BY {OrdreSql(tri)} LIMIT {P(taille + 1)}");
    }

    /// <summary>Comptes par valeur d'un segment, sans le filtre de ce segment.</summary>
    public virtual RequeteSql Segments(string colonne, int max = 500)
    {
        var col = Col(colonne);
        return Fin($"SELECT {col}::text AS valeur, count(*) AS nombre {Depuis}{Where(Conditions(colonne))} GROUP BY 1 ORDER BY 1 NULLS LAST LIMIT {P(max)}");
    }

    /// <summary>ID et empreinte des lignes du filtre jusqu'au curseur inclus, dans l'ordre.</summary>
    public virtual RequeteSql Controle()
    {
        var tri = Tri();
        var conditions = Conditions();
        if (Demande.Jusqua is { Count: > 0 } jusqua) conditions.Add("NOT " + ApresCurseur(tri, jusqua));
        return Fin($"SELECT {Id}::text AS id, md5(row_to_json(s)::text) AS h {Depuis}{Where(conditions)} ORDER BY {OrdreSql(tri)} LIMIT {P(ControleMax)}");
    }

    /// <summary>Lignes ciblées (rafraîchissement) qui satisfont encore le filtre.</summary>
    public virtual RequeteSql Lignes(IReadOnlyCollection<string> ids)
    {
        var conditions = Conditions();
        conditions.Add($"{Id}::text = ANY({P(ids.ToArray())})");
        return Fin($"SELECT {Selection(false)} {Depuis}{Where(conditions)} ORDER BY {OrdreSql(Tri())}");
    }

    /// <summary>Colonnes et types d'une source (aucune ligne lue).</summary>
    public static RequeteSql Schema(string sql) => new($"SELECT * FROM ({sql}) s LIMIT 0", []);
}
