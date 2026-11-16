using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LogiBTP.Import.Reprise;

/// <summary>
/// Entrée d'une table de correspondance : une valeur source associée à une cible (un code de l'appelant), ou ignorée
/// avec un motif. <see cref="Note"/> documente une règle appliquée par le domaine (sans effet sur la validation).
/// </summary>
public sealed record EntreeCorrespondance(
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("cible")] string? Cible = null,
    [property: JsonPropertyName("ignorer")] bool Ignorer = false,
    [property: JsonPropertyName("motif")] string? Motif = null,
    [property: JsonPropertyName("note")] string? Note = null);

/// <summary>
/// Table de correspondance nommée : valeurs d'une colonne source (<see cref="Colonne"/>) vers des cibles prises dans les
/// listes nommées <see cref="Cibles"/> (fournies par l'appelant à la validation). OPTIM : <see cref="TypeParametre"/>
/// restreint la table aux lignes de <c>z_parametre</c> de ce <c>PRM_TypeParam</c>, rapprochées par <c>PRM_Code</c>
/// (jamais par <c>PRM_ID</c>, propre à chaque base).
/// </summary>
public sealed record TableCorrespondance(
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("colonne")] string? Colonne,
    [property: JsonPropertyName("type_parametre")] string? TypeParametre,
    [property: JsonPropertyName("cibles")] IReadOnlyList<string> Cibles,
    [property: JsonPropertyName("entrees")] IReadOnlyList<EntreeCorrespondance> Entrees)
{
    /// <summary>Entrée d'une valeur source (comparaison exacte, espaces de fin retirés comme le font les sources), sinon null.</summary>
    public EntreeCorrespondance? Trouver(string? source)
    {
        var cle = (source ?? "").TrimEnd();
        return Entrees.FirstOrDefault(e => e.Source.TrimEnd() == cle);
    }
}

/// <summary>Erreur de validation : code (<see cref="ErreurCorrespondance"/>), emplacement (table, entrée) et valeur en cause.</summary>
public sealed record ErreurValidation(string Code, string Emplacement, string? Valeur = null);

/// <summary>
/// Fichier de correspondances d'une reprise (JSON) : source, version et tables nommées. Le module en définit le format et
/// la validation ; le cœur fournit les fichiers par défaut (ils citent ses codes) et les listes de cibles admises.
/// </summary>
public sealed class FichierCorrespondances
{
    private static readonly JsonSerializerOptions Options = new()
    {
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    [JsonPropertyName("source")] public string Source { get; init; } = "";
    [JsonPropertyName("version")] public int Version { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("tables")] public IReadOnlyDictionary<string, TableCorrespondance> Tables { get; init; } =
        new Dictionary<string, TableCorrespondance>();

    /// <summary>Sources connues (<see cref="SourceReprise"/>).</summary>
    public static IReadOnlyList<string> SourcesConnues { get; } = typeof(SourceReprise)
        .GetFields(BindingFlags.Public | BindingFlags.Static)
        .Where(f => f.IsLiteral)
        .Select(f => (string)f.GetRawConstantValue()!)
        .ToList();

    /// <summary>Listes de cibles neutres définies par le module, ajoutées à celles de l'appelant à la validation.</summary>
    public static IReadOnlyDictionary<string, IReadOnlyCollection<string>> CiblesModule { get; } =
        new Dictionary<string, IReadOnlyCollection<string>>
        {
            ["ETAT_SUITE"] = Valeurs(typeof(EtatSuite)),
            ["PART_SOUS_TRAITANCE"] = Valeurs(typeof(PartSousTraitance)),
            ["MODE_AVANCEMENT"] = Valeurs(typeof(ModeAvancement)),
        };

    /// <summary>Lecture d'un fichier JSON ; un JSON illisible donne une erreur <see cref="ErreurCorrespondance.FormatInvalide"/>.</summary>
    public static (FichierCorrespondances? Fichier, ErreurValidation? Erreur) Lire(string json)
    {
        try
        {
            var fichier = JsonSerializer.Deserialize<FichierCorrespondances>(json, Options);
            return fichier is null
                ? (null, new ErreurValidation(ErreurCorrespondance.FormatInvalide, "fichier"))
                : (fichier, null);
        }
        catch (JsonException e)
        {
            return (null, new ErreurValidation(ErreurCorrespondance.FormatInvalide, e.Path ?? "fichier", e.Message));
        }
    }

    /// <summary>
    /// Validation : source connue (et égale à <paramref name="sourceAttendue"/> si fournie), tables attendues présentes et
    /// aucune autre, listes de cibles connues, valeurs sources non vides et uniques, une cible ou « ignorer » avec motif
    /// (jamais les deux), cible admise par l'une des listes de la table. Liste vide : fichier valide.
    /// </summary>
    public IReadOnlyList<ErreurValidation> Valider(
        IReadOnlyCollection<string> tablesAttendues,
        IReadOnlyDictionary<string, IReadOnlyCollection<string>> cibles,
        string? sourceAttendue = null)
    {
        var erreurs = new List<ErreurValidation>();
        if (!SourcesConnues.Contains(Source))
            erreurs.Add(new(ErreurCorrespondance.SourceInconnue, "source", Source));
        else if (sourceAttendue is not null && Source != sourceAttendue)
            erreurs.Add(new(ErreurCorrespondance.SourceDifferente, "source", Source));

        foreach (var nom in tablesAttendues.Where(t => !Tables.ContainsKey(t)).Order(StringComparer.Ordinal))
            erreurs.Add(new(ErreurCorrespondance.TableManquante, nom));
        foreach (var nom in Tables.Keys.Where(t => !tablesAttendues.Contains(t)).Order(StringComparer.Ordinal))
            erreurs.Add(new(ErreurCorrespondance.TableInconnue, nom));

        foreach (var (nom, table) in Tables.OrderBy(t => t.Key, StringComparer.Ordinal))
        {
            var admises = new HashSet<string>(StringComparer.Ordinal);
            foreach (var liste in table.Cibles ?? [])
            {
                if (cibles.TryGetValue(liste, out var valeurs) || CiblesModule.TryGetValue(liste, out valeurs))
                    admises.UnionWith(valeurs);
                else
                    erreurs.Add(new(ErreurCorrespondance.ListeCiblesInconnue, nom, liste));
            }

            var vues = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < (table.Entrees ?? []).Count; i++)
            {
                var e = table.Entrees![i];
                var ou = $"{nom}[{i}]";
                if (e.Source is null) { erreurs.Add(new(ErreurCorrespondance.SourceVide, ou)); continue; }
                if (!vues.Add(e.Source.TrimEnd())) erreurs.Add(new(ErreurCorrespondance.ValeurEnDouble, ou, e.Source));
                if (e.Ignorer)
                {
                    if (e.Cible is not null) erreurs.Add(new(ErreurCorrespondance.CibleEtIgnorer, ou, e.Source));
                    if (string.IsNullOrWhiteSpace(e.Motif)) erreurs.Add(new(ErreurCorrespondance.MotifManquant, ou, e.Source));
                }
                else if (string.IsNullOrWhiteSpace(e.Cible))
                    erreurs.Add(new(ErreurCorrespondance.SansCible, ou, e.Source));
                else if (!admises.Contains(e.Cible))
                    erreurs.Add(new(ErreurCorrespondance.CibleInconnue, ou, e.Cible));
            }
        }
        return erreurs;
    }

    private static IReadOnlyCollection<string> Valeurs(Type type) => type
        .GetFields(BindingFlags.Public | BindingFlags.Static)
        .Where(f => f.IsLiteral)
        .Select(f => (string)f.GetRawConstantValue()!)
        .ToList();
}
