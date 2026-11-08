using System.Text.RegularExpressions;

namespace LogiBTP.Listes;

/// <summary>Paramètre d'une requête : texte, tableau de textes ou entier.</summary>
public sealed record ParametreSql(string Nom, object? Valeur);

public sealed record RequeteSql(string Texte, IReadOnlyList<ParametreSql> Parametres);

/// <summary>
/// Construction des requêtes d'une liste sur une source encadrée (<c>SELECT … FROM (source) s</c>). Réplique de la
/// sémantique de modules/liste/js/src/requete.js (jeux partagés modules/liste/tests/cas) :
/// <list type="bullet">
/// <item>types d'élément du thème de la vue : la ligne doit être de l'un d'eux (aucun = tous) ;</item>
/// <item>filtres fixes de la vue : toujours appliqués, en ET ;</item>
/// <item>recherche : chaque mot contenu, sans casse ni accents (f_sans_accent), dans au moins une colonne de recherche ;</item>
/// <item>segments : valeur (texte brut) parmi celles retenues, null = vide ; colonne multivaluée (tableau) : l'une de ses
/// valeurs retenue, null = tableau vide ou absent ; comptes par valeur du tableau ;</item>
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
        "=", "<>", ">", ">=", "<", "<=", "entre", "contient", "commence", "finit", "dans", "vide", "nonvide", "vrai", "faux", "periode",
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

    /// <summary>Jour d'exécution pour les filtres « periode » (absent = date du jour du serveur ; fixé par les tests).</summary>
    public DateOnly? Reference { get; set; }

    /// <summary>Début d'exercice (seuls mois et jour comptent) pour la période « exercice en cours » ; absent = année civile.</summary>
    public DateOnly? DebutExercice { get; set; }

    /// <summary>Types d'élément du thème de la vue (vide = tous), fixés par le service.</summary>
    public IReadOnlyList<string> TypesTheme { get; set; } = [];

    /// <summary>Types d'élément refusés à l'utilisateur (droits de consultation), fixés par le service : lignes écartées.</summary>
    public IReadOnlyList<string> TypesRefuses { get; set; } = [];

    /// <summary>
    /// Colonnes confidentielles masquées à l'utilisateur (RGPD), fixées par le service : jamais lues, ni cherchées, ni
    /// triées ; un filtre ou un segment qui les cite est refusé (COLONNE_CONFIDENTIELLE).
    /// </summary>
    public IReadOnlySet<string> ColonnesMasquees { get; set; } = new HashSet<string>();

    protected SourceResolue Source { get; }

    /// <summary>Source interrogée (relation à mettre à jour pour la saisie dans la liste).</summary>
    public SourceResolue SourceResolue => Source;
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

    protected bool Connue(string code) => _colonnes.ContainsKey(code) && !ColonnesMasquees.Contains(code);

    /// <summary>Colonne de la source ; une colonne inconnue ou masquée est refusée (jamais insérée dans le SQL).</summary>
    protected string Col(string code) =>
        Connue(code) ? "s." + Identifiant(code)
        : _colonnes.ContainsKey(code) ? throw new ErreurListe("COLONNE_CONFIDENTIELLE", $"Colonne {code} confidentielle")
        : throw new ErreurListe("COLONNE_INCONNUE", $"Colonne {code} inconnue de la source");

    /// <summary>Valeur de curseur convertie au type de la colonne (texte si le type n'est pas reconnu).</summary>
    protected (string Colonne, string Valeur) Typee(string code, string? valeur)
    {
        var type = _colonnes[code].Type.ToLowerInvariant();
        return TypeSur().IsMatch(type) ? (Col(code), $"CAST({P(valeur)} AS {type})") : (Col(code) + "::text", P(valeur));
    }

    protected string Id => Col(Source.ColonneId);

    /// <summary>Colonne multivaluée (tableau PostgreSQL : data_type ARRAY).</summary>
    protected bool EstTableau(string code) => Connue(code) &&
        (_colonnes[code].Type.Equals("ARRAY", StringComparison.OrdinalIgnoreCase) || _colonnes[code].Type.EndsWith("[]", StringComparison.Ordinal));

    /// <summary>Texte brut d'une colonne (tableau : valeurs jointes par « , », comme texteBrut côté JS).</summary>
    protected string Texte(string code) => EstTableau(code) ? $"array_to_string({Col(code)}, ', ')" : $"{Col(code)}::text";

    private string Vide(string code) => EstTableau(code) ? $"({Col(code)} IS NULL OR cardinality({Col(code)}) = 0)" : $"{Col(code)} IS NULL";

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

    /// <summary>Colonne d'état d'utilisation des sources (A en service, N ne plus utiliser, S en sommeil).</summary>
    public const string ColonneUsage = "usage";

    /// <summary>
    /// Lignes en sommeil masquées (usage différent de S, vide compris) quand la source porte l'état d'utilisation et
    /// que la vue ne les montre pas (même règle que filtresEffectifs / opérateur « sommeil » de requete.js).
    /// </summary>
    public bool MasqueSommeil => Connue(ColonneUsage) && !Definition.Sommeil;

    /// <summary>Conditions de recherche et de segments (sauf le segment <paramref name="sansSegment"/>).</summary>
    protected virtual List<string> Conditions(string? sansSegment = null)
    {
        var conditions = new List<string>();
        if (TypesTheme.Count > 0)
        {
            var type = Source.ColonneType is { } t ? Col(t) : P(Source.TypeElement);
            conditions.Add($"({type})::text = ANY({P(TypesTheme.ToArray())})");
        }
        if (TypesRefuses.Count > 0)
        {
            var type = Source.ColonneType is { } t ? Col(t) : P(Source.TypeElement);
            conditions.Add($"NOT (({type})::text = ANY({P(TypesRefuses.ToArray())}))");
        }
        conditions.AddRange(Definition.Filtres.Select(ConditionFiltre));
        conditions.AddRange(Demande.Filtres.Select(ConditionFiltre));
        if (MasqueSommeil) conditions.Add($"{Col(ColonneUsage)}::text IS DISTINCT FROM 'S'");
        var colonnes = ColonnesRecherche();
        foreach (var mot in Mots(Demande.Recherche))
        {
            if (colonnes.Count == 0) { conditions.Add("FALSE"); break; }
            var p = P("%" + EchapperLike(mot) + "%");
            conditions.Add("(" + string.Join(" OR ", colonnes.Select(c => $"f_sans_accent({Texte(c)}) LIKE f_sans_accent({p}) ESCAPE '\\'")) + ")");
        }
        foreach (var (colonne, valeurs) in Demande.Segments.OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            if (valeurs is not { Count: > 0 } || colonne == sansSegment) continue;
            var parties = new List<string>();
            var nonVides = valeurs.Where(v => v is not null).Cast<string>().ToArray();
            if (nonVides.Length > 0) parties.Add(EstTableau(colonne) ? $"{Col(colonne)}::text[] && {P(nonVides)}" : $"{Col(colonne)}::text = ANY({P(nonVides)})");
            if (valeurs.Any(v => v is null)) parties.Add(Vide(colonne));
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

    /// <summary>Type PostgreSQL qui porte une date : date ou timestamp (même règle que estTypeDate, requete.js).</summary>
    private static bool EstTypeDate(string type) =>
        type.StartsWith("date", StringComparison.OrdinalIgnoreCase) || type.StartsWith("timestamp", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Filtre « periode » : jour de la colonne entre les bornes de la période (valeur = code, nombre = x), calculées à la
    /// date d'exécution. Colonne d'un autre type refusée (PERIODE_COLONNE). Même règle que resoudrePeriodes (requete.js).
    /// </summary>
    private string ConditionPeriode(FiltreVue f, string col)
    {
        if (!EstTypeDate(_colonnes[f.Colonne].Type))
            throw new ErreurListe(ErreursListe.PeriodeColonne, $"Période sur la colonne {f.Colonne} : colonne de date attendue");
        (DateOnly Debut, DateOnly Fin) bornes;
        try { bornes = Periodes.Bornes(f.Valeur ?? "", f.Nombre, Reference ?? DateOnly.FromDateTime(DateTime.Today), DebutExercice); }
        catch (ErreurPeriode e) { throw new ErreurListe(e.Code, e.Message); }
        var (debut, fin) = bornes;
        return $"({col})::date BETWEEN CAST({P(debut.ToString("yyyy-MM-dd"))} AS date) AND CAST({P(fin.ToString("yyyy-MM-dd"))} AS date)";
    }

    /// <summary>Condition SQL d'un filtre fixe ; même sémantique que correspondFiltreVue (requete.js).</summary>
    protected virtual string ConditionFiltre(FiltreVue f)
    {
        if (!OperateursVue.Contains(f.Op)) throw new ErreurListe("FILTRE_OPERATEUR", $"Opérateur de filtre inconnu : {f.Op}");
        var col = Col(f.Colonne);
        if (f.Op == "periode") return ConditionPeriode(f, col);
        string Motif(string debut, string fin) =>
            $"f_sans_accent({Texte(f.Colonne)}) LIKE f_sans_accent({P(debut + EchapperLike(f.Valeur ?? "") + fin)}) ESCAPE '\\'";
        if (EstTableau(f.Colonne))
        {
            switch (f.Op)
            {
                case "vide": return Vide(f.Colonne);
                case "nonvide": return $"NOT {Vide(f.Colonne)}";
                case "dans": return $"{col}::text[] && {P((f.Valeurs ?? []).ToArray())}";
            }
        }
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
        // Colonne seule (sans paramètre) : les valeurs passent par ValeurFiltre.
        var colonne = TypeSur().IsMatch(_colonnes[f.Colonne].Type.ToLowerInvariant()) ? col : col + "::text";
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
        var lues = ColonnesLues();
        // Colonnes des segments lues même si la vue ne les affiche pas : le client compte les segments sur les lignes
        // chargées quand des filtres de colonnes sont actifs.
        var segments = Definition.Segments.Select(s => s.Colonne).Where(c => Connue(c) && !lues.Contains(c)).Distinct(StringComparer.Ordinal);
        var parties = lues.Concat(segments).Select(c => $"{Col(c)} AS {Identifiant(c)}").ToList();
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
        // Colonne multivaluée : une ligne par valeur du tableau (tableau vide ou absent : une ligne vide).
        if (EstTableau(colonne))
            return Fin($"SELECT x.v AS valeur, count(*) AS nombre {Depuis} LEFT JOIN LATERAL (SELECT DISTINCT u FROM unnest({col}::text[]) AS u WHERE u IS NOT NULL) AS x(v) ON TRUE"
                + $"{Where(Conditions(colonne))} GROUP BY 1 ORDER BY 1 NULLS LAST LIMIT {P(max)}");
        return Fin($"SELECT {col}::text AS valeur, count(*) AS nombre {Depuis}{Where(Conditions(colonne))} GROUP BY 1 ORDER BY 1 NULLS LAST LIMIT {P(max)}");
    }

    /// <summary>Calculs d'agrégat acceptés (même liste que CALCULS_AGREGAT côté JS).</summary>
    public static readonly IReadOnlySet<string> CalculsAgregat = new HashSet<string>(StringComparer.Ordinal) { "somme", "moyenne", "min", "max", "compte", "ratio" };
    public const int AgregatsMax = 40;

    private string Filtre(IReadOnlyList<FiltreVue> filtres) =>
        filtres.Count == 0 ? "" : $" FILTER (WHERE {string.Join(" AND ", filtres.Select(ConditionFiltre))})";

    /// <summary>
    /// Agrégats sur toute la sélection (vue, recherche, segments, filtres de la demande) : une ligne, colonne « _lignes »
    /// (nombre de lignes), puis « a{i} » par agrégat (ratio : « a{i}n » et « a{i}d », rapport calculé par l'appelant).
    /// Somme et compte d'un ensemble vide : 0 ; moyenne, min, max : null.
    /// </summary>
    public virtual RequeteSql Agregats(IReadOnlyList<AgregatListe> agregats)
    {
        if (agregats.Count > AgregatsMax) throw new ErreurListe("AGREGAT", $"{AgregatsMax} agrégats au plus");
        var parties = new List<string> { "count(*) AS \"_lignes\"" };
        for (var i = 0; i < agregats.Count; i++)
        {
            var a = agregats[i];
            if (!CalculsAgregat.Contains(a.Calcul)) throw new ErreurListe("AGREGAT", $"Calcul d'agrégat inconnu : {a.Calcul}");
            var filtre = Filtre(a.Filtres);
            if (a.Calcul == "compte") { parties.Add($"count(*){filtre} AS \"a{i}\""); continue; }
            if (a.Calcul == "ratio")
            {
                parties.Add($"count(*){filtre} AS \"a{i}n\"");
                parties.Add($"count(*){Filtre(a.Denominateur)} AS \"a{i}d\"");
                continue;
            }
            if (a.Colonne is not { } colonne || !TypeNumerique().IsMatch(_colonnes.GetValueOrDefault(colonne)?.Type.ToLowerInvariant() ?? ""))
                throw new ErreurListe("AGREGAT", $"Colonne numérique attendue pour l'agrégat {a.Code}");
            var col = $"{Col(colonne)}::numeric";
            parties.Add(a.Calcul switch
            {
                "somme" => $"coalesce(sum({col}){filtre}, 0) AS \"a{i}\"",
                "moyenne" => $"avg({col}){filtre} AS \"a{i}\"",
                "min" => $"min({col}){filtre} AS \"a{i}\"",
                _ => $"max({col}){filtre} AS \"a{i}\"",
            });
        }
        return Fin($"SELECT {string.Join(", ", parties)} {Depuis}{Where(Conditions())}");
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

    // ------------------------------------------------------------------ saisie dans la liste

    /// <summary>Colonne saisissable : cochée modifiable dans la vue, modifiable dans la base, source modifiable.</summary>
    public bool Saisissable(string code) =>
        Source.Table is not null && _colonnes.TryGetValue(code, out var c) && c.Modifiable
        && Definition.Colonnes.Any(x => x.Code == code && x.Modifiable && !x.Calcul);

    private string IdTypee(string id)
    {
        var (_, valeur) = Typee(Source.ColonneId, id);
        return valeur;
    }

    /// <summary>Verrou et empreinte actuelle de la ligne (même calcul que _h).</summary>
    public virtual RequeteSql Verrou(string id) =>
        Fin($"SELECT md5(row_to_json(s)::text) AS h {Depuis} WHERE {Id} = {IdTypee(id)} FOR UPDATE");

    /// <summary>UPDATE de la relation de la source ; chaque colonne est contrôlée, chaque valeur convertie à son type.</summary>
    public virtual RequeteSql MiseAJour(string id, IReadOnlyDictionary<string, string?> valeurs)
    {
        if (Source.Table is null) throw new ErreurListe("SOURCE_LECTURE_SEULE", "Cette source n'est pas modifiable");
        if (valeurs.Count == 0) throw new ErreurListe("VALEURS", "Aucune valeur à enregistrer");
        var affectations = new List<string>();
        foreach (var (code, valeur) in valeurs)
        {
            if (!Saisissable(code)) throw new ErreurListe("COLONNE_NON_MODIFIABLE", $"Colonne {code} non modifiable");
            affectations.Add($"{Identifiant(code)} = {(valeur is null ? "NULL" : ValeurFiltre(code, valeur))}");
        }
        return Fin($"UPDATE {Source.Table} SET {string.Join(", ", affectations)} WHERE {Identifiant(Source.ColonneId)} = {IdTypee(id)}");
    }

    /// <summary>Ligne relue après saisie, sans filtre (elle peut être sortie du filtre de la liste).</summary>
    public virtual RequeteSql LigneBrute(string id) => Fin($"SELECT {Selection(false)} {Depuis} WHERE {Id} = {IdTypee(id)}");

    /// <summary>Colonnes et types d'une source (aucune ligne lue).</summary>
    public static RequeteSql Schema(string sql) => new($"SELECT * FROM ({sql}) s LIMIT 0", []);
}
