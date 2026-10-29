using System.Text.RegularExpressions;

namespace LogiBTP.Fiches;

/// <summary>Paramètre d'une requête : texte (converti par CAST au type de la colonne).</summary>
public sealed record ParametreFiche(string Nom, string? Valeur);

public sealed record RequeteFiche(string Texte, IReadOnlyList<ParametreFiche> Parametres);

/// <summary>
/// Requêtes d'une fiche sur la table de son type. Les identifiants (table, colonnes) viennent de la définition du
/// type, jamais du client : ils sont contrôlés puis mis entre guillemets ; toutes les valeurs passent en paramètres,
/// converties au type de la colonne (information_schema). Classe mère : les requêtes sont surchargeables.
/// </summary>
public partial class ConstructeurFiche(TypeFicheResolu type)
{
    [GeneratedRegex(@"^[a-z_][a-z0-9_]*$")]
    private static partial Regex IdentifiantSur();

    [GeneratedRegex(@"^[a-z][a-z0-9 _]*(\(\d+(,\d+)?\))?$")]
    private static partial Regex TypeSur();

    private readonly List<ParametreFiche> _parametres = [];

    protected TypeFicheResolu Type => type;

    public static string Identifiant(string nom) =>
        IdentifiantSur().IsMatch(nom) ? "\"" + nom + "\"" : throw new ErreurFiche("IDENTIFIANT", $"Identifiant SQL invalide : {nom}");

    protected string P(string? valeur)
    {
        var nom = $"p{_parametres.Count}";
        _parametres.Add(new ParametreFiche(nom, valeur));
        return "@" + nom;
    }

    protected RequeteFiche Fin(string texte)
    {
        var r = new RequeteFiche(texte, _parametres.ToList());
        _parametres.Clear();
        return r;
    }

    protected string Table => Identifiant(type.Table);
    protected string Cle => $"t.{Identifiant(type.Cle)}";

    /// <summary>Valeur convertie au type de la colonne (virgule décimale acceptée pour un nombre).</summary>
    protected string Valeur(string colonne, string? valeur)
    {
        if (valeur is null) return "NULL";
        var sqlType = type.TypesColonnes.GetValueOrDefault(colonne)?.ToLowerInvariant();
        // « character » (CHAR(n)) sans longueur tronquerait la valeur à un caractère : texte converti à l'affectation.
        if (sqlType is null || sqlType == "character" || !TypeSur().IsMatch(sqlType)) return P(valeur);
        if (Regex.IsMatch(sqlType, "^(smallint|integer|bigint|numeric|decimal|real|double precision)")) valeur = valeur.Trim().Replace(',', '.').Replace(" ", "");
        return $"CAST({P(valeur)} AS {sqlType})";
    }

    /// <summary>Colonnes lues : champs du programme (alias = code du champ), JSONB des champs supplémentaires, empreinte.</summary>
    public virtual RequeteFiche Lire(string id)
    {
        var colonnes = type.Definition.Champs.Where(c => c.Colonne is not null)
            .Select(c => $"t.{Identifiant(c.Colonne!)} AS {Identifiant(c.Code)}").ToList();
        colonnes.Add(type.ColonneProprietes is { } p ? $"t.{Identifiant(p)} AS \"_proprietes\"" : "NULL::jsonb AS \"_proprietes\"");
        colonnes.Add($"{Cle}::text AS \"_id\"");
        colonnes.Add("md5(row_to_json(t)::text) AS \"_h\"");
        return Fin($"SELECT {string.Join(", ", colonnes)} FROM {Table} t WHERE {Cle}::text = {P(id)}");
    }

    /// <summary>
    /// Fiche qui porte déjà ce code (identifiant et code), dans la même portée (colonne du champ de portée), hors de la
    /// fiche exclue (modification) ; une ligne au plus.
    /// </summary>
    public virtual RequeteFiche CodePris(string colonne, string code, string? colonnePortee, string? portee, string? exclure)
    {
        var filtre = $"t.{Identifiant(colonne)} = {P(code)}";
        if (colonnePortee is not null) filtre += $" AND t.{Identifiant(colonnePortee)}::text IS NOT DISTINCT FROM {P(portee)}";
        if (exclure is not null) filtre += $" AND {Cle}::text <> {P(exclure)}";
        return Fin($"SELECT {Cle}::text AS id, t.{Identifiant(colonne)}::text AS code FROM {Table} t WHERE {filtre} LIMIT 1");
    }

    /// <summary>Codes qui commencent par un début commun (rangs déjà pris d'un chrono), dans la même portée.</summary>
    public virtual RequeteFiche CodesCommencantPar(string colonne, string debut, string? colonnePortee, string? portee)
    {
        var filtre = $"left(t.{Identifiant(colonne)}::text, {debut.Length}) = {P(debut)}";
        if (colonnePortee is not null) filtre += $" AND t.{Identifiant(colonnePortee)}::text IS NOT DISTINCT FROM {P(portee)}";
        return Fin($"SELECT t.{Identifiant(colonne)}::text AS code FROM {Table} t WHERE {filtre}");
    }

    /// <summary>Suppression de la ligne de la fiche.</summary>
    public virtual RequeteFiche Suppression(string id) => Fin($"DELETE FROM {Table} t WHERE {Cle}::text = {P(id)}");

    /// <summary>Ligne verrouillée pendant l'enregistrement, avec son empreinte actuelle.</summary>
    public virtual RequeteFiche Verrou(string id) =>
        Fin($"SELECT md5(row_to_json(t)::text) AS h FROM {Table} t WHERE {Cle}::text = {P(id)} FOR UPDATE");

    /// <summary>Colonne d'un champ écrit ; un champ en lecture seule n'est accepté que s'il est calculé par la spécialisation.</summary>
    private string Colonne(string code, IReadOnlySet<string>? calcules = null) =>
        type.Definition.Champs.FirstOrDefault(c => c.Code == code && c.Colonne is not null && (!c.LectureSeule || calcules?.Contains(code) == true))?.Colonne
        ?? throw new ErreurFiche("CHAMP", $"Champ {code} non modifiable");

    /// <summary>UPDATE des champs modifiés ; les champs supplémentaires sont fusionnés dans la colonne JSONB.</summary>
    public virtual RequeteFiche MiseAJour(string id, IReadOnlyDictionary<string, string?> valeurs, string? proprietesJson, IReadOnlySet<string>? calcules = null)
    {
        var affectations = valeurs.Select(kv => { var col = Colonne(kv.Key, calcules); return $"{Identifiant(col)} = {Valeur(col, kv.Value)}"; }).ToList();
        if (proprietesJson is not null)
        {
            var p = Identifiant(type.ColonneProprietes ?? throw new ErreurFiche("PROPRIETES", "Ce type de fiche n'a pas de champs supplémentaires"));
            affectations.Add($"{p} = coalesce({p}, '{{}}'::jsonb) || CAST({P(proprietesJson)} AS jsonb)");
        }
        if (affectations.Count == 0) throw new ErreurFiche("VALEURS", "Aucune modification à enregistrer");
        return Fin($"UPDATE {Table} t SET {string.Join(", ", affectations)} WHERE {Cle}::text = {P(id)}");
    }

    /// <summary>INSERT d'une nouvelle fiche ; renvoie l'identifiant créé.</summary>
    public virtual RequeteFiche Insertion(IReadOnlyDictionary<string, string?> valeurs, string? proprietesJson, IReadOnlySet<string>? calcules = null)
    {
        var colonnes = new List<string>();
        var vals = new List<string>();
        foreach (var (code, v) in valeurs)
        {
            var col = Colonne(code, calcules);
            colonnes.Add(Identifiant(col));
            vals.Add(Valeur(col, v));
        }
        if (type.ColonneProprietes is { } p)
        {
            colonnes.Add(Identifiant(p));
            vals.Add($"CAST({P(proprietesJson ?? "{}")} AS jsonb)");
        }
        return Fin($"INSERT INTO {Table} ({string.Join(", ", colonnes)}) VALUES ({string.Join(", ", vals)}) RETURNING {Identifiant(type.Cle)}::text AS id");
    }
}
